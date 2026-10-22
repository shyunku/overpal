//! Puts the server parts Overpal needs into a game server folder: UE4SS (the Palworld build) and
//! PalDefender, pinned versions from their official GitHub releases (both MIT), and turns on
//! PalDefender's REST with a token of Overpal's own. One part after the other: they go into the
//! same folder, and the REST settings need PalDefender in place. Mock: docs/designs/server-setup-mock.html.

use crate::applog::{self, Kind};
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Emitter};

/// next to the server executable: UE4SS's and PalDefender's loaders go here
const WIN64: &str = r"Pal\Binaries\Win64";
/// Palworld's UE4SS: the build the C server runs (docs/game-internals.md, server install layout)
pub const UE4SS_VERSION: &str = "2281fa31";
const UE4SS_URL: &str = "https://github.com/Okaetsu/RE-UE4SS/releases/download/2281fa31/UE4SS-Palworld-g2281fa31.zip";
pub const PD_VERSION: &str = "v1.9.3";
const PD_URL: &str = "https://github.com/Ultimeit/PalDefender/releases/download/v1.9.3/PalDefender.zip";
const PD_REST_DIR: &str = r"Pal\Binaries\Win64\PalDefender\RESTAPI";
const DEFAULT_PD_PORT: u16 = 17993;

/// progress of an install, for the settings screen
pub const INSTALL_PROGRESS: &str = "install-progress";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// "ue4ss", "paldefender" or "pdrest"
    part: String,
    /// what it does now
    text: String,
    /// 0..100 while downloading
    pct: Option<f64>,
}

fn emit(app: &AppHandle, part: &str, text: impl Into<String>, pct: Option<f64>) {
    let _ = app.emit(INSTALL_PROGRESS, Progress { part: part.into(), text: text.into(), pct });
}

pub fn has_ue4ss(dir: &Path) -> bool {
    let w = dir.join(WIN64);
    w.join("dwmapi.dll").exists() && w.join(r"ue4ss\UE4SS.dll").exists()
}

pub fn has_pal_defender(dir: &Path) -> bool {
    let w = dir.join(WIN64);
    w.join("PalDefender.dll").exists() && w.join("d3d9.dll").exists()
}

/// PalDefender's REST is turned on (its settings say so)
pub fn pd_rest_enabled(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join(PD_REST_DIR).join("RESTConfig.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim_start_matches('\u{feff}')).ok())
        .and_then(|v| v.get("Enabled").and_then(|e| e.as_bool()))
        .unwrap_or(false)
}

async fn download(app: &AppHandle, part: &str, name: &str, url: &str) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;
    let res = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "Overpal")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("{name}을(를) 받지 못했습니다: {e}"))?;
    let total = res.content_length();
    let mut buf = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut stream = res.bytes_stream();
    let mut last = -1.0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("{name}을(를) 받다가 끊겼습니다: {e}"))?;
        buf.extend_from_slice(&chunk);
        if let Some(t) = total.filter(|t| *t > 0) {
            let pct = (buf.len() as f64 / t as f64 * 100.0).floor();
            if pct > last {
                last = pct;
                emit(app, part, format!("{name} 받는 중... ({:.1}MB)", t as f64 / 1_048_576.0), Some(pct));
            }
        }
    }
    Ok(buf)
}

/// Unpacks a zip into `dest` (entries outside it are skipped). Returns how many files.
fn unzip_into(bytes: &[u8], dest: &Path) -> Result<usize, String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("압축을 열 수 없습니다: {e}"))?;
    let mut n = 0;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = f.enclosed_name() else { continue };
        let out = dest.join(rel);
        if f.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut w = std::fs::File::create(&out).map_err(|e| format!("{}에 쓸 수 없습니다: {e}", out.display()))?;
        std::io::copy(&mut f, &mut w).map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

/// Turns on PalDefender's REST (on this PC only) and gives Overpal a token, keeping what is there.
fn enable_pd_rest(dir: &Path) -> Result<(), String> {
    let rest = dir.join(PD_REST_DIR);
    std::fs::create_dir_all(rest.join("Tokens")).map_err(|e| e.to_string())?;
    let cfg_path = rest.join("RESTConfig.json");
    let mut cfg = std::fs::read_to_string(&cfg_path)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_else(|| {
            // as PalDefender writes it (v1.9.3)
            serde_json::json!({
                "Version": 3,
                "Enabled": true,
                "LogConsole": false,
                "Address": "127.0.0.1",
                "Port": DEFAULT_PD_PORT,
                "DefaultPermissions": [],
                "Cors": { "Comment": "Do not change those unless you know what you are doing!", "Allowed-Origins": "*", "Max-Age": 86400 }
            })
        });
    cfg["Enabled"] = serde_json::Value::Bool(true);
    if cfg.get("Port").and_then(|p| p.as_u64()).is_none() {
        cfg["Port"] = DEFAULT_PD_PORT.into();
    }
    if cfg.get("Address").and_then(|a| a.as_str()).is_none() {
        cfg["Address"] = "127.0.0.1".into();
    }
    std::fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    // a token of Overpal's own, unless there is one already
    if !crate::profiles::detect_server(dir).has_pal_defender_token {
        let token = serde_json::json!({ "Name": "overpal", "Token": crate::profiles::new_token(), "Permissions": "REST.*" });
        std::fs::write(rest.join("Tokens").join("overpal.json"), serde_json::to_string_pretty(&token).unwrap()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Installs the asked parts ("ue4ss", "paldefender", "pdrest") into the server folder, in that
/// order; stops at the first failure. Returns the parts installed.
pub async fn install(app: &AppHandle, dir: &Path, parts: &[String]) -> Result<Vec<String>, String> {
    if !dir.join("PalServer.exe").exists() {
        return Err("게임 서버 폴더가 아닙니다 (PalServer.exe가 없습니다).".into());
    }
    if crate::gameserver::is_running(dir) {
        return Err("게임 서버가 켜져 있어 설치할 수 없습니다. 서버를 끈 뒤 다시 시도해 주세요.".into());
    }
    let win64 = dir.join(WIN64);
    let mut done = Vec::new();
    for part in ["ue4ss", "paldefender", "pdrest"] {
        if !parts.iter().any(|p| p == part) {
            continue;
        }
        match part {
            "ue4ss" => {
                let zip = download(app, part, "UE4SS", UE4SS_URL).await?;
                emit(app, part, "UE4SS 압축 푸는 중...", None);
                unzip_into(&zip, &win64)?;
                applog::info(Kind::Conn, format!("UE4SS({UE4SS_VERSION})를 설치했습니다."));
            }
            "paldefender" => {
                let zip = download(app, part, "PalDefender", PD_URL).await?;
                emit(app, part, "PalDefender 압축 푸는 중...", None);
                unzip_into(&zip, &win64)?;
                applog::info(Kind::Conn, format!("PalDefender({PD_VERSION})를 설치했습니다."));
            }
            _ => {
                emit(app, part, "PalDefender REST 설정 중...", None);
                enable_pd_rest(dir)?;
                applog::info(Kind::Conn, "PalDefender REST를 켜고 Overpal 토큰을 만들었습니다.");
            }
        }
        done.push(part.to_string());
        emit(app, part, "완료", Some(100.0));
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turns_rest_on_keeping_what_is_there() {
        let d = std::env::temp_dir().join(format!("overpal-pd-{}", crate::profiles::new_token()));
        let rest = d.join(PD_REST_DIR);
        std::fs::create_dir_all(&rest).unwrap();
        // no settings yet: written in full, a token made
        enable_pd_rest(&d).unwrap();
        assert!(pd_rest_enabled(&d));
        assert!(crate::profiles::detect_server(&d).has_pal_defender_token);
        // settings PalDefender wrote, turned off, another port: only turned on
        std::fs::write(rest.join("RESTConfig.json"), "\u{feff}{\"Version\":3,\"Enabled\":false,\"Port\":18000,\"Address\":\"0.0.0.0\"}").unwrap();
        enable_pd_rest(&d).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(rest.join("RESTConfig.json")).unwrap()).unwrap();
        assert_eq!((v["Enabled"].as_bool(), v["Port"].as_u64(), v["Address"].as_str()), (Some(true), Some(18000), Some("0.0.0.0")));
        // one token only
        assert_eq!(std::fs::read_dir(rest.join("Tokens")).unwrap().count(), 1);
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn unzips_inside_the_folder_only() {
        use std::io::Write;
        let mut buf = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let o: zip::write::SimpleFileOptions = Default::default();
            z.start_file("dwmapi.dll", o).unwrap();
            z.write_all(b"a").unwrap();
            z.start_file("ue4ss/UE4SS.dll", o).unwrap();
            z.write_all(b"b").unwrap();
            z.start_file("../outside.txt", o).unwrap();
            z.write_all(b"c").unwrap();
            z.finish().unwrap();
        }
        let d = std::env::temp_dir().join(format!("overpal-zip-{}", crate::profiles::new_token()));
        assert_eq!(unzip_into(&buf, &d.join("in")).unwrap(), 2);
        assert!(d.join(r"in\ue4ss\UE4SS.dll").exists());
        assert!(!d.join("outside.txt").exists());
        std::fs::remove_dir_all(d).unwrap();
    }
}
