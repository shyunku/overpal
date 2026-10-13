mod applog;
mod config;
mod gameserver;
mod gui;
mod hotkeys;
mod overlay;
mod overlay_watch;
mod profiles;
mod server;

use config::{Config, Mode};
use gui::{ClientState, Session, SessionInner};
use std::sync::Mutex;
use tauri::Manager;

struct Args {
    mode: Option<Mode>,
    config: Option<String>,
    /// start with this profile (the app restarting itself after settings were saved)
    profile: Option<String>,
    /// show the overlay even when the game is not in front (development)
    always_show: bool,
}

/// Accepts `--mode <server|client|both>`, `--config <path>`, `--profile <name>` (also `--key=value`)
/// and `--always-show`. Unknown arguments are ignored so dev tooling can pass its own.
fn parse_args() -> Result<Args, String> {
    let mut args = Args { mode: None, config: None, profile: None, always_show: false };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        let (key, inline) = match a.split_once('=') {
            Some((k, v)) => (k.to_string(), Some(v.to_string())),
            None => (a.clone(), None),
        };
        match key.as_str() {
            "--mode" => {
                let v = inline.or_else(|| it.next()).ok_or("--mode needs a value")?;
                args.mode = Some(Mode::parse(&v).ok_or(format!("unknown mode: {v}"))?);
            }
            "--config" => {
                args.config = Some(inline.or_else(|| it.next()).ok_or("--config needs a value")?);
            }
            "--profile" => {
                args.profile = Some(inline.or_else(|| it.next()).ok_or("--profile needs a value")?);
            }
            "--always-show" => args.always_show = true,
            _ => {}
        }
    }
    Ok(args)
}

/// Shows the error (there is no console) and quits.
fn fail(msg: &str) -> ! {
    eprintln!("overpal: {msg}");
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        unsafe { MessageBoxW(std::ptr::null_mut(), wide(msg).as_ptr(), wide("Overpal").as_ptr(), MB_OK | MB_ICONERROR) };
    }
    std::process::exit(1);
}

/// The app was called PalHelper with the id com.palworldhelper.mod; its folder (profiles, friend
/// folders, layout, logs) moves to the new id's folder the first time. True when it moved.
fn move_old_config_dir(config_dir: &std::path::Path) -> bool {
    let old = config_dir.with_file_name("com.palworldhelper.mod");
    !config_dir.exists() && old.is_dir() && std::fs::rename(&old, config_dir).is_ok()
}

/// How this run starts.
enum Start {
    /// a config file: straight to Home, already started
    Config(std::path::PathBuf, Config, Mode),
    /// a profile by name (restart): straight to Home
    Profile(String, Option<Mode>),
    /// the profile window
    Launcher,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args = parse_args().unwrap_or_else(|e| fail(&e));
    let start = if let Some(name) = args.profile.clone() {
        Start::Profile(name, args.mode)
    } else if let Some(path) = config::find_path(args.config.as_deref()) {
        let cfg: Config = config::load(&path).unwrap_or_else(|e| fail(&e));
        let mode = args.mode.unwrap_or(cfg.mode);
        if mode.has_server() && cfg.server.is_none() {
            fail(&format!("{}: 이 모드에는 \"server\" 설정이 필요합니다.", path.display()));
        }
        Start::Config(path, cfg, mode)
    } else {
        Start::Launcher
    };
    let always_show = args.always_show;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ClientState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            gui::client_config,
            gui::app_quit,
            gui::profiles_list,
            gui::profile_delete,
            gui::launcher_open,
            gui::session_get,
            gui::session_start,
            gui::profile_update,
            gui::detect_server_dir,
            gui::find_game_servers,
            gui::gs_status,
            gui::gs_start,
            gui::gs_stop,
            gui::gs_log_follow,
            gui::gs_log_dir,
            gui::players_in,
            gui::pick_folder,
            gui::open_path,
            gui::public_ip,
            gui::friend_add,
            gui::friend_renew,
            gui::friend_remove,
            gui::friend_folder,
            applog::log_lines,
            applog::log_dir,
            overlay::layout_get,
            overlay::layout_set,
            overlay::round_corners,
            overlay::click_through,
            overlay::set_shown,
            overlay_watch::overlay_state
        ])
        .on_window_event(gui::on_window_event)
        .setup(move |app| {
            let config_dir = app.path().app_config_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let moved = move_old_config_dir(&config_dir);
            applog::set_dir(config_dir.join("logs"));
            applog::set_app(app.handle());
            if moved {
                applog::info(applog::Kind::App, "이전 이름(PalHelper)의 프로필과 설정을 옮겼습니다.");
            }
            app.manage(Session(Mutex::new(SessionInner::new(config_dir, always_show))));
            app.manage(overlay::LayoutStore::load(app.handle()));
            overlay_watch::init(app.handle(), always_show);
            match start {
                Start::Launcher => gui::open_launcher(app.handle())?,
                Start::Profile(name, mode) => {
                    let session = app.state::<Session>();
                    let profile = session.0.lock().unwrap().store.get(&name);
                    let Some(profile) = profile else { fail(&format!("프로필을 찾을 수 없습니다: {name}")) };
                    // the mode of the run that restarted, else the profile's own
                    let mode = mode.or(profile.start_mode.mode());
                    session.0.lock().unwrap().profile = Some(profile);
                    gui::open_home(app.handle())?;
                    // not ready for the mode: Home shows the settings
                    if let Some(mode) = mode {
                        match gui::start_profile(app.handle(), mode) {
                            Ok(()) => {}
                            Err(e) if e == "settings" => {}
                            Err(e) => fail(&e),
                        }
                    }
                }
                Start::Config(path, cfg, mode) => {
                    app.state::<Session>().0.lock().unwrap().legacy = Some((path, cfg.clone()));
                    gui::open_home(app.handle())?;
                    gui::start_services(app.handle(), &cfg, mode).unwrap_or_else(|e| fail(&e));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
