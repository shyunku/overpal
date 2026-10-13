//! Overlay windows and their persisted layout.
//! Rust only creates the windows and stores/broadcasts the layout JSON;
//! placement, sizing and rendering are done by each window in TS.

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LAYOUT_CHANGED: &str = "layout-changed";
/// Windows that take the mouse while the game shows a cursor. The minimap never does; its page
/// handles that itself (it only takes the mouse in edit mode).
pub const FOLLOW_CURSOR: [&str; 3] = ["menubar", "items", "settings"];
/// Every overlay window.
pub const ALL: [&str; 5] = ["menubar", "items", "minimap", "settings", "tooltip"];

struct OverlayView {
    label: &'static str,
    /// blur behind the glass panels; the minimap is an opaque round map
    blur: bool,
    /// windows with text inputs must be able to take keyboard focus
    focusable: bool,
}

const VIEWS: [OverlayView; 5] = [
    OverlayView { label: "menubar", blur: true, focusable: false },
    OverlayView { label: "items", blur: true, focusable: true },
    OverlayView { label: "minimap", blur: false, focusable: false },
    OverlayView { label: "settings", blur: true, focusable: true },
    // item tooltip shown to the right of the main window; never takes the mouse
    OverlayView { label: "tooltip", blur: true, focusable: false },
];

pub struct LayoutStore {
    path: PathBuf,
    value: Mutex<serde_json::Value>,
}

impl LayoutStore {
    pub fn load(app: &AppHandle) -> LayoutStore {
        let dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
        let path = dir.join("layout.json");
        let value = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or(serde_json::Value::Null);
        LayoutStore { path, value: Mutex::new(value) }
    }

    fn save(&self, value: &serde_json::Value) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, text).map_err(|e| e.to_string())
    }
}

/// The stored layout, or null when nothing was saved yet (TS then uses its defaults).
#[tauri::command]
pub fn layout_get(store: tauri::State<'_, LayoutStore>) -> serde_json::Value {
    store.value.lock().unwrap().clone()
}

/// Replaces the layout, saves it and tells every overlay window.
#[tauri::command]
pub fn layout_set(app: AppHandle, store: tauri::State<'_, LayoutStore>, layout: serde_json::Value) -> Result<(), String> {
    *store.value.lock().unwrap() = layout.clone();
    store.save(&layout)?;
    app.emit(LAYOUT_CHANGED, layout).map_err(|e| e.to_string())
}

/// Backdrop behind the glass panels.
///
/// Tauri's effects did not work for the overlay on Windows 11 (build 26200): `Acrylic` (DWM system
/// backdrop) turns into a solid color while the window is inactive, which overlay windows always
/// are, and `Blur` renders solid black under the webview. The pre-Windows-11 acrylic accent
/// (SetWindowCompositionAttribute) keeps blurring, also while the window is click-through.
/// OVERPAL_EFFECT=none|blur|acrylic switches to the alternatives for comparison.
enum Backdrop {
    None,
    Tauri(Effect),
    LegacyAcrylic,
}

fn backdrop() -> Backdrop {
    match std::env::var("OVERPAL_EFFECT").as_deref() {
        Ok("none") => Backdrop::None,
        Ok("blur") => Backdrop::Tauri(Effect::Blur),
        Ok("acrylic") => Backdrop::Tauri(Effect::Acrylic),
        _ => Backdrop::LegacyAcrylic,
    }
}

/// Creates the hidden overlay windows. Each one positions itself and shows up when ready.
pub fn create_windows(app: &AppHandle) -> tauri::Result<()> {
    for v in VIEWS {
        let mut b = WebviewWindowBuilder::new(app, v.label, WebviewUrl::App(format!("index.html?view={}", v.label).into()))
            .title("Overpal")
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            // a minimized skip-taskbar window shows as a small title bar stub above the taskbar
            .minimizable(false)
            .maximizable(false)
            .visible(false)
            .focused(false)
            .focusable(v.focusable)
            // a shadow keeps the window from rendering transparent together with the blur effect
            .shadow(false)
            .inner_size(10.0, 10.0);
        let backdrop = if v.blur { backdrop() } else { Backdrop::None };
        if let Backdrop::Tauri(effect) = backdrop {
            b = b.effects(WindowEffectsConfig { effects: vec![effect], ..Default::default() });
        }
        let w = b.build()?;
        #[cfg(windows)]
        if let Backdrop::LegacyAcrylic = backdrop {
            legacy_acrylic(&w);
        }
        #[cfg(windows)]
        {
            no_frame_painting(&w);
            ensure_popup(&w);
            // the minimap is a circle drawn inside a transparent square window
            window_corners(&w, v.label != "minimap");
        }
        #[cfg(not(windows))]
        let _ = (w, backdrop);
    }
    Ok(())
}

/// Stops Windows from painting a window frame. With the caption it had right after creation, the
/// default handling of WM_NCPAINT / WM_NCACTIVATE (e.g. when a click activates the window) painted
/// a title bar with the app name that showed through the translucent panel.
#[cfg(windows)]
fn no_frame_painting(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{WM_NCACTIVATE, WM_NCPAINT};

    // undocumented: themed windows draw the caption and frame straight away on these (activation,
    // title changes), past WM_NCPAINT; a click on the main window still drew the title bar
    const WM_NCUAHDRAWCAPTION: u32 = 0xAE;
    const WM_NCUAHDRAWFRAME: u32 = 0xAF;

    // a moment after activation the whole window (frame included) is painted again: in 0.1.3 the
    // title bar still showed after clicking, and a full repaint like this one cleared it
    const REDRAW_TIMER: usize = 0x5041;
    const REDRAW_AFTER_MS: u32 = 60;

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        use windows_sys::Win32::Graphics::Gdi::{RDW_ALLCHILDREN, RDW_FRAME, RDW_INVALIDATE, RDW_UPDATENOW, RedrawWindow};
        use windows_sys::Win32::UI::WindowsAndMessaging::{KillTimer, SetTimer, WM_ACTIVATE, WM_ACTIVATEAPP, WM_KILLFOCUS, WM_SETFOCUS, WM_TIMER};
        let full = RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN | RDW_UPDATENOW;
        match msg {
            // the window has no frame to paint
            WM_NCPAINT | WM_NCUAHDRAWCAPTION | WM_NCUAHDRAWFRAME => 0,
            // let activation go on, but lParam -1 tells the default handling not to repaint the frame
            WM_NCACTIVATE => unsafe {
                let r = DefSubclassProc(hwnd, msg, wparam, -1);
                RedrawWindow(hwnd, std::ptr::null(), std::ptr::null_mut(), full);
                SetTimer(hwnd, REDRAW_TIMER, REDRAW_AFTER_MS, None);
                r
            },
            WM_ACTIVATE | WM_ACTIVATEAPP | WM_SETFOCUS | WM_KILLFOCUS => unsafe {
                let r = DefSubclassProc(hwnd, msg, wparam, lparam);
                SetTimer(hwnd, REDRAW_TIMER, REDRAW_AFTER_MS, None);
                r
            },
            WM_TIMER if wparam == REDRAW_TIMER => unsafe {
                KillTimer(hwnd, REDRAW_TIMER);
                RedrawWindow(hwnd, std::ptr::null(), std::ptr::null_mut(), full);
                0
            },
            _ => unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) },
        }
    }

    if let Ok(hwnd) = window.hwnd() {
        unsafe { SetWindowSubclass(hwnd.0 as _, Some(proc), 0x5041_4C48, 0) };
    }
}

/// Windows 11 rounded corners (8 px at 100%, DWMWCP_ROUND) or square ones, and no DWM border line.
/// The rounded corners clip the acrylic blur, which ignores window regions and otherwise shows as
/// a square around the rounded panel; the panels' CSS radius matches (--win-radius). The border
/// line DWM draws around rounded windows showed as a square around the round minimap.
#[cfg(windows)]
fn window_corners(window: &tauri::WebviewWindow, round: bool) {
    use windows_sys::Win32::Graphics::Dwm::{DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DWMWCP_ROUND, DwmSetWindowAttribute};
    let Ok(hwnd) = window.hwnd() else { return };
    let h = hwnd.0 as _;
    let corner = if round { DWMWCP_ROUND } else { DWMWCP_DONOTROUND };
    let border = DWMWA_COLOR_NONE;
    unsafe {
        DwmSetWindowAttribute(h, DWMWA_WINDOW_CORNER_PREFERENCE as u32, &corner as *const _ as *const _, size_of_val(&corner) as u32);
        DwmSetWindowAttribute(h, DWMWA_BORDER_COLOR as u32, &border as *const _ as *const _, size_of_val(&border) as u32);
    }
}

/// Turns click-through on or off by changing only the extended style. tao's
/// set_ignore_cursor_events rewrites the whole style, putting back the caption of the undecorated
/// window, which Windows then sometimes drew over the overlay (the app name).
///
/// Window changes must run on the main thread at a safe point of the event loop
/// (run_on_main_thread): made from another thread, or in the middle of a webview callback, their
/// messages can arrive while tao flushes redraws and trip its re-entrancy assert, ending the app.
#[cfg(windows)]
pub fn set_click_through(window: &tauri::WebviewWindow, on: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GWL_EXSTYLE, GetWindowLongPtrW, SetWindowLongPtrW, WS_EX_LAYERED, WS_EX_TRANSPARENT};
    let Ok(hwnd) = window.hwnd() else { return };
    let h = hwnd.0 as _;
    unsafe {
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
        let next = if on { ex | WS_EX_TRANSPARENT | WS_EX_LAYERED } else { ex & !(WS_EX_TRANSPARENT | WS_EX_LAYERED) };
        if next != ex {
            SetWindowLongPtrW(h, GWL_EXSTYLE, next as isize);
        }
    }
}

/// Shows (without activating) or hides an overlay window. tao's show/hide rewrite the whole window
/// style like set_ignore_cursor_events does, bringing back the caption (see set_click_through).
/// Visible content rects (x, y, w, h in physical px) of the other shown overlay windows, for snapping.
#[tauri::command]
pub fn overlay_rects(app: AppHandle, window: tauri::WebviewWindow) -> Vec<[i32; 4]> {
    ["menubar", "items", "minimap", "settings"]
        .iter()
        .filter(|l| **l != window.label())
        .filter_map(|l| app.get_webview_window(l))
        .filter(|w| w.is_visible().unwrap_or(false))
        .filter_map(|w| {
            let (p, s) = (w.inner_position().ok()?, w.inner_size().ok()?);
            Some([p.x, p.y, s.width as i32, s.height as i32])
        })
        .collect()
}

#[tauri::command]
pub fn set_shown(window: tauri::WebviewWindow, on: bool) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SW_HIDE, SW_SHOWNOACTIVATE, ShowWindow};
        // deferred to a safe point of the event loop (see set_click_through)
        let w = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(hwnd) = w.hwnd() {
                unsafe { ShowWindow(hwnd.0 as _, if on { SW_SHOWNOACTIVATE } else { SW_HIDE }) };
                if on {
                    redraw_frame(hwnd.0 as isize);
                }
            }
        });
    }
    #[cfg(not(windows))]
    let _ = if on { window.show() } else { window.hide() };
}

/// Recomputes and repaints the window frame. Windows keeps the frame it drew while the window
/// still had a caption (right after creation) and shows it through the translucent panel as a
/// app-name bar until the frame is redrawn.
#[cfg(windows)]
fn redraw_frame(hwnd: isize) {
    use windows_sys::Win32::Graphics::Gdi::{RDW_ALLCHILDREN, RDW_FRAME, RDW_INVALIDATE, RDW_UPDATENOW, RedrawWindow};
    use windows_sys::Win32::UI::WindowsAndMessaging::{SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowPos};
    let h = hwnd as _;
    unsafe {
        SetWindowPos(h, std::ptr::null_mut(), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        RedrawWindow(h, std::ptr::null(), std::ptr::null_mut(), RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN | RDW_UPDATENOW);
    }
}

/// Click-through for the windows that manage it themselves (minimap, tooltip).
#[tauri::command]
pub fn click_through(window: tauri::WebviewWindow, on: bool) {
    #[cfg(windows)]
    {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || set_click_through(&w, on));
    }
    #[cfg(not(windows))]
    let _ = window.set_ignore_cursor_events(on);
}

/// Whether the caption or frame styles came back. Only reads the style, so it is safe from any thread.
#[cfg(windows)]
pub fn needs_popup_fix(window: &tauri::WebviewWindow) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GWL_STYLE, GetWindowLongPtrW, WS_CAPTION, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_THICKFRAME};
    let Ok(hwnd) = window.hwnd() else { return false };
    let style = unsafe { GetWindowLongPtrW(hwnd.0 as _, GWL_STYLE) } as u32;
    style & (WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX) != 0 || style & WS_POPUP == 0
}

/// Keeps the window a plain popup. An undecorated window keeps the caption and frame styles and
/// only hides them; when tao writes them back Windows sometimes drew that caption (app name and ×)
/// over the overlay. Called at creation, and on the main thread when the watcher finds the caption
/// back (needs_popup_fix); it only writes when the caption came back.
#[cfg(windows)]
pub fn ensure_popup(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GWL_STYLE, GetWindowLongPtrW, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos,
        WS_CAPTION, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
    };
    const FRAME: u32 = WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    let Ok(hwnd) = window.hwnd() else { return };
    let h = hwnd.0 as _;
    unsafe {
        let style = GetWindowLongPtrW(h, GWL_STYLE) as u32;
        if style & FRAME == 0 && style & WS_POPUP != 0 {
            return;
        }
        SetWindowLongPtrW(h, GWL_STYLE, ((style & !FRAME) | WS_POPUP) as isize);
        SetWindowPos(h, std::ptr::null_mut(), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
    redraw_frame(hwnd.0 as isize);
}

/// Clips the window to a rounded rectangle (radius in physical px) so the blur behind it, which
/// covers the whole window, follows the panel's rounded corners instead of showing a square edge.
#[tauri::command]
pub fn round_corners(window: tauri::WebviewWindow, radius: f64) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
        let (Ok(hwnd), Ok(inner), Ok(outer), Ok(size)) = (window.hwnd(), window.inner_position(), window.outer_position(), window.inner_size()) else {
            return;
        };
        // the region is relative to the outer window, which can include an invisible frame
        let (x, y) = (inner.x - outer.x, inner.y - outer.y);
        let d = (radius * 2.0).round().max(0.0) as i32;
        let (w, h) = (size.width as i32, size.height as i32);
        let h_wnd = hwnd.0 as isize;
        // deferred to a safe point of the event loop (see set_click_through)
        let _ = window.run_on_main_thread(move || unsafe {
            let rgn = CreateRoundRectRgn(x, y, x + w + 1, y + h + 1, d, d);
            // the system owns the region from here on
            SetWindowRgn(h_wnd as _, rgn, 1);
        });
    }
    #[cfg(not(windows))]
    let _ = (window, radius);
}

/// Acrylic through the pre-Windows-11 SetWindowCompositionAttribute API, which (unlike the
/// DWM system backdrop) does not fall back to a solid color while the window is inactive.
#[cfg(windows)]
fn legacy_acrylic(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW};

    #[repr(C)]
    struct AccentPolicy {
        state: u32,
        flags: u32,
        gradient: u32,
        animation: u32,
    }
    #[repr(C)]
    struct CompositionData {
        attrib: u32,
        data: *mut core::ffi::c_void,
        size: usize,
    }
    type SetWindowCompositionAttribute = unsafe extern "system" fn(isize, *mut CompositionData) -> i32;
    const WCA_ACCENT_POLICY: u32 = 19;
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
    // almost no tint of its own (AABBGGRR; acrylic misbehaves at alpha 0): how dark the
    // panels are is set by the opacity setting alone
    const TINT: u32 = 0x011C_1410;

    let Ok(hwnd) = window.hwnd() else { return };
    unsafe {
        let name: Vec<u16> = "user32.dll\0".encode_utf16().collect();
        let mut module = GetModuleHandleW(name.as_ptr());
        if module.is_null() {
            module = LoadLibraryW(name.as_ptr());
        }
        let Some(f) = GetProcAddress(module, c"SetWindowCompositionAttribute".as_ptr() as *const u8) else { return };
        let f: SetWindowCompositionAttribute = std::mem::transmute(f);
        let mut policy = AccentPolicy { state: ACCENT_ENABLE_ACRYLICBLURBEHIND, flags: 0, gradient: TINT, animation: 0 };
        let mut data = CompositionData { attrib: WCA_ACCENT_POLICY, data: &mut policy as *mut _ as _, size: std::mem::size_of::<AccentPolicy>() };
        f(hwnd.0 as isize, &mut data);
    }
}
