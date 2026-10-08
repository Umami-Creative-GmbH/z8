//! The release authority and public key are build configuration, never tenant
//! settings. A check cannot install; installation requires a named UI gesture.
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    lock: tokio::sync::Mutex<()>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    configured: bool,
    version: Option<String>,
}
#[tauri::command]
pub async fn check_for_updates(app_handle: AppHandle) -> Result<AvailableUpdate, String> {
    let updates = app_handle.state::<Updates>();
    let _guard = updates.lock.lock().await;
    let (Some(endpoint), Some(key)) = (
        option_env!("Z8_DESKTOP_UPDATE_ENDPOINT"),
        option_env!("Z8_DESKTOP_UPDATE_PUBLIC_KEY"),
    ) else {
        return Ok(AvailableUpdate {
            configured: false,
            version: None,
        });
    };
    let endpoint = url::Url::parse(endpoint).map_err(|_| "Invalid release endpoint.")?;
    if endpoint.scheme() != "https"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
    {
        return Err("Release updates require trusted HTTPS.".into());
    }
    let update = app_handle
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .pubkey(key)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let version = update.as_ref().map(|update| update.version.clone());
    *updates.pending.lock() = update;
    Ok(AvailableUpdate {
        configured: true,
        version,
    })
}
#[tauri::command]
pub async fn install_update(app_handle: AppHandle, version: String) -> Result<(), String> {
    let updates = app_handle.state::<Updates>();
    let _update_guard = updates.lock.lock().await;
    let state = app_handle.state::<Arc<AppState>>();
    let _clock_guard = state
        .clock_command_lock
        .try_lock()
        .map_err(|_| "A clock action is running. Wait for it before installing.")?;
    let update = updates
        .pending
        .lock()
        .as_ref()
        .filter(|update| update.version == version)
        .cloned()
        .ok_or("Check the available update again before installing.")?;
    // Snapshot the complete SQLite store, including legacy evidence, receipts
    // and companion break state. No unresolved rows are removed during update.
    state
        .offline_queue
        .lock()
        .recovery_summary()
        .map_err(|_| "Cannot read retained clock evidence. Update paused.")?;
    let directory = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let backup = directory.join(format!(
        "before-update-{}.db",
        chrono::Utc::now().timestamp_millis()
    ));
    state
        .command_store
        .as_ref()
        .map_err(|_| "Clock storage is unavailable. Update paused.")?
        .lock()
        .backup_before_update(&backup)
        .map_err(|e| e.to_string())?;
    update
        .download_and_install(
            |received, total| {
                let _ = app_handle.emit(
                    "update_progress",
                    serde_json::json!({ "received": received, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    // Windows updater normally exits before returning. Other supported native
    // runtimes require a restart; this command is already user initiated.
    app_handle.restart();
}
