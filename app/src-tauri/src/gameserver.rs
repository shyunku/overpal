//! The game server of the run's profile, for Home's game server menu: is it running, start it,
//! save and stop it through its REST API, and its logs as they are written.

use crate::applog::{self, Kind};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

const SERVER_PROCESS: &str = "palserver-win64-shipping-cmd.exe";
const SETTINGS: &str = r"Pal\Saved\Config\WindowsServer\PalWorldSettings.ini";
const PD_LOGS: &str = r"Pal\Binaries\Win64\PalDefender\Logs";
const UE4SS_LOG: &str = r"Pal\Binaries\Win64\ue4ss\UE4SS.log";
/// how much of a log's end is read
const LOG_TAIL_BYTES: u64 = 256 * 1024;
const LOG_LINES: usize = 400;

/// REST settings from PalWorldSettings.ini.
struct Rest {
    port: u16,
    password: String,
}

fn rest_settings(dir: &Path) -> Option<Rest> {
    let ini = std::fs::read_to_string(dir.join(SETTINGS)).ok()?;
    let get = |key: &str| {
        let at = ini.find(&format!("{key}="))? + key.len() + 1;
        let rest = &ini[at..];
        let v = if let Some(q) = rest.strip_prefix('"') { q.split('"').next()? } else { rest.split([',', ')']).next()? };
        Some(v.trim().to_string())
    };
    if !get("RESTAPIEnabled")?.eq_ignore_ascii_case("true") {
        return None;
    }
    Some(Rest { port: get("RESTAPIPort")?.parse().ok()?, password: get("AdminPassword").unwrap_or_default() })
}

async fn rest_call(rest: &Rest, method: reqwest::Method, path: &str, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let method_is_post = method == reqwest::Method::POST;
    let req = reqwest::Client::new()
        .request(method, format!("http://127.0.0.1:{}/v1/api/{path}", rest.port))
        .basic_auth("admin", Some(&rest.password))
        .timeout(Duration::from_secs(4));
    let req = match body {
        Some(b) => req.header("Content-Type", "application/json").body(b.to_string()),
        // the server wants a length also on an empty POST (411 otherwise)
        None if method_is_post => req.header("Content-Length", "0").body(""),
        None => req,
    };
    let res = req.send().await.map_err(|_| "게임 서버의 관리 API에 연결할 수 없습니다.".to_string())?;
    if !res.status().is_success() {
        return Err(format!("관리 API 오류 ({})", res.status().as_u16()));
    }
    let text = res.text().await.unwrap_or_default();
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameServerStatus {
    dir: String,
    /// the server process of this folder runs
    running: bool,
    /// REST is turned on in the server's settings
    rest_enabled: bool,
    /// REST answered (the server takes players)
    rest_ok: bool,
    version: Option<String>,
    server_name: Option<String>,
    fps: Option<f64>,
    players: Option<u64>,
    max_players: Option<u64>,
    /// seconds
    uptime: Option<u64>,
}

pub async fn status(dir: &Path) -> GameServerStatus {
    let mut s = GameServerStatus { dir: dir.display().to_string(), running: server_running(dir), ..Default::default() };
    let Some(rest) = rest_settings(dir) else { return s };
    s.rest_enabled = true;
    if !s.running {
        return s;
    }
    if let Ok(info) = rest_call(&rest, reqwest::Method::GET, "info", None).await {
        s.rest_ok = true;
        s.version = info.get("version").and_then(|v| v.as_str()).map(str::to_string);
        s.server_name = info.get("servername").and_then(|v| v.as_str()).map(str::to_string);
    }
    if let Ok(m) = rest_call(&rest, reqwest::Method::GET, "metrics", None).await {
        s.fps = m.get("serverfps").and_then(|v| v.as_f64());
        s.players = m.get("currentplayernum").and_then(|v| v.as_u64());
        s.max_players = m.get("maxplayernum").and_then(|v| v.as_u64());
        s.uptime = m.get("uptime").and_then(|v| v.as_u64());
    }
    s
}

/// the server itself; PalServer.exe only starts this (with the argument "Pal") in a console window
const SERVER_EXE: &str = r"Pal\Binaries\Win64\PalServer-Win64-Shipping-Cmd.exe";

/// RESTAPIPort in the server's settings (whether REST is on or not).
pub fn rest_port(dir: &Path) -> Option<u16> {
    let ini = std::fs::read_to_string(dir.join(SETTINGS)).ok()?;
    let at = ini.find("RESTAPIPort=")? + "RESTAPIPort=".len();
    ini[at..].split([',', ')']).next()?.trim().parse().ok()
}

/// Writes RESTAPIPort into the server's settings (added to OptionSettings when missing).
pub fn set_rest_port(dir: &Path, port: u16) -> Result<(), String> {
    let path = dir.join(SETTINGS);
    let ini = std::fs::read_to_string(&path).map_err(|_| "PalWorldSettings.ini를 읽을 수 없습니다.".to_string())?;
    let next = if let Some(at) = ini.find("RESTAPIPort=") {
        let at = at + "RESTAPIPort=".len();
        let end = at + ini[at..].find([',', ')']).unwrap_or(ini.len() - at);
        format!("{}{}{}", &ini[..at], port, &ini[end..])
    } else {
        let open = ini.find("OptionSettings=(").ok_or("PalWorldSettings.ini에 OptionSettings가 없습니다.")? + "OptionSettings=(".len();
        format!("{}RESTAPIPort={},{}", &ini[..open], port, &ini[open..])
    };
    std::fs::write(&path, next).map_err(|e| e.to_string())
}

pub fn is_running(dir: &Path) -> bool {
    server_running(dir)
}

/// Of the given ports ([port, udp]), those something on this PC already holds.
pub fn ports_taken(ports: &[(u16, bool)]) -> Vec<u16> {
    ports
        .iter()
        .filter(|(p, udp)| if *udp { std::net::UdpSocket::bind(("0.0.0.0", *p)).is_err() } else { std::net::TcpListener::bind(("0.0.0.0", *p)).is_err() })
        .map(|(p, _)| *p)
        .collect()
}

/// Starts the server without a console window; it keeps running when the app quits, and stops
/// through REST (stop) since there is no window to close. `game_port` / `query_port`: -port= and
/// -QueryPort= (the server's defaults when None).
pub fn start(dir: &Path, game_port: Option<u16>, query_port: Option<u16>) -> Result<(), String> {
    if server_running(dir) {
        return Err("게임 서버가 이미 실행 중입니다.".into());
    }
    let exe = dir.join(SERVER_EXE);
    if !exe.exists() {
        return Err("게임 서버 실행 파일(PalServer-Win64-Shipping-Cmd.exe)이 없습니다.".into());
    }
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("Pal").current_dir(dir);
    if let Some(p) = game_port {
        cmd.arg(format!("-port={p}"));
    }
    if let Some(p) = query_port {
        cmd.arg(format!("-QueryPort={p}"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // a console of its own that is never shown (not DETACHED_PROCESS: without any console,
        // PalDefender's console setup fails with "invalid handle"); its own process group so
        // nothing of this app's reaches it
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map_err(|e| format!("게임 서버를 시작할 수 없습니다: {e}"))?;
    applog::info(Kind::Conn, "게임 서버를 시작했습니다.");
    Ok(())
}

/// set while a stop asked for here is under way (the server ending then is no surprise)
static STOPPING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Saves the world and shuts the server down through REST.
pub async fn stop(dir: &Path) -> Result<(), String> {
    let rest = rest_settings(dir).ok_or("서버 설정에서 관리 API(RESTAPIEnabled)가 꺼져 있어 끌 수 없습니다.")?;
    rest_call(&rest, reqwest::Method::POST, "save", None).await?;
    applog::info(Kind::Conn, "게임 서버 월드를 저장했습니다.");
    STOPPING.store(true, std::sync::atomic::Ordering::SeqCst);
    rest_call(&rest, reqwest::Method::POST, "shutdown", Some(serde_json::json!({ "waittime": 5, "message": "Server is shutting down" }))).await?;
    applog::info(Kind::Conn, "게임 서버를 끄는 중입니다 (5초 뒤 종료).");
    Ok(())
}

fn newest_file(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "log"))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
}

fn read_tail(path: &Path) -> Vec<String> {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else { return Vec::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let from = len.saturating_sub(LOG_TAIL_BYTES);
    let _ = f.seek(SeekFrom::Start(from));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<String> = text.lines().map(|l| l.trim_end().to_string()).collect();
    // the first line may be cut in the middle
    if from > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    let over = lines.len().saturating_sub(LOG_LINES);
    lines.drain(..over);
    lines
}

/// Whether a server process runs from this folder.
#[cfg(windows)]
fn server_running(dir: &Path) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
    // a process that ended stays listed while its console window is open; only a live one counts
    const STILL_ACTIVE: u32 = 259;
    // the folder may be written with / or a trailing separator
    let want = dir.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase() + "\\";
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut ok = Process32FirstW(snap, &mut e) != 0;
        while ok && !found {
            let n = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            if String::from_utf16_lossy(&e.szExeFile[..n]).to_lowercase() == SERVER_PROCESS {
                let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, e.th32ProcessID);
                if !h.is_null() {
                    let mut buf = [0u16; 1024];
                    let mut len = buf.len() as u32;
                    let mut code = 0u32;
                    let alive = GetExitCodeProcess(h, &mut code) != 0 && code == STILL_ACTIVE;
                    if alive && QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0 {
                        found = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase().starts_with(&want);
                    }
                    CloseHandle(h);
                }
            }
            ok = Process32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
        found
    }
}

#[cfg(not(windows))]
fn server_running(_dir: &Path) -> bool {
    false
}

// ---------------------------------------------------------------- trouble into the app log

const CRASHES: &str = r"Pal\Saved\Crashes";
const CRASH_CONTEXT: &str = "CrashContext.runtime-xml";
const WATCH_EVERY: Duration = Duration::from_secs(2);

/// New whole lines of a log file as it grows.
#[derive(Default)]
struct Tail {
    file: Option<PathBuf>,
    pos: u64,
    partial: String,
    started: bool,
}

impl Tail {
    /// `now`: the file to follow. A file already there when following starts is read from its end
    /// (old trouble is not reported again), one that turns up later from its start.
    fn new_lines(&mut self, now: Option<PathBuf>) -> Vec<String> {
        if now != self.file {
            self.pos = if self.started { 0 } else { now.as_deref().and_then(|f| std::fs::metadata(f).ok()).map_or(0, |m| m.len()) };
            self.file = now;
            self.partial.clear();
        }
        self.started = true;
        let Some(f) = self.file.clone() else { return Vec::new() };
        let len = std::fs::metadata(&f).map(|m| m.len()).unwrap_or(0);
        if len < self.pos {
            // the file was started over
            self.restart();
        }
        if len <= self.pos {
            return Vec::new();
        }
        use std::io::{Read, Seek, SeekFrom};
        let Ok(mut h) = std::fs::File::open(&f) else { return Vec::new() };
        let _ = h.seek(SeekFrom::Start(self.pos));
        let mut buf = Vec::new();
        let _ = h.take(len - self.pos).read_to_end(&mut buf);
        self.pos += buf.len() as u64;
        self.partial.push_str(&String::from_utf8_lossy(&buf));
        let Some(end) = self.partial.rfind('\n') else { return Vec::new() };
        let lines = self.partial[..end].lines().map(|l| l.trim_end().to_string()).filter(|l| !l.is_empty()).collect();
        self.partial = self.partial[end + 1..].to_string();
        lines
    }

    /// The same file is written anew (UE4SS.log on a server start).
    fn restart(&mut self) {
        self.pos = 0;
        self.partial.clear();
    }
}

/// An error or fatal line of PalDefender's log (spdlog levels).
fn pd_error(line: &str) -> bool {
    line.contains("][error]") || line.contains("][critical]")
}

/// An error line of UE4SS's log (Lua errors, the mod's own); not its offset dump at start
/// ("UWorld::bKismetScriptError = 0x13D").
fn ue4ss_error(line: &str) -> bool {
    let l = line.to_lowercase();
    (l.contains("error") || l.contains("fatal") || l.contains("exception")) && !l.contains(" = 0x")
}

fn crash_dirs(dir: &Path) -> std::collections::HashSet<String> {
    std::fs::read_dir(dir.join(CRASHES))
        .map(|rd| rd.flatten().filter(|e| e.path().join(CRASH_CONTEXT).exists()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default()
}

/// What a crash report says: its error and the modules at the top of the crashing call stack
/// (e.g. "PalServer-Win64-Shipping-Cmd → PalDefender": a plugin called into the game).
fn crash_text(report: &Path) -> String {
    let xml = std::fs::read_to_string(report.join(CRASH_CONTEXT)).unwrap_or_default();
    let tag = |name: &str| -> Option<String> {
        let open = format!("<{name}>");
        let at = xml.find(&open)? + open.len();
        Some(xml[at..at + xml[at..].find(&format!("</{name}>"))?].trim().to_string())
    };
    let error = tag("ErrorMessage").filter(|e| !e.is_empty()).unwrap_or_else(|| "원인 불명".into());
    // "Module 0x<base> + <offset> Module 0x..." -> modules in order, repeats folded
    let mut modules: Vec<String> = Vec::new();
    if let Some(stack) = tag("PCallStack") {
        let words: Vec<&str> = stack.split_whitespace().collect();
        for w in words.windows(2) {
            if w[1].starts_with("0x") && !w[0].starts_with("0x") && w[0] != "+" && modules.last().map(String::as_str) != Some(w[0]) {
                modules.push(w[0].to_string());
            }
        }
    }
    modules.truncate(4);
    let stack = if modules.is_empty() { String::new() } else { format!(" / 호출 순서(위부터): {}", modules.join(" → ")) };
    format!("게임 서버가 비정상 종료되었습니다: {error}{stack} / 보고서: {}", report.display())
}

/// Puts the game server's trouble into the app log whether or not its log screen is open: error
/// and fatal lines of PalDefender's and UE4SS's logs, new crash reports, and the server ending
/// without Overpal stopping it. Runs for the whole run (server modes).
pub fn watch_errors(dir: PathBuf) {
    use std::sync::atomic::Ordering;
    tauri::async_runtime::spawn(async move {
        let mut pd = Tail::default();
        let mut ue = Tail::default();
        let mut crashes = crash_dirs(&dir);
        let mut was_running = server_running(&dir);
        loop {
            let running = server_running(&dir);
            if running && !was_running {
                // a new start writes UE4SS.log over from the beginning
                ue.restart();
                STOPPING.store(false, Ordering::SeqCst);
            }
            for l in pd.new_lines(newest_file(&dir.join(PD_LOGS))).into_iter().filter(|l| pd_error(l)) {
                applog::error(Kind::Conn, format!("PalDefender 로그: {l}"));
            }
            for l in ue.new_lines(Some(dir.join(UE4SS_LOG)).filter(|p| p.exists())).into_iter().filter(|l| ue4ss_error(l)) {
                applog::error(Kind::Conn, format!("모드(UE4SS) 로그: {l}"));
            }
            let now = crash_dirs(&dir);
            let mut new: Vec<&String> = now.difference(&crashes).collect();
            new.sort();
            for c in new {
                applog::error(Kind::Conn, crash_text(&dir.join(CRASHES).join(c)));
            }
            crashes = now;
            if was_running && !running && !STOPPING.swap(false, Ordering::SeqCst) {
                applog::error(Kind::Conn, "게임 서버가 꺼졌습니다. Overpal에서 끈 것이 아닙니다 (크래시나 다른 프로그램에서 종료).");
            }
            was_running = running;
            tokio::time::sleep(WATCH_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_rest_settings() {
        let d = std::env::temp_dir().join(format!("overpal-gs-{}", crate::profiles::new_token()));
        std::fs::create_dir_all(d.join(SETTINGS).parent().unwrap()).unwrap();
        std::fs::write(d.join(SETTINGS), "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(Difficulty=None,AdminPassword=\"pw,1\",RESTAPIEnabled=True,RESTAPIPort=8212,ServerName=\"x\")").unwrap();
        let r = rest_settings(&d).unwrap();
        assert_eq!((r.port, r.password.as_str()), (8212, "pw,1"));
        std::fs::write(d.join(SETTINGS), "OptionSettings=(RESTAPIEnabled=False,RESTAPIPort=8212)").unwrap();
        assert!(rest_settings(&d).is_none());
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn writes_rest_port() {
        let d = std::env::temp_dir().join(format!("overpal-port-{}", crate::profiles::new_token()));
        std::fs::create_dir_all(d.join(SETTINGS).parent().unwrap()).unwrap();
        std::fs::write(d.join(SETTINGS), "[x]\nOptionSettings=(Difficulty=None,RESTAPIEnabled=True,RESTAPIPort=8212,ServerName=\"x\")").unwrap();
        assert_eq!(rest_port(&d), Some(8212));
        set_rest_port(&d, 8312).unwrap();
        assert_eq!(rest_port(&d), Some(8312));
        assert!(std::fs::read_to_string(d.join(SETTINGS)).unwrap().contains("RESTAPIPort=8312,ServerName"));
        std::fs::write(d.join(SETTINGS), "OptionSettings=(Difficulty=None)").unwrap();
        set_rest_port(&d, 8412).unwrap();
        assert_eq!(rest_port(&d), Some(8412));
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn picks_error_lines() {
        assert!(pd_error("[22:01:17][error] something broke"));
        assert!(pd_error("[22:01:17][critical] boom"));
        assert!(!pd_error("[22:00:33][warning] Failed to set console output code page to UTF-8"));
        assert!(ue4ss_error("[2026-10-17 22:03:05.1] [Lua] Error in OverpalMod: attempt to index a nil value"));
        assert!(!ue4ss_error("[2026-10-17 22:03:02.4] UWorld::bKismetScriptError = 0x13D"));
    }

    #[test]
    fn reads_crash_reports() {
        let d = std::env::temp_dir().join(format!("overpal-crash-{}", crate::profiles::new_token()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(
            d.join(CRASH_CONTEXT),
            "<x><ErrorMessage>Unhandled Exception: EXCEPTION_ACCESS_VIOLATION reading address 0x0</ErrorMessage>\
             <PCallStack>Game 0x00007ff6 + 31 Game 0x00007ff6 + 32 PalDefender 0x00007ffd + 1a Game 0x00007ff6 + 4 UE4SS 0x7ffd + 4 Game 0x1 + 2</PCallStack></x>",
        )
        .unwrap();
        let t = crash_text(&d);
        assert!(t.contains("EXCEPTION_ACCESS_VIOLATION"), "{t}");
        assert!(t.contains("Game → PalDefender → Game → UE4SS /"), "{t}");
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn tail_reads_what_is_added() {
        let f = std::env::temp_dir().join(format!("overpal-tail-{}.log", crate::profiles::new_token()));
        std::fs::write(&f, "old\n").unwrap();
        let mut t = Tail::default();
        // there at the start: from its end
        assert!(t.new_lines(Some(f.clone())).is_empty());
        std::fs::write(&f, "old\nnew 1\nnew").unwrap();
        assert_eq!(t.new_lines(Some(f.clone())), vec!["new 1"]);
        std::fs::write(&f, "old\nnew 1\nnew 2\n").unwrap();
        assert_eq!(t.new_lines(Some(f.clone())), vec!["new 2"]);
        std::fs::remove_file(f).unwrap();
    }

    #[test]
    fn tail_keeps_whole_lines() {
        let d = std::env::temp_dir().join(format!("overpal-log-{}.log", crate::profiles::new_token()));
        std::fs::write(&d, "a\nb\nc\n").unwrap();
        assert_eq!(read_tail(&d), vec!["a", "b", "c"]);
        std::fs::remove_file(d).unwrap();
    }
}

// ---------------------------------------------------------------- live log

pub const GS_LOG: &str = "gs-log";
/// how often the followed log file is checked for new lines
const FOLLOW_EVERY: Duration = Duration::from_millis(200);

#[derive(Serialize, Clone)]
pub struct LogChunk {
    source: String,
    file: Option<String>,
    /// true: `lines` replace what is shown (first read, another file); false: they follow it
    reset: bool,
    lines: Vec<String>,
}

static FOLLOW_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Follows a server log (see log_tail) and sends new lines as `gs-log` events as they are written.
/// Starting another follow ends the previous one.
pub fn follow(app: tauri::AppHandle, dir: PathBuf, source: String) {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    let run = FOLLOW_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        let mut file: Option<PathBuf> = None;
        let mut pos: u64 = 0;
        let mut partial = String::new();
        let mut since_check = Duration::ZERO;
        loop {
            if FOLLOW_GEN.load(Ordering::SeqCst) != run {
                return;
            }
            // which file to follow: PalDefender starts a new one per server start
            if file.is_none() || since_check >= Duration::from_secs(1) {
                since_check = Duration::ZERO;
                let now = match source.as_str() {
                    "mod" => Some(dir.join(UE4SS_LOG)).filter(|p| p.exists()),
                    _ => newest_file(&dir.join(PD_LOGS)),
                };
                if now != file {
                    file = now;
                    let lines = file.as_deref().map(read_tail).unwrap_or_default();
                    pos = file.as_deref().and_then(|f| std::fs::metadata(f).ok()).map_or(0, |m| m.len());
                    partial.clear();
                    let _ = app.emit(GS_LOG, LogChunk { source: source.clone(), file: file.as_ref().map(|f| f.display().to_string()), reset: true, lines });
                }
            }
            if let Some(f) = &file {
                let len = std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
                if len < pos {
                    // the file was started over
                    pos = 0;
                }
                if len > pos {
                    use std::io::{Read, Seek, SeekFrom};
                    if let Ok(mut h) = std::fs::File::open(f) {
                        let _ = h.seek(SeekFrom::Start(pos));
                        let mut buf = Vec::new();
                        let _ = h.take(len - pos).read_to_end(&mut buf);
                        pos += buf.len() as u64;
                        partial.push_str(&String::from_utf8_lossy(&buf));
                        // only whole lines go out
                        if let Some(end) = partial.rfind('\n') {
                            let lines: Vec<String> = partial[..end].lines().map(|l| l.trim_end().to_string()).collect();
                            partial = partial[end + 1..].to_string();
                            if !lines.is_empty() {
                                let _ = app.emit(GS_LOG, LogChunk { source: source.clone(), file: Some(f.display().to_string()), reset: false, lines });
                            }
                        }
                    }
                }
            }
            tokio::time::sleep(FOLLOW_EVERY).await;
            since_check += FOLLOW_EVERY;
        }
    });
}
