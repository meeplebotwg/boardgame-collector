fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["meeple_approve_origin", "meeple_request"]),
    ))
    .expect("tauri build failed");
}
