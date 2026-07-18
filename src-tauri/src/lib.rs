use serde::{Deserialize, Serialize};
mod nai_transport;
mod r2_native;
mod sync_transport;
#[cfg(mobile)]
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifyTokenResult {
    pub valid: bool,
    pub tier: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnlasResult {
    pub success: bool,
    pub fixed: Option<i64>,
    pub purchased: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SubscriptionResponse {
    tier: Option<i32>,
    #[serde(rename = "trainingStepsLeft")]
    training_steps_left: Option<TrainingSteps>,
}

#[derive(Debug, Deserialize)]
struct TrainingSteps {
    #[serde(rename = "fixedTrainingStepsLeft")]
    fixed_training_steps_left: Option<i64>,
    #[serde(rename = "purchasedTrainingSteps")]
    purchased_training_steps: Option<i64>,
}

#[tauri::command]
async fn verify_token(token: String) -> VerifyTokenResult {
    let client = reqwest::Client::new();

    let trimmed_token = token.trim();
    // Remove "Bearer " prefix if user pasted it
    let clean_token = if trimmed_token.to_lowercase().starts_with("bearer ") {
        &trimmed_token[7..]
    } else {
        trimmed_token
    };

    let result = client
        .get("https://image.novelai.net/user/subscription")
        .header("Authorization", format!("Bearer {}", clean_token))
        .header("Content-Type", "application/json")
        .send()
        .await;

    match result {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                match response.json::<SubscriptionResponse>().await {
                    Ok(data) => {
                        let tier_name = match data.tier {
                            Some(3) => Some("opus".to_string()),
                            Some(2) => Some("scroll".to_string()),
                            Some(1) => Some("tablet".to_string()),
                            _ => Some("paper".to_string()),
                        };
                        VerifyTokenResult {
                            valid: true,
                            tier: tier_name,
                            error: None,
                        }
                    }
                    Err(_) => {
                        VerifyTokenResult {
                            valid: false,
                            tier: None,
                            error: Some("응답 형식 오류".to_string()),
                        }
                    }
                }
            } else if status.as_u16() == 401 {
                VerifyTokenResult {
                    valid: false,
                    tier: None,
                    error: Some("유효하지 않은 API 토큰".to_string()),
                }
            } else {
                VerifyTokenResult {
                    valid: false,
                    tier: None,
                    error: Some(format!("API 오류: {}", status.as_u16())),
                }
            }
        }
        Err(_) => {
            VerifyTokenResult {
                valid: false,
                tier: None,
                error: Some("네트워크 오류".to_string()),
            }
        }
    }
}

#[tauri::command]
async fn get_anlas_balance(token: String) -> AnlasResult {
    let client = reqwest::Client::new();

    let result = client
        .get("https://image.novelai.net/user/subscription")
        .header("Authorization", format!("Bearer {}", token.trim()))
        .header("Content-Type", "application/json")
        .send()
        .await;

    match result {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<SubscriptionResponse>().await {
                    Ok(data) => {
                        let fixed = data
                            .training_steps_left
                            .as_ref()
                            .and_then(|t| t.fixed_training_steps_left);
                        let purchased = data
                            .training_steps_left
                            .as_ref()
                            .and_then(|t| t.purchased_training_steps);
                        AnlasResult {
                            success: true,
                            fixed,
                            purchased,
                            error: None,
                        }
                    }
                    Err(_) => AnlasResult {
                        success: false,
                        fixed: None,
                        purchased: None,
                        error: Some("응답 형식 오류".to_string()),
                    },
                }
            } else {
                AnlasResult {
                    success: false,
                    fixed: None,
                    purchased: None,
                    error: Some(format!("API 오류: {}", response.status().as_u16())),
                }
            }
        }
        Err(_) => AnlasResult {
            success: false,
            fixed: None,
            purchased: None,
            error: Some("네트워크 오류".to_string()),
        },
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpscaleResult {
    pub success: bool,
    pub image_data: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
struct UpscalePayload {
    image: String,
    width: i32,
    height: i32,
    scale: i32,
}

#[tauri::command]
async fn upscale_image(
    token: String,
    image: String,
    width: i32,
    height: i32,
    scale: i32,
) -> UpscaleResult {
    let client = reqwest::Client::new();

    let payload = UpscalePayload {
        image,
        width,
        height,
        scale,
    };

    let result = client
        .post("https://api.novelai.net/ai/upscale")
        .header("Authorization", format!("Bearer {}", token.trim()))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await;

    match result {
        Ok(response) => {
            if response.status().is_success() {
                // Response is a ZIP file containing the image
                match response.bytes().await {
                    Ok(bytes) => {
                        // Use zip crate to extract
                        match extract_image_from_zip(&bytes) {
                            Ok(base64_image) => UpscaleResult {
                                success: true,
                                image_data: Some(base64_image),
                                error: None,
                            },
                            Err(_) => UpscaleResult {
                                success: false,
                                image_data: None,
                                error: Some("ZIP 처리 오류".to_string()),
                            },
                        }
                    }
                    Err(_) => UpscaleResult {
                        success: false,
                        image_data: None,
                        error: Some("응답 읽기 오류".to_string()),
                    },
                }
            } else {
                let status = response.status().as_u16();
                UpscaleResult {
                    success: false,
                    image_data: None,
                    error: Some(format!("API 오류 {}", status)),
                }
            }
        }
        Err(_) => UpscaleResult {
            success: false,
            image_data: None,
            error: Some("네트워크 오류".to_string()),
        },
    }
}

#[derive(Debug, Serialize)]
struct AugmentPayload {
    image: String,
    width: i32,
    height: i32,
    req_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    defry: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
}

#[tauri::command]
async fn augment_image(
    token: String,
    image: String,
    width: i32,
    height: i32,
    #[allow(non_snake_case)]
    reqType: String,
    defry: Option<i32>,
    prompt: Option<String>,
) -> UpscaleResult {
    let client = reqwest::Client::new();

    let payload = AugmentPayload {
        image,
        width,
        height,
        req_type: reqType,
        defry,
        prompt,
    };

    let result = client
        .post("https://image.novelai.net/ai/augment-image")
        .header("Authorization", format!("Bearer {}", token.trim()))
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(120))
        .json(&payload)
        .send()
        .await;

    match result {
        Ok(response) => {
            if response.status().is_success() {
                match response.bytes().await {
                    Ok(bytes) => {
                        match extract_image_from_zip(&bytes) {
                            Ok(base64_image) => UpscaleResult {
                                success: true,
                                image_data: Some(base64_image),
                                error: None,
                            },
                            Err(_) => UpscaleResult {
                                success: false,
                                image_data: None,
                                error: Some("ZIP 처리 오류".to_string()),
                            },
                        }
                    }
                    Err(_) => UpscaleResult {
                        success: false,
                        image_data: None,
                        error: Some("응답 읽기 오류".to_string()),
                    },
                }
            } else {
                let status = response.status().as_u16();
                UpscaleResult {
                    success: false,
                    image_data: None,
                    error: Some(format!("API 오류 {}", status)),
                }
            }
        }
        Err(_) => UpscaleResult {
            success: false,
            image_data: None,
            error: Some("네트워크 오류".to_string()),
        },
    }
}

fn extract_image_from_zip(zip_bytes: &[u8]) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    let cursor = Cursor::new(zip_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    if archive.is_empty() {
        return Err("ZIP 파일이 비어있습니다".to_string());
    }

    let mut file = archive.by_index(0).map_err(|e| e.to_string())?;
    let mut contents = Vec::new();
    file.read_to_end(&mut contents).map_err(|e| e.to_string())?;

    Ok(STANDARD.encode(&contents))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoveBackgroundResult {
    pub success: bool,
    pub image_data: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
async fn remove_background(image_base64: String) -> RemoveBackgroundResult {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    // Decode base64 image
    let image_bytes = match STANDARD.decode(&image_base64) {
        Ok(bytes) => bytes,
        Err(_) => {
            return RemoveBackgroundResult {
                success: false,
                image_data: None,
                error: Some("Base64 디코딩 오류".to_string()),
            }
        }
    };

    let client = reqwest::Client::new();

    // Use Hugging Face Inference API (free tier available)
    // Note: For production, consider getting an HF API token
    let result = client
        .post("https://router.huggingface.co/hf-inference/models/briaai/RMBG-1.4")
        .header("Content-Type", "application/octet-stream")
        .body(image_bytes)
        .send()
        .await;

    match result {
        Ok(response) => {
            if response.status().is_success() {
                match response.bytes().await {
                    Ok(bytes) => {
                        let base64_result = STANDARD.encode(&bytes);
                        RemoveBackgroundResult {
                            success: true,
                            image_data: Some(format!("data:image/png;base64,{}", base64_result)),
                            error: None,
                        }
                    }
                    Err(_) => RemoveBackgroundResult {
                        success: false,
                        image_data: None,
                        error: Some("응답 읽기 오류".to_string()),
                    },
                }
            } else {
                let status = response.status().as_u16();
                RemoveBackgroundResult {
                    success: false,
                    image_data: None,
                    error: Some(format!("API 오류 {}", status)),
                }
            }
        }
        Err(_) => RemoveBackgroundResult {
            success: false,
            image_data: None,
            error: Some("네트워크 오류".to_string()),
        },
    }
}

#[cfg(not(mobile))]
use std::collections::HashMap;
#[cfg(not(mobile))]
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
#[cfg(not(mobile))]
use tauri::{LogicalPosition, LogicalSize, Manager, RunEvent, Url};
#[cfg(not(mobile))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[cfg(not(mobile))]
#[derive(Clone)]
pub struct TaggerState(pub Arc<Mutex<Option<CommandChild>>>);

#[cfg(mobile)]
#[derive(Clone)]
pub struct TaggerState;

#[cfg(not(mobile))]
struct EmbeddedWebviews {
    webviews: HashMap<String, bool>,
}

#[cfg(not(mobile))]
static EMBEDDED_WEBVIEWS: std::sync::LazyLock<Mutex<EmbeddedWebviews>> =
    std::sync::LazyLock::new(|| {
        Mutex::new(EmbeddedWebviews {
            webviews: HashMap::new(),
        })
    });

#[cfg(not(mobile))]
#[tauri::command]
async fn open_embedded_browser(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // Close existing embedded browser if any
    let _ = close_embedded_browser(app.clone()).await;

    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    // Get the main window (not WebviewWindow, but Window for add_child)
    let window = app.get_window("main").ok_or("Main window not found")?;

    // Create a WebviewBuilder for the embedded browser
    let webview_builder = tauri::webview::WebviewBuilder::new(
        "embedded_browser",
        tauri::WebviewUrl::External(parsed_url),
    );

    // Add as child webview within the main window
    window
        .add_child(
            webview_builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("Failed to create embedded webview: {}", e))?;

    // Track the webview
    if let Ok(mut store) = EMBEDDED_WEBVIEWS.lock() {
        store.webviews.insert("embedded_browser".to_string(), true);
    }

    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn open_embedded_browser(
    _app: AppHandle,
    _url: String,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), String> {
    Err("Embedded browser is not available on mobile. Use the mobile browser adapter.".to_string())
}

#[cfg(not(mobile))]
#[tauri::command]
async fn close_embedded_browser(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        webview
            .close()
            .map_err(|e| format!("Failed to close: {}", e))?;
    }

    if let Ok(mut store) = EMBEDDED_WEBVIEWS.lock() {
        store.webviews.remove("embedded_browser");
    }

    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn close_embedded_browser(_app: AppHandle) -> Result<(), String> {
    Err("Embedded browser is not available on mobile. Use the mobile browser adapter.".to_string())
}

#[cfg(not(mobile))]
#[tauri::command]
async fn navigate_embedded_browser(app: AppHandle, url: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
        webview
            .navigate(parsed_url)
            .map_err(|e| format!("Navigation failed: {}", e))?;
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn navigate_embedded_browser(_app: AppHandle, _url: String) -> Result<(), String> {
    Err("Embedded browser is not available on mobile. Use the mobile browser adapter.".to_string())
}

#[cfg(not(mobile))]
#[tauri::command]
async fn resize_embedded_browser(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Position failed: {}", e))?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| format!("Size failed: {}", e))?;
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn resize_embedded_browser(
    _app: AppHandle,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), String> {
    Err("Embedded browser is not available on mobile. Use the mobile browser adapter.".to_string())
}

#[cfg(not(mobile))]
#[tauri::command]
async fn show_embedded_browser(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        webview.show().map_err(|e| format!("Show failed: {}", e))?;
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn show_embedded_browser(_app: AppHandle) -> Result<(), String> {
    Err("Embedded browser is not available on mobile. Use the mobile browser adapter.".to_string())
}

#[cfg(not(mobile))]
#[tauri::command]
async fn hide_embedded_browser(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        webview.hide().map_err(|e| format!("Hide failed: {}", e))?;
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn hide_embedded_browser(_app: AppHandle) -> Result<(), String> {
    Err("Embedded browser is not available on mobile. Use the mobile browser adapter.".to_string())
}

#[cfg(not(mobile))]
#[tauri::command]
async fn is_browser_open(app: AppHandle) -> bool {
    app.get_webview("embedded_browser").is_some()
}

#[cfg(mobile)]
#[tauri::command]
async fn is_browser_open(_app: AppHandle) -> bool {
    false
}

#[cfg(not(mobile))]
#[tauri::command]
async fn zoom_embedded_browser(app: AppHandle, zoom_level: f64) -> Result<(), String> {
    if let Some(webview) = app.get_webview("embedded_browser") {
        // Use CSS zoom property via JavaScript
        let js = format!("document.body.style.zoom = '{}';", zoom_level);
        webview
            .eval(&js)
            .map_err(|e| format!("Zoom failed: {}", e))?;
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn zoom_embedded_browser(_app: AppHandle, _zoom_level: f64) -> Result<(), String> {
    Err("Embedded browser is not available on mobile. Use the mobile browser adapter.".to_string())
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(not(mobile))]
#[tauri::command]
async fn check_tagger_binary() -> bool {
    true
}

#[cfg(mobile)]
#[tauri::command]
async fn check_tagger_binary() -> bool {
    false
}

const DIAGNOSTIC_LOG_MAX_BYTES: usize = 16 * 1024;

fn contains_unredacted_diagnostic_payload(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Array(items) => items.iter().any(contains_unredacted_diagnostic_payload),
        serde_json::Value::Object(record) => record.iter().any(|(key, item)| {
            let normalized = key.to_ascii_lowercase();
            matches!(normalized.as_str(), "responsebody" | "imagedata" | "imagebytes" | "base64" | "binary")
                || contains_unredacted_diagnostic_payload(item)
        }),
        serde_json::Value::String(text) => {
            let normalized = text.to_ascii_lowercase();
            normalized.contains("data:image")
                || normalized.contains("x-amz-signature=")
                || normalized.contains("x-amz-credential=")
        }
        _ => false,
    }
}

/// The frontend submits an already-redacted DiagnosticEvent. This command keeps
/// the production file target structured and rejects image/provider payloads
/// instead of forwarding arbitrary console data into a durable log.
#[tauri::command]
fn record_diagnostic_event(event: serde_json::Value) -> Result<(), String> {
    let record = event.as_object().ok_or_else(|| "Invalid diagnostic event".to_string())?;
    if record.get("schemaVersion") != Some(&serde_json::Value::from(1))
        || !record.contains_key("redactedDeveloperMessage")
        || contains_unredacted_diagnostic_payload(&event)
    {
        return Err("Diagnostic event did not satisfy the redacted schema".to_string());
    }

    let serialized = serde_json::to_string(&event).map_err(|_| "Unable to serialize diagnostic event".to_string())?;
    if serialized.len() > DIAGNOSTIC_LOG_MAX_BYTES {
        return Err("Diagnostic event exceeded the bounded log size".to_string());
    }

    log::error!(target: "nais2_diagnostic", "{}", serialized);
    Ok(())
}

#[cfg(not(mobile))]
fn spawn_tagger_sidecar(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<TaggerState>();
    let mut child_guard = state.0.lock().map_err(|error| error.to_string())?;

    if child_guard.is_some() {
        return Ok(());
    }

    let command = app
        .shell()
        .sidecar("tagger-server")
        .map_err(|error| format!("Sidecar config error: {}", error))?;
    let command = command.args(["--port", "8002"]);
    let (_events, child) = command
        .spawn()
        .map_err(|error| format!("Failed to spawn sidecar: {}", error))?;

    *child_guard = Some(child);
    Ok(())
}

#[cfg(not(mobile))]
#[tauri::command]
async fn start_tagger(app: AppHandle) -> Result<(), String> {
    spawn_tagger_sidecar(&app)
}

#[cfg(mobile)]
#[tauri::command]
async fn start_tagger(_app: AppHandle) -> Result<(), String> {
    Err("Tagger sidecar is not available on mobile.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(mobile))]
    let tagger_state = TaggerState(Arc::new(Mutex::new(None)));
    #[cfg(mobile)]
    let tagger_state = TaggerState;
    let tagger_state_for_exit = tagger_state.clone();
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(tagger_state)
        .manage(nai_transport::NaiTransportState::default())
        // Secure LAN transport state joins the explicit Tauri commands to the
        // live TLS listeners and nonsecret journal. Stronghold remains the only
        // durable authority for CA/client private bundles supplied per command.
        .manage(sync_transport::SyncTransportState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // The tracked Android scheduler owns notification/control lifecycle;
        // its executor remains unavailable until the process-safe transfer gate closes.
        .plugin(tauri_plugin_nais_android_transfer::init())
        // Production file logging intentionally accepts only the structured,
        // redacted diagnostic target emitted by record_diagnostic_event.
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                    file_name: Some("diagnostics".to_string()),
                }))
                .level(log::LevelFilter::Error)
                .filter(|metadata| metadata.target() == "nais2_diagnostic")
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .build(),
        );

    #[cfg(not(mobile))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            verify_token,
            get_anlas_balance,
            upscale_image,
            augment_image,
            remove_background,
            start_tagger,
            check_tagger_binary,
            open_embedded_browser,
            close_embedded_browser,
            navigate_embedded_browser,
            resize_embedded_browser,
            show_embedded_browser,
            hide_embedded_browser,
            is_browser_open,
            zoom_embedded_browser,
            exit_app,
            record_diagnostic_event,
            nai_transport::nai_generate_request,
            nai_transport::cancel_nai_request,
            r2_native::r2_store_credential,
            r2_native::r2_credential_status,
            r2_native::r2_delete_credential,
            r2_native::r2_test_connection,
            r2_native::r2_test_temporary_object,
            r2_native::r2_scan_local_artifacts,
            r2_native::r2_head_object,
            r2_native::r2_put_object,
            r2_native::r2_create_multipart,
            r2_native::r2_upload_part,
            r2_native::r2_complete_multipart,
            r2_native::r2_abort_multipart,
            sync_transport::sync_transport_start,
            sync_transport::sync_transport_stop,
            sync_transport::sync_transport_status,
            sync_transport::sync_transport_open_pairing,
            sync_transport::sync_transport_close_pairing,
            sync_transport::sync_transport_pair_client,
            sync_transport::sync_transport_revoke_device,
            sync_transport::sync_transport_enqueue_outbound,
            sync_transport::sync_transport_peek_inbound,
            sync_transport::sync_transport_ack_inbound,
            sync_transport::sync_transport_peek_outbound_receipts,
            sync_transport::sync_transport_ack_outbound_receipt,
            sync_transport::sync_transport_exchange,
            sync_transport::sync_transport_cancel_request,
        ])
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.set_decorations(true);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            #[cfg(not(mobile))]
            if let RunEvent::Exit = event {
                if let Ok(mut child) = tagger_state_for_exit.0.lock() {
                    if let Some(child_process) = child.take() {
                        let _ = child_process.kill();
                    }
                }
            }
            #[cfg(mobile)]
            let _ = (&tagger_state_for_exit, event);
        });
}
