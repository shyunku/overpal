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
/// PALHELPER_EFFECT=none|blur|acrylic switches to the alternatives for comparison.
enum Backdrop {
    None,
    Tauri(Effect),
    LegacyAcrylic,
}

fn backdrop() -> Backdrop {
    match std::env::var("PALHELPER_EFFECT").as_deref() {
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
            .title("PalHelper")
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
        ensure_popup(&w);
        #[cfg(not(windows))]
        let _ = (w, backdrop);
    }
    Ok(())
}

/// Keeps the window a plain popup with Windows 11 rounded corners.
///
/// An undecorated window keeps the caption and frame styles and only hides them, and tao writes
/// them back whenever it changes the window (e.g. every click-through toggle). Windows then
/// sometimes drew that caption ("PalHelper ×") over the overlay. The watcher calls this every tick;
/// it only writes when the caption came back. The rounded corners also clip the acrylic blur,
/// which ignores window regions and otherwise shows as a square around the rounded panel.
#[cfg(windows)]
pub fn ensure_popup(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::{DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUNDSMALL, DwmSetWindowAttribute};
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
        // small: 4 px at 100% scaling; the panels' CSS radius matches it (--win-radius)
        let round = DWMWCP_ROUNDSMALL;
        DwmSetWindowAttribute(h, DWMWA_WINDOW_CORNER_PREFERENCE as u32, &round as *const _ as *const _, size_of_val(&round) as u32);
    }
}

/// Acrylic through the pre-Windows-11 SetWindowCompositionAttribute API, which (unlike the
/// DWM system backdrop) does not fall back to a solid color while the window is inactive.
#[cfg(windows)]
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
        unsafe {
            let rgn = CreateRoundRectRgn(x, y, x + size.width as i32 + 1, y + size.height as i32 + 1, d, d);
            // the system owns the region from here on
            SetWindowRgn(hwnd.0 as _, rgn, 1);
        }
    }
    #[cfg(not(windows))]
    let _ = (window, radius);
}

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
