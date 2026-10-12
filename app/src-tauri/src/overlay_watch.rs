//! Decides when and where the overlay is shown and when it takes the mouse.
//! - shown while the game (or the overlay) is in front; hidden when the game is minimized or
//!   closed, or when another window is in front on the game's monitor (a window in front on
//!   another monitor keeps the overlay up)
//! - placed on the game's monitor
//! - click-through unless the game shows a cursor (ESC menu, inventory), so moving the
//!   hidden in-game cursor over an overlay window does not make an arrow appear

use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub const OVERLAY_STATE: &str = "overlay-state";
const GAME_EXE: &str = "palworld-win64-shipping.exe";
const POLL: Duration = Duration::from_millis(80);
/// the state is re-sent this often so a window that missed the change event catches up
const RESEND_EVERY: u32 = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct OverlayState {
    pub visible: bool,
    pub interactive: bool,
    /// monitor of the game window, in physical px
    pub monitor: Option<MonitorRect>,
}

pub struct CurrentState(Mutex<OverlayState>);

/// State for windows that start after the last change event.
#[tauri::command]
pub fn overlay_state(state: tauri::State<'_, CurrentState>) -> OverlayState {
    *state.0.lock().unwrap()
}

/// Must run before the overlay windows are created: they ask for the state as soon as they load.
pub fn init(app: &AppHandle, always_show: bool) {
    app.manage(CurrentState(Mutex::new(OverlayState { visible: always_show, interactive: false, monitor: None })));
}

/// Starts watching; call after the overlay windows exist so the first state reaches them.
pub fn spawn(app: &AppHandle, labels: &'static [&'static str], always_show: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last: Option<OverlayState> = None;
        let mut game = GameWindow::default();
        let mut ticks = 0u32;
        // development: keep the overlay click-through to check how it renders in that state
        let force_click_through = std::env::var("PALHELPER_FORCE_CLICK_THROUGH").is_ok();
        loop {
            let mut s = sample(always_show, &mut game);
            if force_click_through {
                s.interactive = false;
            }
            if last != Some(s) {
                for label in labels {
                    if let Some(w) = app.get_webview_window(label) {
                        let _ = w.set_ignore_cursor_events(!s.interactive);
                    }
                }
                *app.state::<CurrentState>().0.lock().unwrap() = s;
                last = Some(s);
                ticks = RESEND_EVERY;
            }
            if ticks >= RESEND_EVERY {
                let _ = app.emit(OVERLAY_STATE, s);
                ticks = 0;
            }
            ticks += 1;
            std::thread::sleep(POLL);
        }
    });
}

/// The game's main window, found once and re-searched only when it goes away.
#[derive(Default)]
struct GameWindow {
    /// window handle and owning process id
    found: Option<(isize, u32)>,
    ticks_since_search: u32,
}

/// how often to look for the game window while it is not found (in polls)
const SEARCH_EVERY: u32 = 12;

#[cfg(windows)]
fn sample(always_show: bool, game: &mut GameWindow) -> OverlayState {
    if game.found.is_some_and(|(h, _)| !win::is_window(h)) {
        game.found = None;
    }
    if game.found.is_none() {
        game.ticks_since_search += 1;
        if game.ticks_since_search >= SEARCH_EVERY {
            game.ticks_since_search = 0;
            game.found = win::find_window_of_exe(GAME_EXE);
        }
    }
    let Some((hwnd, game_pid)) = game.found else {
        return OverlayState { visible: always_show, interactive: always_show && win::cursor_showing(), monitor: None };
    };
    let monitor = win::monitor_rect(hwnd);
    let visible = always_show || (!win::is_minimized(hwnd) && game_or_other_monitor_in_front(hwnd, game_pid));
    OverlayState { visible, interactive: visible && win::cursor_showing(), monitor }
}

#[cfg(windows)]
fn game_or_other_monitor_in_front(game: isize, game_pid: u32) -> bool {
    let Some(fg) = win::foreground() else {
        // nothing in front for a moment (e.g. while switching windows): keep the overlay
        return true;
    };
    let pid = win::pid_of(fg);
    if fg == game || pid == game_pid || pid == std::process::id() {
        return true;
    }
    win::monitor_of(fg) != win::monitor_of(game)
}

#[cfg(not(windows))]
fn sample(_always_show: bool, _game: &mut GameWindow) -> OverlayState {
    OverlayState { visible: true, interactive: true, monitor: None }
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
    use super::MonitorRect;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CURSOR_SHOWING, CURSORINFO, EnumWindows, GetCursorInfo, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindow,
        IsWindowVisible,
    };

    /// False while the window under the cursor hides it (in-game camera control).
    pub fn cursor_showing() -> bool {
        unsafe {
            let mut ci: CURSORINFO = std::mem::zeroed();
            ci.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
            if GetCursorInfo(&mut ci) == 0 {
                return true;
            }
            ci.flags & CURSOR_SHOWING != 0 && !ci.hCursor.is_null()
        }
    }

    pub fn is_window(h: isize) -> bool {
        unsafe { IsWindow(h as HWND) != 0 }
    }

    pub fn is_minimized(h: isize) -> bool {
        unsafe { IsIconic(h as HWND) != 0 }
    }

    pub fn foreground() -> Option<isize> {
        let h = unsafe { GetForegroundWindow() };
        (!h.is_null()).then_some(h as isize)
    }

    pub fn pid_of(h: isize) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h as HWND, &mut pid) };
        pid
    }

    /// Monitor handle the window is (mostly) on.
    pub fn monitor_of(h: isize) -> isize {
        unsafe { MonitorFromWindow(h as HWND, MONITOR_DEFAULTTONEAREST) as isize }
    }

    pub fn monitor_rect(h: isize) -> Option<MonitorRect> {
        unsafe {
            let m = MonitorFromWindow(h as HWND, MONITOR_DEFAULTTONEAREST);
            let mut mi: MONITORINFO = std::mem::zeroed();
            mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(m, &mut mi) == 0 {
                return None;
            }
            let r = mi.rcMonitor;
            Some(MonitorRect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top })
        }
    }

    /// First visible top-level window owned by a process with this (lowercase) exe name,
    /// with the process id.
    pub fn find_window_of_exe(exe: &str) -> Option<(isize, u32)> {
        struct Search<'a> {
            exe: &'a str,
            found: Option<(isize, u32)>,
            checked: Vec<(u32, bool)>,
        }
        unsafe extern "system" fn visit(h: HWND, data: LPARAM) -> i32 {
            let s = unsafe { &mut *(data as *mut Search) };
            if unsafe { IsWindowVisible(h) } == 0 {
                return 1;
            }
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(h, &mut pid) };
            let is_game = match s.checked.iter().find(|(p, _)| *p == pid) {
                Some((_, g)) => *g,
                None => {
                    let g = exe_name(pid).is_some_and(|n| n == s.exe);
                    s.checked.push((pid, g));
                    g
                }
            };
            if is_game {
                s.found = Some((h as isize, pid));
                return 0;
            }
            1
        }
        let mut s = Search { exe, found: None, checked: Vec::new() };
        unsafe { EnumWindows(Some(visit), &mut s as *mut Search as LPARAM) };
        s.found
    }

    /// Lowercase file name of the process executable.
    pub fn exe_name(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
            CloseHandle(h);
            if ok == 0 {
                return None;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            path.rsplit('\\').next().map(|s| s.to_ascii_lowercase())
        }
    }
}
