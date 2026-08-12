const COMMANDS: &[&str] = &[
    "schedule",
    "pause",
    "resume",
    "cancel",
    "retry",
    "checkpoint",
    "status",
    "recover",
    "configure_cloudflare",
];

fn main() {
    // The build helper copies the tracked Android implementation into Tauri's
    // generated project and derives command permissions from this fixed list.
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();

    let mobile = std::env::var("CARGO_CFG_TARGET_OS")
        .map(|target| target == "android" || target == "ios")
        .unwrap_or(false);
    alias("mobile", mobile);
}

fn alias(alias: &str, enabled: bool) {
    println!("cargo:rustc-check-cfg=cfg({alias})");
    if enabled {
        println!("cargo:rustc-cfg={alias}");
    }
}
