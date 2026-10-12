//! Keys the overlay reacts to while the game is in front. The overlay windows never take the
//! keyboard, so a low-level keyboard hook watches the keys; it never swallows them, the game
//! still gets every key.
//! - `-` / numpad `-`: minimap zoom out, `=` / numpad `+`: zoom in (event `minimap-zoom`, -1 or 1)

use tauri::AppHandle;

pub const MINIMAP_ZOOM: &str = "minimap-zoom";

#[cfg(windows)]
pub fn spawn(app: &AppHandle) {
    win::spawn(app.clone());
}

#[cfg(not(windows))]
pub fn spawn(_app: &AppHandle) {}

#[cfg(windows)]
mod win {
    use super::MINIMAP_ZOOM;
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter};
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ADD, VK_CONTROL, VK_LWIN, VK_MENU, VK_OEM_MINUS, VK_OEM_PLUS, VK_RWIN, VK_SUBTRACT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, HC_ACTION, KBDLLHOOKSTRUCT, MSG, SetWindowsHookExW, TranslateMessage, WH_KEYBOARD_LL,
        WM_KEYDOWN,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();

    pub fn spawn(app: AppHandle) {
        if APP.set(app).is_err() {
            return;
        }
        // a low-level hook is called on the thread that set it, which needs a message loop
        std::thread::spawn(|| unsafe {
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), GetModuleHandleW(std::ptr::null()), 0);
            if hook.is_null() {
                eprintln!("keyboard hook failed");
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }

    fn held(vk: u16) -> bool {
        unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
    }

    fn game_in_front() -> bool {
        let fg = unsafe { GetForegroundWindow() };
        if fg.is_null() {
            return false;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(fg, &mut pid) };
        crate::overlay_watch::is_game_process(pid)
    }

    unsafe extern "system" fn on_key(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && wparam == WM_KEYDOWN as WPARAM {
            let k = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
            let delta = match k.vkCode as u16 {
                VK_OEM_MINUS | VK_SUBTRACT => -1,
                VK_OEM_PLUS | VK_ADD => 1,
                _ => 0,
            };
            // shortcuts with Ctrl, Alt or Win are left alone
            if delta != 0 && ![VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN].into_iter().any(held) && game_in_front() {
                if let Some(app) = APP.get() {
                    let _ = app.emit(MINIMAP_ZOOM, delta);
                }
            }
        }
        unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
    }
}
