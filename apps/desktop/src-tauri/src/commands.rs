use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

use crate::auth;
use crate::clock::{ClockService, ClockStatus};
use crate::offline::ActionType;
use crate::settings::Settings;
use crate::startup;
use crate::state::AppState;
use crate::tray;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResponse {
    pub webapp_url: String,
    pub always_on_top: bool,
    pub auto_startup: bool,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub token: Option<String>,
    pub is_authenticated: bool,
}

/// Fetches the current clock status from the webapp
#[tauri::command]
pub async fn get_clock_status(app_handle: AppHandle) -> Result<ClockStatus, String> {
    let state = app_handle.state::<Arc<AppState>>();

    let token = state
        .get_session_token()
        .ok_or("Not authenticated".to_string())?;

    let webapp_url = state.get_webapp_url();
    if webapp_url.is_empty() {
        return Err("Webapp URL not configured".to_string());
    }

    let clock_service = ClockService::new();
    let status = clock_service
        .get_status(&webapp_url, &token)
        .await
        .map_err(|e| e.to_string())?;

    // Update local state
    state.set_clocked_in(status.is_clocked_in);

    // Update tray icon
    let _ = tray::update_tray_icon(&app_handle, status.is_clocked_in);

    Ok(status)
}

/// Clocks in the user
#[tauri::command]
pub async fn clock_in(app_handle: AppHandle) -> Result<ClockStatus, String> {
    let state = app_handle.state::<Arc<AppState>>();

    let token = match state.get_session_token() {
        Some(t) => t,
        None => return Err("Not authenticated".to_string()),
    };

    let webapp_url = state.get_webapp_url();
    if webapp_url.is_empty() {
        return Err("Webapp URL not configured".to_string());
    }

    let clock_service = ClockService::new();

    // Try to clock in
    match clock_service.clock_in(&webapp_url, &token).await {
        Ok(_entry) => {
            // Fetch updated status
            let status = clock_service
                .get_status(&webapp_url, &token)
                .await
                .map_err(|e| e.to_string())?;

            state.set_clocked_in(status.is_clocked_in);
            let _ = tray::update_tray_icon(&app_handle, status.is_clocked_in);

            Ok(status)
        }
        Err(e) => {
            // Check if it's a network error - queue for later
            if e.to_string().contains("connection")
                || e.to_string().contains("timeout")
                || e.to_string().contains("network")
            {
                let mut queue = state.offline_queue.lock();
                let _ = queue.enqueue(ActionType::ClockIn, Utc::now().timestamp(), None);

                // Optimistically update local state
                state.set_clocked_in(true);
                let _ = tray::update_tray_icon(&app_handle, true);

                Ok(ClockStatus {
                    has_employee: true,
                    employee_id: None,
                    is_clocked_in: true,
                    active_work_period: None,
                })
            } else {
                Err(e.to_string())
            }
        }
    }
}

/// Clocks out the user
#[tauri::command]
pub async fn clock_out(app_handle: AppHandle) -> Result<ClockStatus, String> {
    let state = app_handle.state::<Arc<AppState>>();

    let token = match state.get_session_token() {
        Some(t) => t,
        None => return Err("Not authenticated".to_string()),
    };

    let webapp_url = state.get_webapp_url();
    if webapp_url.is_empty() {
        return Err("Webapp URL not configured".to_string());
    }

    let clock_service = ClockService::new();

    match clock_service.clock_out(&webapp_url, &token).await {
        Ok(_entry) => {
            let status = clock_service
                .get_status(&webapp_url, &token)
                .await
                .map_err(|e| e.to_string())?;

            state.set_clocked_in(status.is_clocked_in);
            let _ = tray::update_tray_icon(&app_handle, status.is_clocked_in);

            Ok(status)
        }
        Err(e) => {
            if e.to_string().contains("connection")
                || e.to_string().contains("timeout")
                || e.to_string().contains("network")
            {
                let mut queue = state.offline_queue.lock();
                let _ = queue.enqueue(ActionType::ClockOut, Utc::now().timestamp(), None);

                state.set_clocked_in(false);
                let _ = tray::update_tray_icon(&app_handle, false);

                Ok(ClockStatus {
                    has_employee: true,
                    employee_id: None,
                    is_clocked_in: false,
                    active_work_period: None,
                })
            } else {
                Err(e.to_string())
            }
        }
    }
}

/// Clocks out at a specific time (for break handling) then immediately clocks back in
#[tauri::command]
pub async fn clock_out_with_break(
    app_handle: AppHandle,
    break_start_time: String,
) -> Result<ClockStatus, String> {
    let state = app_handle.state::<Arc<AppState>>();

    let token = match state.get_session_token() {
        Some(t) => t,
        None => return Err("Not authenticated".to_string()),
    };

    let webapp_url = state.get_webapp_url();
    if webapp_url.is_empty() {
        return Err("Webapp URL not configured".to_string());
    }

    let break_time: DateTime<Utc> = DateTime::parse_from_rfc3339(&break_start_time)
        .map_err(|e| format!("Invalid break time: {}", e))?
        .with_timezone(&Utc);

    let clock_service = ClockService::new();

    match clock_service
        .clock_out_with_break(&webapp_url, &token, break_time)
        .await
    {
        Ok(_) => {
            let status = clock_service
                .get_status(&webapp_url, &token)
                .await
                .map_err(|e| e.to_string())?;

            state.set_clocked_in(status.is_clocked_in);
            let _ = tray::update_tray_icon(&app_handle, status.is_clocked_in);

            Ok(status)
        }
        Err(e) => {
            if e.to_string().contains("connection")
                || e.to_string().contains("timeout")
                || e.to_string().contains("network")
            {
                let mut queue = state.offline_queue.lock();
                let _ = queue.enqueue(
                    ActionType::ClockOutWithBreak,
                    Utc::now().timestamp(),
                    Some(break_start_time),
                );

                // Remain clocked in since we'll clock back in after break
                Ok(ClockStatus {
                    has_employee: true,
                    employee_id: None,
                    is_clocked_in: true,
                    active_work_period: None,
                })
            } else {
                Err(e.to_string())
            }
        }
    }
}

/// Initiates the OAuth login flow
#[tauri::command]
pub async fn initiate_oauth(app_handle: AppHandle) -> Result<(), String> {
    let state = app_handle.state::<Arc<AppState>>();
    let webapp_url = state.get_webapp_url();

    if webapp_url.is_empty() {
        return Err("Webapp URL not configured".to_string());
    }

    auth::initiate_oauth(&app_handle, &webapp_url)
        .await
        .map_err(|e| e.to_string())
}

/// Logs out the user
#[tauri::command]
pub fn logout(app_handle: AppHandle) -> Result<(), String> {
    auth::logout(&app_handle).map_err(|e| e.to_string())
}

/// Gets the current session state
#[tauri::command]
pub fn get_session(app_handle: AppHandle) -> SessionResponse {
    let state = app_handle.state::<Arc<AppState>>();
    let token = state.get_session_token();

    SessionResponse {
        is_authenticated: token.is_some(),
        token,
    }
}

/// Gets the current settings
#[tauri::command]
pub fn get_settings(app_handle: AppHandle) -> SettingsResponse {
    let state = app_handle.state::<Arc<AppState>>();
    let settings = state.settings.read();

    SettingsResponse {
        webapp_url: settings.webapp_url.clone(),
        always_on_top: settings.always_on_top,
        auto_startup: settings.auto_startup,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Saves settings
#[tauri::command]
pub fn save_settings(
    app_handle: AppHandle,
    webapp_url: String,
    always_on_top: bool,
    auto_startup: bool,
) -> Result<(), String> {
    let state = app_handle.state::<Arc<AppState>>();

    // Update settings
    {
        let mut settings = state.settings.write();
        settings.webapp_url = webapp_url;
        settings.always_on_top = always_on_top;
        settings.auto_startup = auto_startup;

        // Save to file
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        settings.save(&app_data_dir).map_err(|e| e.to_string())?;
    }

    // Apply always-on-top setting
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_always_on_top(always_on_top);
    }

    // Apply auto-startup setting
    if auto_startup {
        if let Ok(exe_path) = std::env::current_exe() {
            let _ = startup::enable_auto_startup(exe_path.to_string_lossy().as_ref());
        }
    } else {
        let _ = startup::disable_auto_startup();
    }

    log::info!("Settings saved");
    Ok(())
}

/// Sets the always-on-top window state
#[tauri::command]
pub fn set_always_on_top(app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("main") {
        window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Sets auto-startup state
#[tauri::command]
pub fn set_auto_startup(enabled: bool) -> Result<(), String> {
    if enabled {
        if let Ok(exe_path) = std::env::current_exe() {
            startup::enable_auto_startup(exe_path.to_string_lossy().as_ref())
                .map_err(|e| e.to_string())?;
        }
    } else {
        startup::disable_auto_startup().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Gets the count of pending offline actions
#[tauri::command]
pub fn get_pending_queue_count(app_handle: AppHandle) -> Result<i64, String> {
    let state = app_handle.state::<Arc<AppState>>();
    let queue = state.offline_queue.lock();
    queue.count().map_err(|e| e.to_string())
}
