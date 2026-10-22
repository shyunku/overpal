//! Makes a new Palworld dedicated server from Overpal: SteamCMD (Valve's tool, fetched once into
//! the app's data folder) downloads the server (app 2394010, anonymous), the settings come from
//! the server's own template filled in (name, passwords, REST), then the parts Overpal needs go in
//! (installer.rs) and its mod. Mock: docs/designs/server-setup-mock.html (③).

use crate::applog::{self, Kind};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use tauri::{AppHandle, Emitter, Manager};

const STEAMCMD_URL: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
const PALSERVER_APP: &str = "2394010";
/// the server's settings template, next to PalServer.exe, and where the server reads its settings
const SETTINGS_TEMPLATE: &str = "DefaultPalWorldSettings.ini";
const SETTINGS: &str = r"Pal\Saved\Config\WindowsServer\PalWorldSettings.ini";
const REST_PORT: u16 = 8212;

pub const CREATE_PROGRESS: &str = "create-progress";

/// asked to stop; the running SteamCMD's process id (0: none)
static CANCEL: AtomicBool = AtomicBool::new(false);
static STEAMCMD_PID: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// 0 SteamCMD, 1 server, 2 settings file, 3 settings filled in, 4 UE4SS, 5 PalDefender (+ REST), 6 mod
    step: u32,
    /// what it does now (short, shown next to the step); "완료" when the step is done
    text: String,
    pct: Option<f64>,
}

fn emit(app: &AppHandle, step: u32, text: impl Into<String>, pct: Option<f64>) {
    let _ = app.emit(CREATE_PROGRESS, Progress { step, text: text.into(), pct });
}

fn cancelled() -> Result<(), String> {
    if CANCEL.load(Ordering::SeqCst) {
        Err("서버 만들기를 취소했습니다.".into())
    } else {
        Ok(())
    }
}

/// Sets `key` in the OptionSettings=(...) line to `value` (already formatted: quoted for text),
/// replacing its value or adding the key. Quoted values may hold commas.
pub fn set_option(ini: &str, key: &str, value: &str) -> Result<String, String> {
    let open = ini.find("OptionSettings=(").ok_or("설정 파일에 OptionSettings가 없습니다.")? + "OptionSettings=(".len();
    let line_end = open + ini[open..].find('\n').unwrap_or(ini.len() - open);
    let line = &ini[open..line_end];
    // the key at the start of an entry: after "(" or ","
    let mut at = None;
    let mut i = 0;
    let mut quoted = false;
    let bytes = line.as_bytes();
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c == '"' {
            quoted = !quoted;
        } else if !quoted && (i == 0 || bytes[i - 1] == b',') && line[i..].starts_with(&format!("{key}=")) {
            at = Some(i);
            break;
        }
        i += 1;
    }
    let Some(start) = at else {
        return Ok(format!("{}{key}={value},{}", &ini[..open], &ini[open..]));
    };
    let vstart = start + key.len() + 1;
    let vend = if line[vstart..].starts_with('"') {
        vstart + 1 + line[vstart + 1..].find('"').map_or(line.len() - vstart - 1, |q| q + 1)
    } else {
        vstart + line[vstart..].find([',', ')']).unwrap_or(line.len() - vstart)
    };
    Ok(format!("{}{}{}{}", &ini[..open], &line[..vstart], value, &ini[open + vend..]))
}

/// a text value for the settings: in quotes, without quotes inside
fn text(v: &str) -> String {
    format!("\"{}\"", v.replace('"', ""))
}

async fn get_steamcmd(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("steamcmd");
    let exe = dir.join("steamcmd.exe");
    if exe.exists() {
        return Ok(exe);
    }
    emit(app, 0, "받는 중...", None);
    let bytes = reqwest::Client::new()
        .get(STEAMCMD_URL)
        .header("User-Agent", "Overpal")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("SteamCMD를 받지 못했습니다: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("SteamCMD를 받지 못했습니다: {e}"))?;
    crate::installer::unzip_into(&bytes, &dir)?;
    Ok(exe)
}

/// "Update state (0x61) downloading, progress: 33.45 (2100000000 / 6300000000)" -> (33.45, done, total)
fn parse_progress(line: &str) -> Option<(f64, u64, u64)> {
    let at = line.find("progress: ")? + "progress: ".len();
    let rest = &line[at..];
    let pct: f64 = rest.split_whitespace().next()?.parse().ok()?;
    let inner = rest.split('(').nth(1)?.split(')').next()?;
    let mut nums = inner.split('/').map(|s| s.trim().parse::<u64>().ok());
    Some((pct, nums.next()??, nums.next()??))
}

/// What a progress line says, for the step: the size while downloading, else what it does.
fn progress_text(line: &str) -> Option<(String, f64)> {
    let (pct, done, total) = parse_progress(line)?;
    let text = if line.contains("downloading") {
        format!("{:.1} / {:.1}GB", done as f64 / 1e9, total as f64 / 1e9)
    } else if line.contains("verifying") {
        "확인 중...".to_string()
    } else {
        "설치 중...".to_string()
    };
    Some((text, pct))
}

/// SteamCMD's own log, written as it goes (its output through a pipe comes in late bursts):
/// the lines added after `from` bytes.
fn log_since(log: &Path, from: u64) -> String {
    let Ok(bytes) = std::fs::read(log) else { return String::new() };
    // a new log (rotated) starts over
    let from = if (bytes.len() as u64) < from { 0 } else { from as usize };
    String::from_utf8_lossy(&bytes[from..]).into_owned()
}

/// Downloads (or updates) the server into `dir` with SteamCMD, without a window.
async fn download_server(app: &AppHandle, steamcmd: &Path, dir: &Path) -> Result<(), String> {
    use tokio::io::AsyncBufReadExt;
    std::fs::create_dir_all(dir).map_err(|e| format!("폴더를 만들 수 없습니다: {e}"))?;
    let mut cmd = tokio::process::Command::new(steamcmd);
    cmd.arg("+force_install_dir")
        .arg(dir)
        .args(["+login", "anonymous", "+app_update", PALSERVER_APP, "validate", "+quit"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let log = steamcmd.with_file_name("logs").join("console_log.txt");
    let log_from = std::fs::metadata(&log).map_or(0, |m| m.len());
    emit(app, 1, "준비 중...", None);
    let mut child = cmd.spawn().map_err(|e| format!("SteamCMD를 실행할 수 없습니다: {e}"))?;
    STEAMCMD_PID.store(child.id().unwrap_or(0), Ordering::SeqCst);
    let mut lines = tokio::io::BufReader::new(child.stdout.take().unwrap()).lines();
    let mut tail: Vec<String> = Vec::new();
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(l)) => {
                    tail.push(l);
                    if tail.len() > 8 { tail.remove(0); }
                }
                _ => break,
            },
            _ = tick.tick() => {
                if CANCEL.load(Ordering::SeqCst) {
                    let _ = child.kill().await;
                    break;
                }
                if let Some((text, pct)) = log_since(&log, log_from).lines().rev().find_map(progress_text) {
                    emit(app, 1, text, Some(pct));
                }
            }
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    STEAMCMD_PID.store(0, Ordering::SeqCst);
    cancelled()?;
    if !dir.join("PalServer.exe").exists() {
        let logged = log_since(&log, log_from);
        let why = logged
            .lines()
            .chain(tail.iter().map(String::as_str))
            .filter(|l| l.contains("ERROR") || l.contains("Error") || l.contains("Failed"))
            .last()
            .map(|l| l.trim().to_string())
            .unwrap_or_else(|| format!("SteamCMD 종료 코드 {:?}", status.code()));
        return Err(format!("서버를 받지 못했습니다: {why}"));
    }
    Ok(())
}

/// The settings file the server reads: made from the server's template, unless the folder has one
/// of its own already (an existing server keeps its settings). Returns whether it was made.
fn make_settings(dir: &Path) -> Result<bool, String> {
    let path = dir.join(SETTINGS);
    if std::fs::read_to_string(&path).is_ok_and(|t| t.contains("OptionSettings=(")) {
        return Ok(false);
    }
    let template = std::fs::read_to_string(dir.join(SETTINGS_TEMPLATE)).map_err(|_| "서버의 기본 설정 파일(DefaultPalWorldSettings.ini)이 없습니다.".to_string())?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, template).map_err(|e| format!("설정 파일을 쓸 수 없습니다: {e}"))?;
    Ok(true)
}

/// Fills in the name, the passwords and REST (on, this PC only).
fn fill_settings(dir: &Path, name: &str, admin_password: &str, server_password: &str) -> Result<(), String> {
    let path = dir.join(SETTINGS);
    let mut ini = std::fs::read_to_string(&path).map_err(|_| "PalWorldSettings.ini를 읽을 수 없습니다.".to_string())?;
    for (k, v) in [
        ("ServerName", text(name)),
        ("AdminPassword", text(admin_password)),
        ("ServerPassword", text(server_password)),
        ("RESTAPIEnabled", "True".to_string()),
        ("RESTAPIPort", REST_PORT.to_string()),
    ] {
        ini = set_option(&ini, k, &v)?;
    }
    std::fs::write(&path, ini).map_err(|e| format!("설정 파일을 쓸 수 없습니다: {e}"))
}

/// Makes a server in `dir` (an existing one there is updated and set up the same way).
pub async fn create(app: &AppHandle, dir: &Path, name: &str, admin_password: &str, server_password: &str) -> Result<(), String> {
    CANCEL.store(false, Ordering::SeqCst);
    // "E:Games" or "servers\a" would land somewhere relative to Overpal's own folder
    if !dir.is_absolute() {
        return Err("설치할 폴더는 드라이브부터 전체 경로로 입력해 주세요. (예: D:\\PalServer)".into());
    }
    if crate::gameserver::is_running(dir) {
        return Err("이 폴더의 게임 서버가 켜져 있습니다. 끈 뒤 다시 시도해 주세요.".into());
    }
    let steamcmd = get_steamcmd(app).await?;
    emit(app, 0, "완료", Some(100.0));
    cancelled()?;
    download_server(app, &steamcmd, dir).await?;
    emit(app, 1, "완료", Some(100.0));
    let made = make_settings(dir)?;
    emit(app, 2, if made { "완료" } else { "기존 설정을 씁니다" }, Some(100.0));
    fill_settings(dir, name, admin_password, server_password)?;
    emit(app, 3, "완료", Some(100.0));
    cancelled()?;
    // what is there already stays (unpacking UE4SS again would undo its settings, mods.txt and all)
    let has_ue4ss = crate::installer::has_ue4ss(dir);
    let has_pd = crate::installer::has_pal_defender(dir);
    for (step, part, has) in [(4, "ue4ss", has_ue4ss), (5, "paldefender", has_pd)] {
        emit(app, step, "설치 중...", None);
        let mut parts: Vec<String> = if has { vec![] } else { vec![part.into()] };
        if part == "paldefender" {
            parts.push("pdrest".into());
        }
        if !parts.is_empty() {
            crate::installer::install(app, dir, &parts).await?;
        }
        emit(app, step, "완료", Some(100.0));
        cancelled()?;
    }
    emit(app, 6, "설치 중...", None);
    if let Ok(bundled) = app.path().resolve("mod/OverpalMod", tauri::path::BaseDirectory::Resource) {
        crate::gameserver::update_mod(dir, &bundled)?;
    }
    emit(app, 6, "완료", Some(100.0));
    applog::info(Kind::Conn, format!("새 게임 서버를 만들었습니다: {}", dir.display()));
    Ok(())
}

/// Stops a server being made (SteamCMD killed; between steps it stops before the next one).
pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_in_the_settings() {
        let ini = "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(Difficulty=None,ServerName=\"Default, Palworld Server\",ServerPassword=\"\",AdminPassword=\"\",RESTAPIEnabled=False,RESTAPIPort=8212)\n";
        let mut s = ini.to_string();
        s = set_option(&s, "ServerName", &text("우리 서버")).unwrap();
        s = set_option(&s, "AdminPassword", &text("a\"b")).unwrap();
        s = set_option(&s, "RESTAPIEnabled", "True").unwrap();
        s = set_option(&s, "PublicPort", "8221").unwrap();
        assert!(s.contains("ServerName=\"우리 서버\",ServerPassword=\"\""), "{s}");
        assert!(s.contains("AdminPassword=\"ab\""), "{s}");
        assert!(s.contains("RESTAPIEnabled=True,RESTAPIPort=8212)"), "{s}");
        assert!(s.contains("OptionSettings=(PublicPort=8221,Difficulty=None"), "{s}");
        // a key inside a quoted value is not a key
        let q = "OptionSettings=(ServerDescription=\"x,ServerName=y\",ServerName=\"a\")";
        assert_eq!(set_option(q, "ServerName", "\"b\"").unwrap(), "OptionSettings=(ServerDescription=\"x,ServerName=y\",ServerName=\"b\")");
    }

    #[test]
    fn reads_steamcmd_progress() {
        assert_eq!(parse_progress(" Update state (0x61) downloading, progress: 33.45 (2100000000 / 6300000000)"), Some((33.45, 2100000000, 6300000000)));
        assert_eq!(parse_progress("Loading Steam API...OK"), None);
        assert_eq!(progress_text("[2026-10-22 17:21:31]  Update state (0x61) downloading, progress: 20.11 (1169437468 / 5816529537)"), Some(("1.2 / 5.8GB".to_string(), 20.11)));
        assert_eq!(progress_text(" Update state (0x81) verifying update, progress: 50.00 (1 / 2)").map(|p| p.0), Some("확인 중...".to_string()));
    }
}
