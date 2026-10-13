use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const CONFIG_FILE_NAME: &str = "palhelper.config.json";
pub const CONFIG_ENV: &str = "PALHELPER_CONFIG";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// HTTP API only, no window
    Server,
    /// overlay only, connects to a remote server
    Client,
    /// HTTP API and overlay in one process
    Both,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "server" => Some(Mode::Server),
            "client" => Some(Mode::Client),
            "both" => Some(Mode::Both),
            _ => None,
        }
    }

    pub fn has_server(self) -> bool {
        matches!(self, Mode::Server | Mode::Both)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PalDefenderConfig {
    /// e.g. http://127.0.0.1:17993
    pub url: String,
    /// file containing the PalDefender REST bearer token
    #[serde(default)]
    pub token_file: Option<PathBuf>,
    /// the token itself (profiles read it from PalDefender's own config); wins over token_file
    #[serde(default)]
    pub token: Option<String>,
}

impl PalDefenderConfig {
    pub fn read_token(&self) -> Result<String, String> {
        if let Some(t) = &self.token {
            return Ok(t.clone());
        }
        let path = self.token_file.as_ref().ok_or("no PalDefender token or token file")?;
        std::fs::read_to_string(path).map(|t| t.trim().to_string()).map_err(|e| format!("cannot read PalDefender token file {}: {e}", path.display()))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    /// e.g. 127.0.0.1:17994
    pub listen: String,
    /// PalHelperMod folder inside the server's ue4ss/Mods
    pub mod_output_dir: PathBuf,
    pub pal_defender: Option<PalDefenderConfig>,
    /// bearer tokens accepted by this server; the first one is the host's own
    pub access_tokens: Vec<String>,
    /// friend name per token, for the host's status and log
    #[serde(default)]
    pub token_names: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    /// e.g. http://127.0.0.1:17994
    pub server_url: String,
    pub token: String,
    /// whose position the minimap follows; the first online player when missing
    #[serde(default)]
    pub player_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub mode: Mode,
    pub server: Option<ServerConfig>,
    pub client: Option<ClientConfig>,
}

impl Config {
    /// Client settings, falling back to this process's own server in `both` mode.
    pub fn effective_client(&self, mode: Mode) -> Option<ClientConfig> {
        if let Some(c) = &self.client {
            return Some(c.clone());
        }
        if mode == Mode::Both {
            let s = self.server.as_ref()?;
            return Some(ClientConfig {
                server_url: format!("http://{}", s.listen),
                token: s.access_tokens.first()?.clone(),
                player_name: None,
            });
        }
        None
    }
}

/// The config file of this run, if any: `--config <path>`, then $PALHELPER_CONFIG, then the file
/// next to the executable. None means the app starts with the profile window.
pub fn find_path(cli_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = cli_path {
        return Some(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var(CONFIG_ENV) {
        return Some(PathBuf::from(p));
    }
    let p = std::env::current_exe().ok()?.parent()?.join(CONFIG_FILE_NAME);
    p.exists().then_some(p)
}

pub fn load(path: &Path) -> Result<Config, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("invalid {}: {e}", path.display()))
}
