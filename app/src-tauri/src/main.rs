// No console window in release builds; the app shows its own windows (profile window, Home).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    overpal_lib::run()
}
