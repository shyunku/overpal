//! The game server's settings (the OptionSettings line of PalWorldSettings.ini) for the game server
//! tab: read with the server's own defaults (DefaultPalWorldSettings.ini), and the changed ones
//! written back while the server is off. Mock: docs/designs/server-settings-mock.html.

use serde::Serialize;
use std::path::Path;

pub const SETTINGS: &str = r"Pal\Saved\Config\WindowsServer\PalWorldSettings.ini";
const TEMPLATE: &str = "DefaultPalWorldSettings.ini";
const GAME_USER_SETTINGS: &str = r"Pal\Saved\Config\WindowsServer\GameUserSettings.ini";
/// ports and REST: Overpal sets these from its own settings, changing them here would cut it off
pub const MANAGED: [&str; 3] = ["PublicPort", "RESTAPIEnabled", "RESTAPIPort"];

/// One entry of the OptionSettings line: its key and where its value is, in the line.
struct Entry {
    key: String,
    value: std::ops::Range<usize>,
}

/// The entries of an OptionSettings line, given from just after "OptionSettings=(". Values may be
/// quoted (commas inside) or in parentheses (lists like `(Steam,Xbox)`).
fn entries(line: &str) -> Vec<Entry> {
    let b = line.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let key_start = i;
        while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
            i += 1;
        }
        if i == key_start || i >= b.len() || b[i] != b'=' {
            break;
        }
        let key = line[key_start..i].to_string();
        i += 1;
        let vstart = i;
        let mut quoted = false;
        let mut depth = 0;
        while i < b.len() {
            match b[i] {
                b'"' => quoted = !quoted,
                b'(' if !quoted => depth += 1,
                b')' if !quoted && depth > 0 => depth -= 1,
                b',' | b')' if !quoted && depth == 0 => break,
                _ => {}
            }
            i += 1;
        }
        out.push(Entry { key, value: vstart..i });
        // past the "," (another entry follows) or at the closing ")"
        if i < b.len() && b[i] == b',' {
            i += 1;
        } else {
            break;
        }
    }
    out
}

/// where the OptionSettings line's entries start and end in the ini
fn option_line(ini: &str) -> Option<(usize, usize)> {
    let open = ini.find("OptionSettings=(")? + "OptionSettings=(".len();
    let end = open + ini[open..].find(['\r', '\n']).unwrap_or(ini.len() - open);
    Some((open, end))
}

/// The settings as (key, value as written), in the file's order.
pub fn options(ini: &str) -> Vec<(String, String)> {
    let Some((open, end)) = option_line(ini) else { return Vec::new() };
    let line = &ini[open..end];
    entries(line).into_iter().map(|e| (e.key, line[e.value].to_string())).collect()
}

/// Sets `key` in the OptionSettings line to `value` (already formatted: quoted for text),
/// replacing its value or adding the key.
pub fn set_option(ini: &str, key: &str, value: &str) -> Result<String, String> {
    let (open, end) = option_line(ini).ok_or("설정 파일에 OptionSettings가 없습니다.")?;
    let line = &ini[open..end];
    match entries(line).into_iter().find(|e| e.key == key) {
        Some(e) => Ok(format!("{}{}{}", &ini[..open + e.value.start], value, &ini[open + e.value.end..])),
        None => Ok(format!("{}{key}={value},{}", &ini[..open], &ini[open..])),
    }
}

/// What was typed, written the way the default is (`like`): True/False, "text", a float with six
/// decimals, a whole number, a (list), or as it is (Item, None...).
fn normalize(key: &str, input: &str, like: &str) -> Result<String, String> {
    let input = input.trim().replace(['\r', '\n'], "");
    let like = like.trim();
    let bad_number = || format!("{key}: 숫자를 입력해 주세요.");
    if like.eq_ignore_ascii_case("true") || like.eq_ignore_ascii_case("false") {
        return match input.to_ascii_lowercase().as_str() {
            "true" => Ok("True".into()),
            "false" => Ok("False".into()),
            _ => Err(format!("{key}: True 또는 False여야 합니다.")),
        };
    }
    if like.starts_with('"') {
        return Ok(format!("\"{}\"", input.trim_matches('"').replace('"', "")));
    }
    if like.starts_with('(') {
        let inner = input.trim_start_matches('(').trim_end_matches(')');
        return Ok(format!("({inner})"));
    }
    if like.parse::<i64>().is_ok() {
        return input.parse::<i64>().map(|n| n.to_string()).map_err(|_| bad_number());
    }
    if like.parse::<f64>().is_ok() {
        return input.parse::<f64>().ok().filter(|n| n.is_finite()).map(|n| format!("{n:.6}")).ok_or_else(bad_number);
    }
    if input.contains([',', ')', '"']) && !input.starts_with('(') {
        return Err(format!("{key}: 쉼표·괄호·따옴표는 넣을 수 없습니다."));
    }
    Ok(input)
}

/// The world this server runs (its folder under SaveGames) has its own settings file, which the
/// server uses instead of most of PalWorldSettings.ini.
fn has_world_option(dir: &Path) -> bool {
    let Ok(gus) = std::fs::read_to_string(dir.join(GAME_USER_SETTINGS)) else { return false };
    let Some(world) = gus.lines().find_map(|l| l.trim().strip_prefix("DedicatedServerName=")).map(str::trim).filter(|w| !w.is_empty()) else {
        return false;
    };
    dir.join(r"Pal\Saved\SaveGames\0").join(world).join("WorldOption.sav").exists()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opt {
    key: String,
    /// as the server's template has it; None for a key only the server's file has
    default: Option<String>,
    /// as the server's settings have it; None when they do not set it (the default applies)
    value: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettings {
    options: Vec<Opt>,
    /// PalWorldSettings.ini is there with settings in it
    has_file: bool,
    world_option: bool,
    running: bool,
    managed: Vec<String>,
}

pub fn read(dir: &Path) -> ServerSettings {
    let defaults = std::fs::read_to_string(dir.join(TEMPLATE)).map(|t| options(&t)).unwrap_or_default();
    let current = std::fs::read_to_string(dir.join(SETTINGS)).map(|t| options(&t)).unwrap_or_default();
    let mut list: Vec<Opt> = defaults
        .iter()
        .map(|(k, d)| Opt { key: k.clone(), default: Some(d.clone()), value: current.iter().find(|(c, _)| c == k).map(|(_, v)| v.clone()) })
        .collect();
    for (k, v) in &current {
        if !defaults.iter().any(|(d, _)| d == k) {
            list.push(Opt { key: k.clone(), default: None, value: Some(v.clone()) });
        }
    }
    ServerSettings {
        options: list,
        has_file: !current.is_empty(),
        world_option: has_world_option(dir),
        running: crate::gameserver::is_running(dir),
        managed: MANAGED.iter().map(|s| s.to_string()).collect(),
    }
}

/// Writes the changed settings (key, what was typed). A server without its settings file gets one
/// from its template first; what is not changed stays as it is.
pub fn write(dir: &Path, changes: &[(String, String)]) -> Result<(), String> {
    if crate::gameserver::is_running(dir) {
        return Err("게임 서버가 켜져 있어 설정을 바꿀 수 없습니다. 끈 뒤 다시 시도해 주세요.".into());
    }
    if let Some((k, _)) = changes.iter().find(|(k, _)| MANAGED.contains(&k.as_str())) {
        return Err(format!("{k}는 Overpal 설정 탭에서 바꿉니다."));
    }
    let template = std::fs::read_to_string(dir.join(TEMPLATE)).unwrap_or_default();
    let defaults = options(&template);
    let path = dir.join(SETTINGS);
    let mut ini = match std::fs::read_to_string(&path) {
        Ok(t) if option_line(&t).is_some() => t,
        _ if option_line(&template).is_some() => template.clone(),
        _ => return Err("서버의 기본 설정 파일(DefaultPalWorldSettings.ini)이 없습니다.".into()),
    };
    let current = options(&ini);
    for (k, input) in changes {
        let like = defaults.iter().chain(current.iter()).find(|(d, _)| d == k).map(|(_, v)| v.as_str()).unwrap_or("");
        ini = set_option(&ini, k, &normalize(k, input, like)?)?;
    }
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, ini).map_err(|e| format!("설정 파일을 쓸 수 없습니다: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINE: &str = "[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=(Difficulty=None,ExpRate=1.000000,ServerName=\"a, b\",CrossplayPlatforms=(Steam,Xbox,PS5,Mac),ServerPlayerMaxNum=32,DenyTechnologyList=,bIsPvP=False)\r\n";

    #[test]
    fn reads_quoted_and_listed_values() {
        let o = options(LINE);
        let get = |k: &str| o.iter().find(|(x, _)| x == k).map(|(_, v)| v.as_str());
        assert_eq!(o.len(), 7);
        assert_eq!(get("ServerName"), Some("\"a, b\""));
        assert_eq!(get("CrossplayPlatforms"), Some("(Steam,Xbox,PS5,Mac)"));
        assert_eq!(get("DenyTechnologyList"), Some(""));
        assert_eq!(get("bIsPvP"), Some("False"));
    }

    #[test]
    fn sets_a_value_keeping_the_rest() {
        let s = set_option(LINE, "CrossplayPlatforms", "(Steam)").unwrap();
        assert!(s.contains("CrossplayPlatforms=(Steam),ServerPlayerMaxNum=32,"), "{s}");
        let s = set_option(&s, "DenyTechnologyList", "X").unwrap();
        assert!(s.contains("DenyTechnologyList=X,bIsPvP=False)\r\n"), "{s}");
        let s = set_option(&s, "bIsPvP", "True").unwrap();
        assert!(s.ends_with("bIsPvP=True)\r\n"), "{s}");
        let s = set_option(&s, "NewKey", "1").unwrap();
        assert!(s.contains("OptionSettings=(NewKey=1,Difficulty=None"), "{s}");
        assert_eq!(options(&s).len(), 8);
    }

    #[test]
    fn writes_values_the_way_the_default_is() {
        assert_eq!(normalize("ExpRate", "2.5", "1.000000").unwrap(), "2.500000");
        assert!(normalize("ExpRate", "abc", "1.000000").is_err());
        assert_eq!(normalize("ServerPlayerMaxNum", " 20 ", "32").unwrap(), "20");
        assert!(normalize("ServerPlayerMaxNum", "2.5", "32").is_err());
        assert_eq!(normalize("bIsPvP", "true", "False").unwrap(), "True");
        assert_eq!(normalize("ServerName", "우리 \"서버\"", "\"Default Palworld Server\"").unwrap(), "\"우리 서버\"");
        assert_eq!(normalize("CrossplayPlatforms", "Steam,Xbox", "(Steam,Xbox,PS5,Mac)").unwrap(), "(Steam,Xbox)");
        assert_eq!(normalize("DeathPenalty", "All", "Item").unwrap(), "All");
        assert!(normalize("DeathPenalty", "All,x", "Item").is_err());
    }

    #[test]
    fn writes_into_the_server_folder() {
        let d = std::env::temp_dir().join(format!("overpal-settings-{}", crate::profiles::new_token()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(TEMPLATE), LINE).unwrap();
        // no settings file yet: everything is the default
        let r = read(&d);
        assert!(!r.has_file && r.options.iter().all(|o| o.value.is_none()));
        // made from the template, the change in it
        write(&d, &[("ExpRate".into(), "3".into())]).unwrap();
        let ini = std::fs::read_to_string(d.join(SETTINGS)).unwrap();
        assert!(ini.contains("ExpRate=3.000000,ServerName=\"a, b\""), "{ini}");
        // its own file: only the change, the rest as it was
        std::fs::write(d.join(SETTINGS), "OptionSettings=(ExpRate=2.000000,ServerName=\"mine\",RESTAPIPort=8212)\n").unwrap();
        write(&d, &[("ServerName".into(), "new".into())]).unwrap();
        assert_eq!(std::fs::read_to_string(d.join(SETTINGS)).unwrap(), "OptionSettings=(ExpRate=2.000000,ServerName=\"new\",RESTAPIPort=8212)\n");
        assert!(write(&d, &[("RESTAPIPort".into(), "1".into())]).is_err());
        let r = read(&d);
        assert!(r.has_file && r.options.iter().any(|o| o.key == "RESTAPIPort" && o.default.is_none()));
        std::fs::remove_dir_all(d).unwrap();
    }
}
