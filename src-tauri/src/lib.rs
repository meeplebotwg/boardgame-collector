mod meeple;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            meeple::meeple_approve_origin,
            meeple::meeple_request
        ])
        // Hands mailto:/sms: URIs to the OS (ACTION_VIEW on Android) so the
        // coordinator's own mail app sends; the WebView cannot load them
        // (ERR_UNKNOWN_URL_SCHEME). See docs/adr/0002.
        .plugin(tauri_plugin_opener::init())
        // Read-only GETs of public lu.ma pages for the Luma preview + dedupe
        // (capability-scoped to luma.com/lu.ma; the app never writes to Luma
        // — its only Luma write path is the coordinator in Luma's own UI after the
        // handoff). See docs/adr/0004.
        .plugin(tauri_plugin_http::init())
        // Writes one file only, capability-scoped to the app cache dir: the
        // self-updater's downloaded APK, handed to Android's installer by
        // MainActivity.kt. See docs/adr/0007.
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
