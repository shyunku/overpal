mod config;
mod overlay;
mod hotkeys;
mod overlay_watch;
mod server;

use config::{ClientConfig, Config, Mode};
use tauri::Manager;

struct Args {
    mode: Option<Mode>,
    config: Option<String>,
    /// show the overlay even when the game is not in front (development)
    always_show: bool,
}

/// Accepts `--mode <server|client|both>`, `--config <path>` (also `--key=value`) and `--always-show`.
/// Unknown arguments are ignored so dev tooling can pass its own.
fn parse_args() -> Result<Args, String> {
    let mut args = Args { mode: None, config: None, always_show: false };
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
            "--always-show" => args.always_show = true,
            _ => {}
        }
    }
    Ok(args)
}

fn fail(msg: &str) -> ! {
    eprintln!("palhelper: {msg}");
    // started by double-click, the console closes with the process; keep the message readable
    eprintln!("Press Enter to close.");
    let _ = std::io::stdin().read_line(&mut String::new());
    std::process::exit(1);
}

struct ClientState(Option<ClientConfig>);

#[tauri::command]
fn client_config(state: tauri::State<'_, ClientState>) -> Result<ClientConfig, String> {
    state.0.clone().ok_or_else(|| "client settings are missing in the config file".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args = parse_args().unwrap_or_else(|e| fail(&e));
    let path = config::resolve_path(args.config.as_deref());
    let cfg: Config = config::load(&path).unwrap_or_else(|e| fail(&e));
    let mode = args.mode.unwrap_or(cfg.mode);
    eprintln!("PalHelper {} ({mode:?} mode, config {})", env!("CARGO_PKG_VERSION"), path.display());
    eprintln!("Closing this window quits PalHelper. The overlay shows only while the game window is visible.");

    let server_cfg = if mode.has_server() {
        Some(cfg.server.clone().unwrap_or_else(|| fail("mode needs a \"server\" section in the config")))
    } else {
        None
    };

    if mode == Mode::Server {
        let rt = tokio::runtime::Runtime::new().unwrap_or_else(|e| fail(&e.to_string()));
        if let Err(e) = rt.block_on(server::serve(server_cfg.unwrap())) {
            fail(&e);
        }
        return;
    }

    let client = cfg.effective_client(mode);
    let always_show = args.always_show;
    tauri::Builder::default()
        .manage(ClientState(client))
        .invoke_handler(tauri::generate_handler![client_config, overlay::layout_get, overlay::layout_set, overlay::round_corners, overlay::click_through, overlay::set_shown, overlay_watch::overlay_state])
        .setup(move |app| {
            if let Some(s) = server_cfg {
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = server::serve(s).await {
                        eprintln!("[server] {e}");
                    }
                });
            }
            app.manage(overlay::LayoutStore::load(app.handle()));
            overlay_watch::init(app.handle(), always_show);
            overlay::create_windows(app.handle())?;
            overlay_watch::spawn(app.handle(), &overlay::FOLLOW_CURSOR, always_show);
            hotkeys::spawn(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
