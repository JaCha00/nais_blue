use tauri::{AppHandle, Runtime};

use crate::{
    types::{
        validate_transfer_id, CheckpointArgs, RecoveryResult, ScheduleArgs, TransferIdArgs,
        TransferStatus, TransferTicket,
    },
    AndroidTransferExt, Result,
};

/// Commands validate before invoking Android, making the native plugin an
/// implementation detail behind Tauri's existing permission boundary.
#[tauri::command]
pub async fn schedule<R: Runtime>(
    app: AppHandle<R>,
    ticket: TransferTicket,
) -> Result<TransferStatus> {
    ticket.validate()?;
    app.android_transfer()
        .call("schedule", ScheduleArgs { ticket })
}

#[tauri::command]
pub async fn pause<R: Runtime>(app: AppHandle<R>, transfer_id: String) -> Result<TransferStatus> {
    control(&app, "pause", transfer_id)
}

#[tauri::command]
pub async fn resume<R: Runtime>(app: AppHandle<R>, transfer_id: String) -> Result<TransferStatus> {
    control(&app, "resume", transfer_id)
}

#[tauri::command]
pub async fn cancel<R: Runtime>(app: AppHandle<R>, transfer_id: String) -> Result<TransferStatus> {
    control(&app, "cancel", transfer_id)
}

#[tauri::command]
pub async fn retry<R: Runtime>(app: AppHandle<R>, transfer_id: String) -> Result<TransferStatus> {
    control(&app, "retry", transfer_id)
}

#[tauri::command]
pub async fn checkpoint<R: Runtime>(
    app: AppHandle<R>,
    transfer_id: String,
    checkpoint_bytes: u64,
) -> Result<TransferStatus> {
    validate_transfer_id(&transfer_id)?;
    app.android_transfer().call(
        "checkpoint",
        CheckpointArgs {
            transfer_id,
            checkpoint_bytes,
        },
    )
}

#[tauri::command]
pub async fn status<R: Runtime>(app: AppHandle<R>, transfer_id: String) -> Result<TransferStatus> {
    control(&app, "status", transfer_id)
}

#[tauri::command]
pub async fn recover<R: Runtime>(app: AppHandle<R>) -> Result<RecoveryResult> {
    app.android_transfer()
        .call("recover", serde_json::json!({}))
}

fn control<R: Runtime>(
    app: &AppHandle<R>,
    command: &str,
    transfer_id: String,
) -> Result<TransferStatus> {
    validate_transfer_id(&transfer_id)?;
    app.android_transfer()
        .call(command, TransferIdArgs { transfer_id })
}
