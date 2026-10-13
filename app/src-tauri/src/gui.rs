//! The app's own windows and how a run starts (#22, docs/designs/app-gui-mock.html):
//! the profile window ("launcher") picks a profile, then the Home window ("home") picks the mode
//! when the profile asks for it, starts the app server and/or the overlay, and shows status, log,
//! friends and settings. A run keeps its profile and mode; saving settings restarts the app.
//! A config file (overpal.config.json, `--config`) skips the profile window.

use crate::applog::{self, Kind};
use crate::config::{ClientConfig, Config, Mode};
use crate::profiles::{self, Friend, Profile, StartMode, Store};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LAUNCHER: &str = "launcher";
pub const HOME: &str = "home";
const HOME_SIZE: (f64, f64) = (912.0, 702.0);
const HOME_MIN: (f64, f64) = (760.0, 540.0);
const WINDOW_FILE: &str = "home-window.json";

/// Client settings for the overlay windows, set when the run starts.
pub struct ClientState(pub Mutex<Option<ClientConfig>>);

#[tauri::command]
pub fn client_config(state: tauri::State<'_, ClientState>) -> Result<ClientConfig, String> {
    state.0.lock().unwrap().clone().ok_or_else(|| "client settings are missing".to_string())
}

pub struct Session(pub Mutex<SessionInner>);

pub struct SessionInner {
    pub store: Store,
    pub config_dir: PathBuf,
    /// the profile of this run (profile window or `--profile`)
    pub profile: Option<Profile>,
    /// started from a config file instead
    pub legacy: Option<(PathBuf, Config)>,
    pub mode: Option<Mode>,
    pub started: bool,
    pub always_show: bool,
    overlay_up: bool,
    /// how Home reaches the app server (the overlay's settings, or the host's own in server mode)
    home_client: Option<ClientConfig>,
}

impl SessionInner {
    pub fn new(config_dir: PathBuf, always_show: bool) -> SessionInner {
        SessionInner { store: Store::new(&config_dir), config_dir, profile: None, legacy: None, mode: None, started: false, always_show, overlay_up: false, home_client: None }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    name: String,
    start_mode: StartMode,
    last_used: Option<u64>,
    /// game server folder or app server address
    target: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    profile: Option<Profile>,
    /// the config file of this run, when not started from a profile
    legacy_path: Option<String>,
    mode: Option<Mode>,
    started: bool,
    /// the overlay's (and Home's) way to the app server
    client: Option<ClientConfig>,
    version: &'static str,
}

// ---------------------------------------------------------------- windows

pub fn open_launcher(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, LAUNCHER, WebviewUrl::App("index.html?view=launcher".into()))
        .title("Overpal")
        // our own title bar (32 px) is inside the window
        .decorations(false)
        .shadow(true)
        .inner_size(460.0, 472.0)
        .resizable(false)
        .maximizable(false)
        .theme(Some(tauri::Theme::Dark))
        .center()
        .build()?;
    Ok(())
}

pub fn open_home(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(HOME).is_some() {
        return Ok(());
    }
    let dir = app.state::<Session>().0.lock().unwrap().config_dir.clone();
    let (w, h) = std::fs::read_to_string(dir.join(WINDOW_FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<(f64, f64)>(&t).ok())
        .map(|(w, h)| (w.max(HOME_MIN.0), h.max(HOME_MIN.1)))
        .unwrap_or(HOME_SIZE);
    WebviewWindowBuilder::new(app, HOME, WebviewUrl::App("index.html?view=home".into()))
        .title("Overpal")
        .decorations(false)
        .shadow(true)
        .inner_size(w, h)
        .min_inner_size(HOME_MIN.0, HOME_MIN.1)
        .theme(Some(tauri::Theme::Dark))
        .center()
        .build()?;
    Ok(())
}

/// Closing Home ends the app (the overlay windows would keep it running); its size is kept.
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { .. } = event {
        let app = window.app_handle();
        match window.label() {
            HOME => {
                if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                    let logical = size.to_logical::<f64>(scale);
                    let dir = app.state::<Session>().0.lock().unwrap().config_dir.clone();
                    let _ = std::fs::write(dir.join(WINDOW_FILE), serde_json::to_string(&(logical.width, logical.height)).unwrap());
                }
                app.exit(0);
            }
            // closing the profile window without picking one quits
            LAUNCHER if app.get_webview_window(HOME).is_none() => app.exit(0),
            _ => {}
        }
    }
}

// ---------------------------------------------------------------- starting a run

/// Starts the app server and/or the overlay for the config. Called once per run.
/// The session lock is never held while windows are made: making a window lets the other windows'
/// calls (e.g. Home asking for the session) run on this thread, and they take the same lock.
pub fn start_services(app: &AppHandle, cfg: &Config, mode: Mode) -> Result<(), String> {
    let session = app.state::<Session>();
    let (overlay_up, always_show, from) = {
        let mut s = session.0.lock().unwrap();
        if s.started {
            return Err("이미 시작했습니다.".into());
        }
        s.started = true;
        s.mode = Some(mode);
        let from = s.profile.as_ref().map(|p| format!("프로필 '{}'", p.name)).or_else(|| s.legacy.as_ref().map(|(p, _)| p.display().to_string())).unwrap_or_default();
        (s.overlay_up, s.always_show, from)
    };
    applog::info(Kind::App, format!("시작: {} 모드 ({from})", mode_name(mode)));
    if mode.has_server() {
        let sc = cfg.server.clone().ok_or("서버 설정이 없습니다.")?;
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::server::serve(sc).await {
                applog::error(Kind::Conn, format!("앱 서버를 시작할 수 없습니다: {e}"));
            }
        });
    }
    let client = cfg.effective_client(mode);
    let home_client = client.clone().or_else(|| {
        cfg.server.as_ref().map(|sc| ClientConfig {
            server_url: format!("http://127.0.0.1:{}", sc.listen.rsplit(':').next().unwrap_or("17994")),
            token: sc.access_tokens.first().cloned().unwrap_or_default(),
            player_name: None,
        })
    });
    session.0.lock().unwrap().home_client = home_client;
    if mode != Mode::Server {
        *app.state::<ClientState>().0.lock().unwrap() = client;
        if !overlay_up {
            session.0.lock().unwrap().overlay_up = true;
            crate::overlay::create_windows(app).map_err(|e| e.to_string())?;
            crate::overlay_watch::spawn(app, &crate::overlay::FOLLOW_CURSOR, always_show);
            crate::hotkeys::spawn(app);
        }
    }
    Ok(())
}

pub fn mode_name(mode: Mode) -> &'static str {
    match mode {
        Mode::Server => "server",
        Mode::Client => "client",
        Mode::Both => "both",
    }
}

/// Starts this exe again with the same profile and mode, then quits.
fn restart(app: &AppHandle, profile: &str, mode: Mode, always_show: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(exe);
    cmd.args(["--profile", profile, "--mode", mode_name(mode)]);
    if always_show {
        cmd.arg("--always-show");
    }
    cmd.spawn().map_err(|e| format!("다시 시작할 수 없습니다: {e}"))?;
    app.exit(0);
    Ok(())
}

// ---------------------------------------------------------------- commands: profile window

#[tauri::command]
pub fn profiles_list(session: tauri::State<'_, Session>) -> Vec<ProfileSummary> {
    let s = session.0.lock().unwrap();
    s.store
        .list()
        .into_iter()
        .map(|p| ProfileSummary {
            target: match p.start_mode {
                StartMode::Client => p.client.as_ref().map(|c| c.server_url.clone()),
                _ => p.server.as_ref().map(|x| x.game_server_dir.display().to_string()).or_else(|| p.client.as_ref().map(|c| c.server_url.clone())),
            },
            name: p.name,
            start_mode: p.start_mode,
            last_used: p.last_used,
        })
        .collect()
}

#[tauri::command]
pub fn profile_delete(session: tauri::State<'_, Session>, name: String) -> Result<(), String> {
    session.0.lock().unwrap().store.delete(&name)
}

/// Opens Home with a saved profile, or a new one (`is_new`) by that name.
/// Async (like every command that makes windows): a sync command runs on the main thread, and
/// making a window there on Windows waits for that same thread, leaving a blank window.
#[tauri::command]
pub async fn launcher_open(app: AppHandle, session: tauri::State<'_, Session>, name: String, is_new: bool) -> Result<(), String> {
    let name = name.trim().to_string();
    {
        let mut s = session.0.lock().unwrap();
        let profile = if is_new {
            if !profiles::valid_name(&name) {
                return Err("프로필 이름을 입력해 주세요. \\ / : * ? \" < > | 는 쓸 수 없습니다.".into());
            }
            if s.store.get(&name).is_some() {
                return Err("같은 이름의 프로필이 있습니다.".into());
            }
            let p = Profile::new(&name);
            s.store.save(&p)?;
            p
        } else {
            s.store.get(&name).ok_or("프로필을 찾을 수 없습니다.")?
        };
        s.profile = Some(profile);
    }
    open_home(&app).map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window(LAUNCHER) {
        let _ = w.close();
    }
    Ok(())
}

// ---------------------------------------------------------------- commands: Home

#[tauri::command]
pub fn session_get(session: tauri::State<'_, Session>) -> SessionView {
    let s = session.0.lock().unwrap();
    let client = s.home_client.clone();
    SessionView {
        profile: s.profile.clone(),
        legacy_path: s.legacy.as_ref().map(|(p, _)| p.display().to_string()),
        mode: s.mode,
        started: s.started,
        client,
        version: env!("CARGO_PKG_VERSION"),
    }
}

/// Starts the run with the session's profile in a mode. Saves the profile (last used, a host token
/// made on first use). Err("settings") when the profile lacks that mode's settings.
pub fn start_profile(app: &AppHandle, mode: Mode) -> Result<(), String> {
    let cfg = {
        let session = app.state::<Session>();
        let mut s = session.0.lock().unwrap();
        let store = Store::new(&s.config_dir);
        let p = s.profile.as_mut().ok_or("프로필이 없습니다.")?;
        if !p.ready_for(mode) {
            return Err("settings".into());
        }
        let cfg = p.to_config(mode)?;
        p.last_used = Some(profiles::now_secs());
        store.save(p)?;
        cfg
    };
    start_services(app, &cfg, mode)
}

/// Async: starting makes the overlay windows (see launcher_open).
#[tauri::command]
pub async fn session_start(app: AppHandle, mode: Mode) -> Result<(), String> {
    start_profile(&app, mode)
}

/// Saves the profile. While running, the app restarts with it in the same mode.
#[tauri::command]
pub fn profile_update(app: AppHandle, session: tauri::State<'_, Session>, profile: Profile) -> Result<bool, String> {
    let (restart_as, always_show) = {
        let mut s = session.0.lock().unwrap();
        let cur = s.profile.as_ref().ok_or("프로필이 없습니다.")?;
        if cur.name != profile.name {
            return Err("실행 중에는 프로필을 바꿀 수 없습니다.".into());
        }
        // tokens and friends are managed by the app, not the settings form
        let mut p = profile;
        p.host_token = cur.host_token.clone();
        p.friends = cur.friends.clone();
        p.last_used = cur.last_used;
        s.store.save(&p)?;
        s.profile = Some(p.clone());
        (if s.started { s.mode.map(|m| (p.name.clone(), m)) } else { None }, s.always_show)
    };
    applog::info(Kind::App, "설정을 저장했습니다.");
    if let Some((name, mode)) = restart_as {
        restart(&app, &name, mode, always_show)?;
        return Ok(true);
    }
    Ok(false)
}

/// Dedicated servers in the Steam libraries, for the settings' auto-find.
#[tauri::command]
pub async fn find_game_servers() -> Vec<profiles::FoundServer> {
    profiles::find_steam_servers()
}

#[tauri::command]
pub fn detect_server_dir(dir: String) -> profiles::Detected {
    profiles::detect_server(std::path::Path::new(&dir))
}

/// Player names from PalDefender of a game server folder, for picking the nickname before start.
#[tauri::command]
pub async fn players_in(dir: String) -> Result<Vec<String>, String> {
    let d = profiles::detect_server(std::path::Path::new(&dir));
    let (Some(url), Some(token)) = (d.pal_defender_url, d.pal_defender_token) else {
        return Err("PalDefender 설정을 찾을 수 없습니다.".into());
    };
    let res = reqwest::Client::new().get(format!("{url}/v1/pdapi/players")).bearer_auth(token).timeout(std::time::Duration::from_secs(4)).send().await.map_err(|_| "게임 서버에 연결할 수 없습니다.".to_string())?;
    let v: serde_json::Value = serde_json::from_str(&res.text().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(v.get("Players").and_then(|p| p.as_array()).map(|a| a.iter().filter_map(|p| p.get("Name").and_then(|n| n.as_str()).map(str::to_string)).collect()).unwrap_or_default())
}

#[tauri::command]
pub fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.display().to_string())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    std::process::Command::new("explorer").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- commands: friends

/// This PC's address on the internet (friends' configs point here).
#[tauri::command]
pub async fn public_ip() -> Result<String, String> {
    let ip = reqwest::Client::new().get("http://api.ipify.org").timeout(std::time::Duration::from_secs(5)).send().await.map_err(|_| "공인 IP를 확인할 수 없습니다.".to_string())?.text().await.map_err(|e| e.to_string())?;
    let ip = ip.trim().to_string();
    if ip.parse::<std::net::IpAddr>().is_err() {
        return Err("공인 IP를 확인할 수 없습니다.".into());
    }
    Ok(ip)
}

fn push_tokens(p: &Profile) {
    let mut list = vec![p.host_token.clone().unwrap_or_default()];
    let mut names = std::collections::HashMap::new();
    for f in &p.friends {
        list.push(f.token.clone());
        names.insert(f.token.clone(), f.name.clone());
    }
    crate::server::set_tokens(list, names);
}

fn friend_server_url(p: &Profile, ip: &str) -> String {
    format!("http://{ip}:{}", p.server.as_ref().map_or(profiles::DEFAULT_PORT, |s| s.port))
}

#[tauri::command]
pub async fn friend_add(session: tauri::State<'_, Session>, name: String, nickname: String) -> Result<Profile, String> {
    let ip = public_ip().await?;
    let mut s = session.0.lock().unwrap();
    let name = name.trim().to_string();
    if !profiles::valid_name(&name) {
        return Err("이름을 입력해 주세요. \\ / : * ? \" < > | 는 쓸 수 없습니다.".into());
    }
    let store = Store::new(&s.config_dir);
    let p = s.profile.as_mut().ok_or("프로필이 없습니다.")?;
    if p.friends.iter().any(|f| f.name == name) {
        return Err("같은 이름의 친구가 있습니다.".into());
    }
    let f = Friend { name, nickname: nickname.trim().to_string(), token: profiles::new_token() };
    store.write_friend_folder(&f, &friend_server_url(p, &ip))?;
    p.friends.push(f.clone());
    store.save(p)?;
    push_tokens(p);
    applog::info(Kind::Friend, format!("친구 추가: {}", f.name));
    Ok(p.clone())
}

#[tauri::command]
pub async fn friend_renew(session: tauri::State<'_, Session>, name: String) -> Result<Profile, String> {
    let ip = public_ip().await?;
    let mut s = session.0.lock().unwrap();
    let store = Store::new(&s.config_dir);
    let p = s.profile.as_mut().ok_or("프로필이 없습니다.")?;
    let url = friend_server_url(p, &ip);
    let f = p.friends.iter_mut().find(|f| f.name == name).ok_or("친구를 찾을 수 없습니다.")?;
    f.token = profiles::new_token();
    let f = f.clone();
    store.write_friend_folder(&f, &url)?;
    store.save(p)?;
    push_tokens(p);
    applog::info(Kind::Friend, format!("토큰 재발급: {name}"));
    Ok(p.clone())
}

/// Removes the friend and their token; their folder stays.
#[tauri::command]
pub fn friend_remove(session: tauri::State<'_, Session>, name: String) -> Result<Profile, String> {
    let mut s = session.0.lock().unwrap();
    let store = Store::new(&s.config_dir);
    let p = s.profile.as_mut().ok_or("프로필이 없습니다.")?;
    p.friends.retain(|f| f.name != name);
    store.save(p)?;
    push_tokens(p);
    applog::info(Kind::Friend, format!("친구 삭제: {name}"));
    Ok(p.clone())
}

#[tauri::command]
pub fn friend_folder(session: tauri::State<'_, Session>, name: String) -> Result<(), String> {
    let dir = session.0.lock().unwrap().store.friend_dir(&name);
    open_path(dir.display().to_string())
}
