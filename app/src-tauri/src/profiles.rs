//! Profiles: named sets of settings with a start mode, kept in `<app config dir>\profiles\<name>.json`
//! (%APPDATA%\com.overpal.app). The app picks one at start and turns it into the same
//! `Config` an overpal.config.json gives. Friends of a profile get their own token and a folder
//! with the exe and a client config (`<app config dir>\friends\<name>`).

use crate::config::{ClientConfig, Config, Mode, PalDefenderConfig, ServerConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const DEFAULT_PORT: u16 = 17994;
/// where the mod writes its output, inside a dedicated server folder
const MOD_DIR: &str = r"Pal\Binaries\Win64\ue4ss\Mods\OverpalMod";
/// the mod's folder before the rename to Overpal (servers not redeployed since)
const OLD_MOD_DIR: &str = r"Pal\Binaries\Win64\ue4ss\Mods\PalHelperMod";

/// The mod folder of a server: the new name, or the old one while only that is installed.
pub fn mod_dir(server: &Path) -> PathBuf {
    let new = server.join(MOD_DIR);
    let old = server.join(OLD_MOD_DIR);
    if !new.is_dir() && old.is_dir() { old } else { new }
}
/// PalDefender's REST settings inside a dedicated server folder
const PD_DIR: &str = r"Pal\Binaries\Win64\PalDefender\RESTAPI";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StartMode {
    /// pick the mode every time
    Ask,
    Server,
    Client,
    Both,
}

impl StartMode {
    pub fn mode(self) -> Option<Mode> {
        match self {
            StartMode::Ask => None,
            StartMode::Server => Some(Mode::Server),
            StartMode::Client => Some(Mode::Client),
            StartMode::Both => Some(Mode::Both),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerProfile {
    /// the dedicated server folder (has PalServer.exe)
    pub game_server_dir: PathBuf,
    /// listen on all addresses (friends reach it through port forwarding) instead of this PC only
    pub allow_external: bool,
    pub port: u16,
    /// game port (UDP), passed as -port= when Overpal starts the server; None: the server's default (8211)
    #[serde(default)]
    pub game_port: Option<u16>,
    /// Steam query port (UDP), passed as -QueryPort=; None: the default (27015)
    #[serde(default)]
    pub query_port: Option<u16>,
    /// the server's REST port (PalWorldSettings.ini RESTAPIPort), written there on save
    #[serde(default)]
    pub rest_port: Option<u16>,
    /// PalDefender's REST port (RESTConfig.json Port), written there on save
    #[serde(default)]
    pub pd_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientProfile {
    /// the app server to connect to, e.g. http://203.0.113.24:17994
    pub server_url: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub name: String,
    /// game nickname, so their minimap follows them
    pub nickname: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub start_mode: StartMode,
    /// unix seconds
    #[serde(default)]
    pub last_used: Option<u64>,
    #[serde(default)]
    pub server: Option<ServerProfile>,
    #[serde(default)]
    pub client: Option<ClientProfile>,
    /// whose position the overlay follows (game nickname)
    #[serde(default)]
    pub player_name: Option<String>,
    /// the host's own token for its server (overlay in both mode, Home status)
    #[serde(default)]
    pub host_token: Option<String>,
    #[serde(default)]
    pub friends: Vec<Friend>,
}

impl Profile {
    pub fn new(name: &str) -> Profile {
        Profile { name: name.to_string(), start_mode: StartMode::Ask, last_used: None, server: None, client: None, player_name: None, host_token: None, friends: Vec::new() }
    }

    /// Whether the profile has what the mode needs.
    pub fn ready_for(&self, mode: Mode) -> bool {
        match mode {
            Mode::Server | Mode::Both => self.server.is_some(),
            Mode::Client => self.client.as_ref().is_some_and(|c| !c.server_url.is_empty() && !c.token.is_empty()),
        }
    }

    /// The runtime config for a mode. A missing host token is made here (callers save the profile).
    pub fn to_config(&mut self, mode: Mode) -> Result<Config, String> {
        let server = match mode {
            Mode::Server | Mode::Both => {
                let sp = self.server.clone().ok_or("서버 설정이 없습니다.")?;
                let host = self.host_token.get_or_insert_with(new_token).clone();
                let found = detect_server(&sp.game_server_dir);
                let mut tokens = vec![host];
                let mut names = HashMap::new();
                for f in &self.friends {
                    tokens.push(f.token.clone());
                    names.insert(f.token.clone(), f.name.clone());
                }
                Some(ServerConfig {
                    listen: format!("{}:{}", if sp.allow_external { "0.0.0.0" } else { "127.0.0.1" }, sp.port),
                    mod_output_dir: mod_dir(&sp.game_server_dir),
                    pal_defender: found.pal_defender_url.map(|url| PalDefenderConfig { url, token_file: None, token: found.pal_defender_token }),
                    access_tokens: tokens,
                    token_names: names,
                })
            }
            Mode::Client => None,
        };
        let client = match mode {
            Mode::Client => {
                let c = self.client.clone().ok_or("접속할 앱 서버 설정이 없습니다.")?;
                Some(ClientConfig { server_url: c.server_url, token: c.token, player_name: self.player_name.clone() })
            }
            Mode::Both => {
                let s = server.as_ref().unwrap();
                Some(ClientConfig { server_url: format!("http://127.0.0.1:{}", s.listen.rsplit(':').next().unwrap_or("17994")), token: s.access_tokens[0].clone(), player_name: self.player_name.clone() })
            }
            Mode::Server => None,
        };
        Ok(Config { mode, server, client })
    }
}

/// What was found in a dedicated server folder.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    pub has_server: bool,
    pub has_mod: bool,
    pub pal_defender_url: Option<String>,
    #[serde(skip)]
    pub pal_defender_token: Option<String>,
    pub has_pal_defender_token: bool,
    /// RESTAPIPort in PalWorldSettings.ini
    pub rest_port: Option<u16>,
    /// Port in PalDefender's RESTConfig.json
    pub pd_port: Option<u16>,
}

pub fn detect_server(dir: &Path) -> Detected {
    let mut d = Detected { has_server: dir.join("PalServer.exe").exists(), has_mod: mod_dir(dir).is_dir(), ..Default::default() };
    let pd = dir.join(PD_DIR);
    if let Ok(text) = std::fs::read_to_string(pd.join("RESTConfig.json")) {
        let port = serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}')).ok().and_then(|v| v.get("Port").and_then(|p| p.as_u64()));
        d.pal_defender_url = port.map(|p| format!("http://127.0.0.1:{p}"));
        d.pd_port = port.and_then(|p| u16::try_from(p).ok());
    }
    // any token file PalDefender accepts
    if let Ok(entries) = std::fs::read_dir(pd.join("Tokens")) {
        for e in entries.flatten() {
            let token = std::fs::read_to_string(e.path())
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim_start_matches('\u{feff}')).ok())
                .and_then(|v| v.get("Token").and_then(|t| t.as_str()).map(str::to_string));
            if token.is_some() {
                d.pal_defender_token = token;
                break;
            }
        }
    }
    d.has_pal_defender_token = d.pal_defender_token.is_some();
    d.rest_port = crate::gameserver::rest_port(dir);
    d
}

/// Writes the REST ports of a profile into its server's files where they differ from what is there.
pub fn write_server_ports(sp: &ServerProfile) -> Result<(), String> {
    let dir = &sp.game_server_dir;
    let now = detect_server(dir);
    let rest = sp.rest_port.filter(|p| Some(*p) != now.rest_port);
    let pd = sp.pd_port.filter(|p| Some(*p) != now.pd_port);
    if rest.is_none() && pd.is_none() {
        return Ok(());
    }
    if crate::gameserver::is_running(dir) {
        return Err("게임 서버가 켜져 있어 포트를 바꿀 수 없습니다. 서버를 끈 뒤 저장해 주세요.".into());
    }
    if let Some(p) = rest {
        crate::gameserver::set_rest_port(dir, p)?;
    }
    if let Some(p) = pd {
        let path = dir.join(PD_DIR).join("RESTConfig.json");
        let text = std::fs::read_to_string(&path).map_err(|_| "PalDefender RESTConfig.json을 읽을 수 없습니다.".to_string())?;
        std::fs::write(&path, set_json_port(&text, p).ok_or("RESTConfig.json에서 Port를 찾지 못했습니다.")?).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The JSON text with the number after "Port" replaced (the rest of the file as it was).
fn set_json_port(text: &str, port: u16) -> Option<String> {
    let key = text.find("\"Port\"")? + 6;
    let colon = key + text[key..].find(':')? + 1;
    let start = colon + text[colon..].find(|c: char| c.is_ascii_digit())?;
    let end = start + text[start..].find(|c: char| !c.is_ascii_digit()).unwrap_or(text.len() - start);
    Some(format!("{}{}{}", &text[..start], port, &text[end..]))
}

/// A dedicated server found in a Steam library.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundServer {
    pub path: String,
    pub has_mod: bool,
    pub has_pal_defender: bool,
}

/// Dedicated servers in the Steam libraries (steamapps\common\PalServer), Steam's own folder first.
pub fn find_steam_servers() -> Vec<FoundServer> {
    let Some(steam) = steam_path() else { return Vec::new() };
    let mut libraries = vec![steam.clone()];
    if let Ok(text) = std::fs::read_to_string(steam.join(r"steamapps\libraryfolders.vdf")) {
        libraries.extend(library_paths(&text));
    }
    let mut seen = std::collections::HashSet::new();
    libraries
        .into_iter()
        .map(|lib| lib.join(r"steamapps\common\PalServer"))
        .filter(|dir| dir.join("PalServer.exe").exists())
        .filter(|dir| seen.insert(dir.to_string_lossy().to_lowercase()))
        .map(|dir| {
            let d = detect_server(&dir);
            FoundServer { path: dir.display().to_string(), has_mod: d.has_mod, has_pal_defender: d.pal_defender_url.is_some() && d.has_pal_defender_token }
        })
        .collect()
}

/// The `"path"` values of libraryfolders.vdf, where backslashes are doubled.
fn library_paths(vdf: &str) -> Vec<PathBuf> {
    vdf.lines()
        .filter_map(|l| {
            let l = l.trim();
            let rest = l.strip_prefix("\"path\"")?.trim();
            Some(PathBuf::from(rest.trim_matches('"').replace("\\\\", "\\")))
        })
        .collect()
}

#[cfg(windows)]
fn steam_path() -> Option<PathBuf> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_SZ, RegGetValueW};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let mut buf = [0u16; 1024];
    let mut len = (buf.len() * 2) as u32;
    let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, wide(r"Software\Valve\Steam").as_ptr(), wide("SteamPath").as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
    if r != 0 {
        return None;
    }
    let s = String::from_utf16_lossy(&buf[..(len as usize / 2).saturating_sub(1)]);
    Some(PathBuf::from(s.replace('/', "\\")))
}

#[cfg(not(windows))]
fn steam_path() -> Option<PathBuf> {
    None
}

/// A random 64-character hex token.
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    fill_random(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(windows)]
fn fill_random(buf: &mut [u8]) {
    use windows_sys::Win32::Security::Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom};
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), buf.as_mut_ptr(), buf.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    assert!(status == 0, "BCryptGenRandom failed");
}

#[cfg(not(windows))]
fn fill_random(buf: &mut [u8]) {
    use std::io::Read;
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(buf)).expect("no random source");
}

// ---------------------------------------------------------------- storage

pub struct Store {
    dir: PathBuf,
    friends_dir: PathBuf,
}

/// Profile names become file names: no path separators or characters Windows rejects.
pub fn valid_name(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty() && n.len() <= 60 && !n.chars().any(|c| r#"\/:*?"<>|"#.contains(c) || c.is_control()) && !n.ends_with('.')
}

impl Store {
    pub fn new(config_dir: &Path) -> Store {
        Store { dir: config_dir.join("profiles"), friends_dir: config_dir.join("friends") }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{name}.json"))
    }

    pub fn list(&self) -> Vec<Profile> {
        let mut out: Vec<Profile> = std::fs::read_dir(&self.dir)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
                    .filter_map(|e| std::fs::read_to_string(e.path()).ok())
                    .filter_map(|t| serde_json::from_str::<Profile>(&t).ok())
                    .collect()
            })
            .unwrap_or_default();
        // most recently used first
        out.sort_by(|a, b| b.last_used.cmp(&a.last_used).then_with(|| a.name.cmp(&b.name)));
        out
    }

    pub fn get(&self, name: &str) -> Option<Profile> {
        std::fs::read_to_string(self.path(name)).ok().and_then(|t| serde_json::from_str(&t).ok())
    }

    pub fn save(&self, p: &Profile) -> Result<(), String> {
        if !valid_name(&p.name) {
            return Err("프로필 이름에 쓸 수 없는 문자가 있습니다.".into());
        }
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
        std::fs::write(self.path(&p.name), text).map_err(|e| e.to_string())
    }

    pub fn delete(&self, name: &str) -> Result<(), String> {
        std::fs::remove_file(self.path(name)).map_err(|e| e.to_string())
    }

    pub fn friend_dir(&self, friend: &str) -> PathBuf {
        self.friends_dir.join(friend)
    }

    /// Writes the friend's folder: this exe and a client config pointing at `server_url`.
    pub fn write_friend_folder(&self, f: &Friend, server_url: &str) -> Result<PathBuf, String> {
        let dir = self.friend_dir(&f.name);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        std::fs::copy(&exe, dir.join("overpal.exe")).map_err(|e| format!("실행 파일을 복사할 수 없습니다: {e}"))?;
        let cfg = serde_json::json!({ "mode": "client", "client": { "serverUrl": server_url, "token": f.token, "playerName": f.nickname } });
        std::fs::write(dir.join(crate::config::CONFIG_FILE_NAME), serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
        Ok(dir)
    }
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("overpal-test-{tag}-{}", new_token()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn library_paths_from_vdf() {
        let vdf = "\"libraryfolders\"
{
	\"0\"
	{
		\"path\"		\"C:\\Program Files (x86)\\Steam\"
	}
	\"1\"
	{
		\"path\"		\"E:\\Games\\Steam\"
	}
}";
        assert_eq!(library_paths(vdf), vec![PathBuf::from(r"C:\Program Files (x86)\Steam"), PathBuf::from(r"E:\Games\Steam")]);
    }

    #[test]
    fn names() {
        assert!(valid_name("실제 서버"));
        assert!(!valid_name(""));
        assert!(!valid_name("a/b"));
        assert!(!valid_name("a:b"));
        assert!(!valid_name("dot."));
    }

    #[test]
    fn tokens_are_random_hex() {
        let a = new_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, new_token());
    }

    #[test]
    fn detects_mod_and_pal_defender() {
        let d = temp_dir("detect");
        std::fs::write(d.join("PalServer.exe"), "").unwrap();
        std::fs::create_dir_all(d.join(MOD_DIR)).unwrap();
        std::fs::create_dir_all(d.join(PD_DIR).join("Tokens")).unwrap();
        std::fs::write(d.join(PD_DIR).join("RESTConfig.json"), "\u{feff}{\"Port\": 17993}").unwrap();
        std::fs::write(d.join(PD_DIR).join("Tokens").join("a.json"), "{\"Token\": \"abc\"}").unwrap();
        let x = detect_server(&d);
        assert!(x.has_server && x.has_mod && x.has_pal_defender_token);
        assert_eq!(x.pal_defender_url.as_deref(), Some("http://127.0.0.1:17993"));
        assert_eq!(x.pal_defender_token.as_deref(), Some("abc"));
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn both_mode_config() {
        let mut p = Profile::new("t");
        assert!(!p.ready_for(Mode::Both));
        p.server = Some(ServerProfile { game_server_dir: PathBuf::from(r"E:\srv"), allow_external: true, port: 17995, game_port: None, query_port: None, rest_port: None, pd_port: None });
        p.player_name = Some("me".into());
        p.friends.push(Friend { name: "f".into(), nickname: "fn".into(), token: "ft".into() });
        assert!(p.ready_for(Mode::Both));
        let cfg = p.to_config(Mode::Both).unwrap();
        let s = cfg.server.unwrap();
        assert_eq!(s.listen, "0.0.0.0:17995");
        assert_eq!(s.mod_output_dir, PathBuf::from(r"E:\srv").join(MOD_DIR));
        // host token first (made and kept on the profile), then the friend's
        let host = p.host_token.clone().unwrap();
        assert_eq!(s.access_tokens, vec![host.clone(), "ft".to_string()]);
        assert_eq!(s.token_names.get("ft").map(String::as_str), Some("f"));
        let c = cfg.client.unwrap();
        assert_eq!(c.server_url, "http://127.0.0.1:17995");
        assert_eq!(c.token, host);
        assert_eq!(c.player_name.as_deref(), Some("me"));
        // the same host token next time
        assert_eq!(p.to_config(Mode::Server).unwrap().server.unwrap().access_tokens[0], host);
    }

    #[test]
    fn sets_pal_defender_port() {
        assert_eq!(set_json_port("\u{feff}{\n  \"Port\": 17993,\n  \"Enabled\": true\n}", 18993).unwrap(), "\u{feff}{\n  \"Port\": 18993,\n  \"Enabled\": true\n}");
        assert!(set_json_port("{}", 1).is_none());
    }

    #[test]
    fn client_mode_config() {
        let mut p = Profile::new("t");
        p.client = Some(ClientProfile { server_url: "http://1.2.3.4:17994".into(), token: "tok".into() });
        assert!(p.ready_for(Mode::Client) && !p.ready_for(Mode::Server));
        let cfg = p.to_config(Mode::Client).unwrap();
        assert!(cfg.server.is_none());
        assert_eq!(cfg.client.unwrap().token, "tok");
    }

    #[test]
    fn store_round_trip_and_friend_folder() {
        let d = temp_dir("store");
        let store = Store::new(&d);
        let mut p = Profile::new("실제 서버");
        p.last_used = Some(5);
        store.save(&p).unwrap();
        assert_eq!(store.get("실제 서버").unwrap().last_used, Some(5));
        assert_eq!(store.list().len(), 1);
        let f = Friend { name: "친구 1".into(), nickname: "nick".into(), token: "tok".into() };
        let dir = store.write_friend_folder(&f, "http://1.2.3.4:17994").unwrap();
        assert!(dir.join("overpal.exe").exists());
        let cfg: Config = serde_json::from_str(&std::fs::read_to_string(dir.join(crate::config::CONFIG_FILE_NAME)).unwrap()).unwrap();
        assert_eq!(cfg.mode, Mode::Client);
        let c = cfg.client.unwrap();
        assert_eq!((c.server_url.as_str(), c.token.as_str(), c.player_name.as_deref()), ("http://1.2.3.4:17994", "tok", Some("nick")));
        store.delete("실제 서버").unwrap();
        assert!(store.list().is_empty());
        std::fs::remove_dir_all(d).unwrap();
    }
}

/// Prints what auto-find sees on this PC: `cargo test --lib finds_on_this_pc -- --ignored --nocapture`.
#[cfg(test)]
#[test]
#[ignore]
fn finds_on_this_pc() {
    println!("steam: {:?}", steam_path());
    for s in find_steam_servers() {
        println!("{s:?}");
    }
}
