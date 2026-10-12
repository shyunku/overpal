//! The app's server part: a thin authenticated HTTP relay.
//! It hands out the mod output and PalDefender data as-is; all processing happens in TS.

use crate::config::ServerConfig;
use axum::{
    Router,
    extract::{Path, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::get,
};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

const STORAGE_FILE: &str = "base_storage.json";
/// how often the mod output file is checked for a new version
const WATCH_EVERY: Duration = Duration::from_millis(150);

#[derive(Clone)]
struct AppState {
    cfg: Arc<ServerConfig>,
    http: reqwest::Client,
    pd_token: Option<String>,
    /// new contents of the mod output, for /api/events
    storage_tx: broadcast::Sender<String>,
}

pub async fn serve(cfg: ServerConfig) -> Result<(), String> {
    let pd_token = cfg.pal_defender.as_ref().and_then(|p| match std::fs::read_to_string(&p.token_file) {
        Ok(t) => Some(t.trim().to_string()),
        Err(e) => {
            eprintln!("[server] cannot read PalDefender token file {}: {e}", p.token_file.display());
            None
        }
    });
    if cfg.access_tokens.is_empty() {
        return Err("server.accessTokens must not be empty".into());
    }

    let listen = cfg.listen.clone();
    let (storage_tx, _) = broadcast::channel(16);
    spawn_storage_watcher(cfg.mod_output_dir.join(STORAGE_FILE), storage_tx.clone());
    let state = AppState { cfg: Arc::new(cfg), http: reqwest::Client::new(), pd_token, storage_tx };

    let protected = Router::new()
        .route("/api/base-storage", get(base_storage))
        .route("/api/events", get(events))
        .route("/api/mod-status", get(mod_status))
        .route("/api/players", get(pd_players))
        .route("/api/guilds", get(pd_guilds))
        .route("/api/guild/{id}", get(pd_guild))
        .route("/api/items/{player}", get(pd_items))
        .route("/api/progression/{player}", get(pd_progression))
        .route("/api/pals/{player}", get(pd_pals))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));

    let app = Router::new()
        .route("/api/health", get(health))
        .merge(protected)
        // auth is a bearer token, not cookies, so any origin may call
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&listen).await.map_err(|e| format!("cannot listen on {listen}: {e}"))?;
    eprintln!("[server] listening on http://{listen}");
    axum::serve(listener, app).await.map_err(|e| e.to_string())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn require_token(State(s): State<AppState>, req: Request, next: Next) -> Response {
    let given = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let ok = given.is_some_and(|t| s.cfg.access_tokens.iter().any(|a| constant_time_eq(a.as_bytes(), t.as_bytes())));
    if !ok {
        return json_error(StatusCode::UNAUTHORIZED, "invalid or missing token");
    }
    next.run(req).await
}

fn json_error(status: StatusCode, msg: &str) -> Response {
    let body = serde_json::json!({ "error": msg }).to_string();
    json_response(status, body)
}

fn json_response(status: StatusCode, body: String) -> Response {
    let mut res = (status, body).into_response();
    res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    res
}

async fn health() -> Response {
    json_response(StatusCode::OK, r#"{"ok":true}"#.into())
}

async fn read_mod_file(s: &AppState, name: &str) -> Response {
    let path = s.cfg.mod_output_dir.join(name);
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => json_response(StatusCode::OK, text),
        // the mod replaces the file by delete + rename, so it can be briefly missing
        Err(_) => json_error(StatusCode::SERVICE_UNAVAILABLE, "mod output not available yet"),
    }
}

async fn base_storage(State(s): State<AppState>) -> Response {
    read_mod_file(&s, STORAGE_FILE).await
}

/// Sends the mod output whenever the mod writes a new version.
fn spawn_storage_watcher(path: std::path::PathBuf, tx: broadcast::Sender<String>) {
    tokio::spawn(async move {
        let mut last: Option<SystemTime> = None;
        loop {
            if let Ok(modified) = tokio::fs::metadata(&path).await.and_then(|m| m.modified()) {
                if last != Some(modified) {
                    // the mod replaces the file by delete + rename, so a read can miss it briefly
                    if let Ok(text) = tokio::fs::read_to_string(&path).await {
                        last = Some(modified);
                        if tx.receiver_count() > 0 {
                            let _ = tx.send(text);
                        }
                    }
                }
            }
            tokio::time::sleep(WATCH_EVERY).await;
        }
    });
}

/// Server-sent events: `storage` with the current mod output, then every new version.
async fn events(State(s): State<AppState>) -> Response {
    let rx = s.storage_tx.subscribe();
    let first = tokio::fs::read_to_string(s.cfg.mod_output_dir.join(STORAGE_FILE)).await.ok();
    let stream = futures_util::stream::unfold((first, rx), |(first, mut rx)| async move {
        if let Some(text) = first {
            return Some((Ok::<_, Infallible>(Event::default().event("storage").data(text)), (None, rx)));
        }
        loop {
            match rx.recv().await {
                Ok(text) => return Some((Ok(Event::default().event("storage").data(text)), (None, rx))),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

async fn mod_status(State(s): State<AppState>) -> Response {
    read_mod_file(&s, "status.json").await
}

async fn pal_defender_get(s: &AppState, path: &str) -> Response {
    let (Some(pd), Some(token)) = (&s.cfg.pal_defender, &s.pd_token) else {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "PalDefender is not configured");
    };
    let url = format!("{}/v1/pdapi/{}", pd.url.trim_end_matches('/'), path);
    match s.http.get(&url).bearer_auth(token).send().await {
        Ok(res) => {
            let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            match res.text().await {
                Ok(text) => json_response(status, text),
                Err(_) => json_error(StatusCode::BAD_GATEWAY, "PalDefender response could not be read"),
            }
        }
        Err(_) => json_error(StatusCode::BAD_GATEWAY, "PalDefender is not reachable"),
    }
}

async fn pd_players(State(s): State<AppState>) -> Response {
    pal_defender_get(&s, "players").await
}

async fn pd_guilds(State(s): State<AppState>) -> Response {
    pal_defender_get(&s, "guilds").await
}

async fn pd_guild(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    // only guid-like ids are forwarded
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return json_error(StatusCode::BAD_REQUEST, "invalid guild id");
    }
    pal_defender_get(&s, &format!("guild/{id}")).await
}

/// A player's progression, including capture counts per pal (PalDefender /progression/{PlayerUID}).
async fn pd_progression(State(s): State<AppState>, Path(player): Path<String>) -> Response {
    if !valid_player_id(&player) {
        return json_error(StatusCode::BAD_REQUEST, "invalid player id");
    }
    pal_defender_get(&s, &format!("progression/{player}")).await
}

/// A player's pals: party, pal box and base workers (PalDefender /pals/{PlayerUID}).
async fn pd_pals(State(s): State<AppState>, Path(player): Path<String>) -> Response {
    if !valid_player_id(&player) {
        return json_error(StatusCode::BAD_REQUEST, "invalid player id");
    }
    pal_defender_get(&s, &format!("pals/{player}")).await
}

fn valid_player_id(player: &str) -> bool {
    !player.is_empty() && player.len() <= 64 && player.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// A player's inventory (PalDefender /items/{PlayerUID}).
async fn pd_items(State(s): State<AppState>, Path(player): Path<String>) -> Response {
    if !valid_player_id(&player) {
        return json_error(StatusCode::BAD_REQUEST, "invalid player id");
    }
    pal_defender_get(&s, &format!("items/{player}")).await
}
