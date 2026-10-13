//! The app's own log: what the console used to show (start, connections, game server stalls,
//! friend apps). Kept in memory for the Home window's log screen, sent to it as it happens
//! (event `app-log`) and appended to a file per day (`<app config dir>\logs\YYYY-MM-DD.log`).

use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

pub const APP_LOG: &str = "app-log";
/// lines kept for the log screen
const KEEP: usize = 1000;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// start, settings
    App,
    /// app server, game server, PalDefender connections
    Conn,
    /// game server stalls the mod reports
    Stall,
    /// friend apps connecting
    Friend,
}

#[derive(Debug, Clone, Serialize)]
pub struct Line {
    /// local time, HH:MM:SS
    pub at: String,
    pub level: Level,
    pub kind: Kind,
    pub text: String,
}

struct Log {
    lines: Vec<Line>,
    dir: Option<PathBuf>,
}

static LOG: Mutex<Log> = Mutex::new(Log { lines: Vec::new(), dir: None });
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Where log files go; lines before this only stay in memory.
pub fn set_dir(dir: PathBuf) {
    LOG.lock().unwrap().dir = Some(dir);
}

/// Lines from now on are also sent to the windows.
pub fn set_app(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

pub fn info(kind: Kind, text: impl Into<String>) {
    push(Level::Info, kind, text.into());
}

pub fn warn(kind: Kind, text: impl Into<String>) {
    push(Level::Warn, kind, text.into());
}

pub fn error(kind: Kind, text: impl Into<String>) {
    push(Level::Error, kind, text.into());
}

fn push(level: Level, kind: Kind, text: String) {
    let (date, at) = local_now();
    let line = Line { at, level, kind, text };
    // still visible when started from a console (development)
    eprintln!("{} [{:?}] {}", line.at, line.level, line.text);
    {
        let mut log = LOG.lock().unwrap();
        if let Some(dir) = log.dir.clone() {
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join(format!("{date}.log"))) {
                let _ = writeln!(f, "{} {:?} {}", line.at, line.level, line.text);
            }
        }
        log.lines.push(line.clone());
        let over = log.lines.len().saturating_sub(KEEP);
        log.lines.drain(..over);
    }
    if let Some(app) = APP.get() {
        let _ = app.emit(APP_LOG, &line);
    }
}

#[tauri::command]
pub fn log_lines() -> Vec<Line> {
    LOG.lock().unwrap().lines.clone()
}

#[tauri::command]
pub fn log_dir() -> Option<String> {
    LOG.lock().unwrap().dir.as_ref().map(|d| d.display().to_string())
}

/// ("YYYY-MM-DD", "HH:MM:SS") in local time.
#[cfg(windows)]
fn local_now() -> (String, String) {
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;
    let t = unsafe {
        let mut t = std::mem::zeroed();
        GetLocalTime(&mut t);
        t
    };
    (format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay), format!("{:02}:{:02}:{:02}", t.wHour, t.wMinute, t.wSecond))
}

#[cfg(not(windows))]
fn local_now() -> (String, String) {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    ((s / 86400).to_string(), format!("{:02}:{:02}:{:02}", s / 3600 % 24, s / 60 % 60, s % 60))
}
