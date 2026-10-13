//! The app's server part: a thin authenticated HTTP relay.
//! It hands out the mod output and PalDefender data as-is; all processing happens in TS.

use crate::applog::{self, Kind};
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
use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

const STORAGE_FILE: &str = "base_storage.json";
/// server stalls logged by the mod
const STALL_FILE: &str = "stalls.txt";
/// how often the mod output file is checked for a new version
const WATCH_EVERY: Duration = Duration::from_millis(150);
/// how often PalDefender is asked whether the game server is up
const PD_CHECK_EVERY: Duration = Duration::from_secs(5);
/// a friend app counts as connected while its last request is this recent
const CONNECTED_WITHIN: Duration = Duration::from_secs(30);
/// stalls kept for the Home window
const STALL_WINDOW: Duration = Duration::from_secs(600);

/// Accepted tokens; the first is the host's own. Friends can be added while the server runs.
#[derive(Default)]
pub struct Tokens {
    pub list: Vec<String>,
    /// friend name per token
    pub names: HashMap<String, String>,
}

static TOKENS: OnceLock<Arc<RwLock<Tokens>>> = OnceLock::new();

/// Replaces the accepted tokens of the running server (friend added, renewed or removed).
pub fn set_tokens(list: Vec<String>, names: HashMap<String, String>) {
    if let Some(t) = TOKENS.get() {
        *t.write().unwrap() = Tokens { list, names };
    }
}

#[derive(Default)]
struct PdState {
    ok: Option<bool>,
    online: usize,
    total: usize,
}

struct Stall {
    at: String,
    ms: u64,
    scan: bool,
    when: Instant,
}

/// What the host's Home window shows besides the mod output.
#[derive(Default)]
struct HostState {
    pd: PdState,
    stalls: VecDeque<Stall>,
    /// last request per token
    seen: HashMap<String, Instant>,
}

#[derive(Clone)]
struct AppState {
    cfg: Arc<ServerConfig>,
    tokens: Arc<RwLock<Tokens>>,
    host: Arc<Mutex<HostState>>,
    http: reqwest::Client,
    pd_token: Option<String>,
    /// new contents of the mod output, for /api/events
    storage_tx: broadcast::Sender<String>,
}

pub async fn serve(cfg: ServerConfig) -> Result<(), String> {
    let pd_token = cfg.pal_defender.as_ref().and_then(|p| match p.read_token() {
        Ok(t) => Some(t),
        Err(e) => {
            applog::error(Kind::Conn, format!("PalDefender 토큰을 읽을 수 없습니다: {e}"));
            None
        }
    });
    if cfg.access_tokens.is_empty() {
        return Err("server.accessTokens must not be empty".into());
    }

    let listen = cfg.listen.clone();
    let tokens = TOKENS.get_or_init(|| Arc::new(RwLock::new(Tokens::default()))).clone();
    *tokens.write().unwrap() = Tokens { list: cfg.access_tokens.clone(), names: cfg.token_names.clone() };
    let host = Arc::new(Mutex::new(HostState::default()));
    let (storage_tx, _) = broadcast::channel(16);
    spawn_storage_watcher(cfg.mod_output_dir.join(STORAGE_FILE), storage_tx.clone());
    spawn_stall_watcher(cfg.mod_output_dir.join(STALL_FILE), host.clone());
    let state = AppState { cfg: Arc::new(cfg), tokens, host, http: reqwest::Client::new(), pd_token, storage_tx };
    spawn_pd_monitor(state.clone());

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
        .route("/api/host-status", get(host_status))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));

    let app = Router::new()
        .route("/api/health", get(health))
        .merge(protected)
        // auth is a bearer token, not cookies, so any origin may call
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&listen).await.map_err(|e| format!("{listen}에서 접속을 받을 수 없습니다: {e}"))?;
    applog::info(Kind::Conn, format!("앱 서버 시작: {listen}"));
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
    let token = given.and_then(|t| s.tokens.read().unwrap().list.iter().find(|a| constant_time_eq(a.as_bytes(), t.as_bytes())).cloned());
    let Some(token) = token else {
        return json_error(StatusCode::UNAUTHORIZED, "invalid or missing token");
    };
    note_request(&s, &token);
    next.run(req).await
}

/// Records the request time per token and logs a friend app that (re)connects.
fn note_request(s: &AppState, token: &str) {
    let now = Instant::now();
    let before = s.host.lock().unwrap().seen.insert(token.to_string(), now);
    let back = before.is_none_or(|t| now.duration_since(t) > CONNECTED_WITHIN);
    if back {
        if let Some(name) = s.tokens.read().unwrap().names.get(token) {
            applog::info(Kind::Friend, format!("친구 앱 접속: {name}"));
        }
    }
}

/// Host-only: PalDefender state, recent stalls and friend apps, for the Home window.
async fn host_status(State(s): State<AppState>, req: Request) -> Response {
    let given = req.headers().get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "));
    let tokens = s.tokens.read().unwrap();
    if given.is_none_or(|t| tokens.list.first().is_none_or(|h| !constant_time_eq(h.as_bytes(), t.as_bytes()))) {
        return json_error(StatusCode::FORBIDDEN, "host only");
    }
    let mut host = s.host.lock().unwrap();
    let now = Instant::now();
    while host.stalls.front().is_some_and(|x| now.duration_since(x.when) > STALL_WINDOW) {
        host.stalls.pop_front();
    }
    let stalls: Vec<_> = host.stalls.iter().rev().take(20).map(|x| serde_json::json!({ "at": x.at, "ms": x.ms, "scan": x.scan })).collect();
    let friends: Vec<_> = tokens
        .list
        .iter()
        .skip(1)
        .map(|t| {
            let ago = host.seen.get(t).map(|w| now.duration_since(*w).as_secs());
            serde_json::json!({ "name": tokens.names.get(t), "secondsAgo": ago, "connected": ago.is_some_and(|a| a <= CONNECTED_WITHIN.as_secs()) })
        })
        .collect();
    let body = serde_json::json!({
        "listen": s.cfg.listen,
        "palDefender": { "ok": host.pd.ok, "online": host.pd.online, "total": host.pd.total },
        "stalls": {
            "count": host.stalls.len(),
            "max": host.stalls.iter().map(|x| x.ms).max(),
            "scan": host.stalls.iter().filter(|x| x.scan).count(),
            "recent": stalls,
        },
        "friends": friends,
    });
    json_response(StatusCode::OK, body.to_string())
}

/// Asks PalDefender for the players every few seconds; logs when the game server comes and goes.
fn spawn_pd_monitor(s: AppState) {
    tokio::spawn(async move {
        loop {
            let state = match (&s.cfg.pal_defender, &s.pd_token) {
                (Some(pd), Some(token)) => {
                    let url = format!("{}/v1/pdapi/players", pd.url.trim_end_matches('/'));
                    match s.http.get(&url).bearer_auth(token).timeout(Duration::from_secs(4)).send().await {
                        Ok(res) if res.status().is_success() => {
                            let v: serde_json::Value = res.text().await.ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
                            let players = v.get("Players").and_then(|p| p.as_array()).cloned().unwrap_or_default();
                            let online = players.iter().filter(|p| p.get("Status").and_then(|x| x.as_str()) == Some("Online")).count();
                            Some((online, players.len()))
                        }
                        _ => None,
                    }
                }
                _ => None,
            };
            let ok = state.is_some();
            let was = {
                let mut host = s.host.lock().unwrap();
                let was = host.pd.ok;
                host.pd = PdState { ok: Some(ok), online: state.map_or(0, |x| x.0), total: state.map_or(0, |x| x.1) };
                was
            };
            if was != Some(ok) {
                if ok {
                    applog::info(Kind::Conn, if was.is_none() { "게임 서버(PalDefender) 연결됨" } else { "게임 서버(PalDefender) 다시 연결됨" });
                } else if was.is_none() {
                    applog::warn(Kind::Conn, "게임 서버(PalDefender)에 연결할 수 없습니다. 게임 서버가 켜지면 자동으로 연결됩니다.");
                } else {
                    applog::error(Kind::Conn, "게임 서버(PalDefender) 연결 끊김");
                }
            }
            tokio::time::sleep(PD_CHECK_EVERY).await;
        }
    });
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

/// Follows the game server stalls the mod logs (stalls.txt, one "HH:MM:SS <ms>[ scan]" per line):
/// logs each as a warning and keeps the last ten minutes for the Home window.
fn spawn_stall_watcher(path: std::path::PathBuf, host: Arc<Mutex<HostState>>) {
    tokio::spawn(async move {
        let mut seen = 0usize;
        loop {
            if let Ok(text) = tokio::fs::read_to_string(&path).await {
                // the mod starts a new file when the server restarts
                if text.len() < seen {
                    seen = 0;
                }
                for line in text[seen..].lines() {
                    let mut parts = line.split_whitespace();
                    if let (Some(at), Some(ms)) = (parts.next(), parts.next().and_then(|m| m.parse::<u64>().ok())) {
                        let scan = parts.next() == Some("scan");
                        applog::warn(Kind::Stall, format!("게임 서버 지연 {ms}ms{}", if scan { " (모드 스캔 중)" } else { "" }));
                        host.lock().unwrap().stalls.push_back(Stall { at: at.to_string(), ms, scan, when: Instant::now() });
                    }
                }
                // only whole lines count as seen
                seen = text.rfind('\n').map_or(seen, |i| i + 1);
            }
            tokio::time::sleep(WATCH_EVERY).await;
        }
    });
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

/// fields of a PalDefender player that other players must not see
const PRIVATE_PLAYER_FIELDS: [&str; 2] = ["IP", "UserId"];

async fn pd_players(State(s): State<AppState>) -> Response {
    let res = pal_defender_get(&s, "players").await;
    if !res.status().is_success() {
        return res;
    }
    let status = res.status();
    let Ok(bytes) = axum::body::to_bytes(res.into_body(), 4 << 20).await else {
        return json_error(StatusCode::BAD_GATEWAY, "PalDefender response could not be read");
    };
    let Ok(mut v) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return json_error(StatusCode::BAD_GATEWAY, "PalDefender response is not JSON");
    };
    // friends reach this server too: leave out IP addresses and platform ids
    if let Some(list) = v.get_mut("Players").and_then(|p| p.as_array_mut()) {
        for p in list.iter_mut().filter_map(|p| p.as_object_mut()) {
            for f in PRIVATE_PLAYER_FIELDS {
                p.remove(f);
            }
        }
    }
    json_response(status, v.to_string())
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
