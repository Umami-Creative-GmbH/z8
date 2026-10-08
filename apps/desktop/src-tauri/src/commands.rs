use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

use crate::auth;
use crate::break_evidence::{BreakEvidence, Observation};
use crate::clock::{ClockService, ClockStatus, WorkLocationType};
use crate::clock_command::{
    self, ActionEvidence, ClockCommand, ClockCommandError, ClockCommandOutcome, ClockSession,
    STORAGE_PAUSED,
};
use crate::clock_journal::ClockJournal;
use crate::command_store::CommandStore;
use crate::command_sync::Pacing;
use crate::offline::RecoverySummary;
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
    pub idle_enabled: bool,
    pub idle_threshold_minutes: u64,
    pub language: String,
    pub version: String,
    pub runtime_errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub credential_error: Option<String>,
    pub session_revision: u64,
    pub is_authenticated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockExpectation {
    server_url: String,
    organization_id: String,
    session_revision: u64,
}
impl ClockExpectation {
    fn check(&self, state: &AppState) -> Result<(), String> {
        if self.server_url != state.get_webapp_url()
            || self.session_revision
                != state
                    .auth_generation
                    .load(std::sync::atomic::Ordering::SeqCst)
            || self.organization_id.is_empty()
        {
            return Err("Clock context changed. Refresh your account and organization.".into());
        }
        Ok(())
    }
}
/// Fetches the current clock status from the webapp
#[tauri::command]
pub async fn get_clock_status(app_handle: AppHandle) -> Result<ClockStatus, String> {
    let state = app_handle.state::<Arc<AppState>>();
    let _guard = state.clock_command_lock.lock().await;

    let token = state
        .get_session_token()
        .ok_or("Not authenticated".to_string())?;

    let webapp_url = state.get_webapp_url();
    if webapp_url.is_empty() {
        return Err("Webapp URL not configured".to_string());
    }

    let clock_service = ClockService::new();
    let store = state.command_store.as_ref().map_err(|_| STORAGE_PAUSED)?;
    let session = ClockSession {
        service: &clock_service,
        queue: &state.offline_queue,
        store,
        endpoint: &webapp_url,
        token: &token,
    };
    let status = match clock_command::refresh_status(&session).await {
        Ok(status) => status,
        Err(error) => {
            if error
                .downcast_ref::<crate::clock::StatusAccessError>()
                .is_some_and(|error| error.0 == 401)
            {
                auth::logout(&app_handle).map_err(|e| e.to_string())?;
                let _ = tauri::Emitter::emit(&app_handle, "auth_error", error.to_string());
            }
            return Err(error.to_string());
        }
    };
    if state.get_session_token().as_deref() != Some(&token) || state.get_webapp_url() != webapp_url
    {
        return Err("Clock context changed. Refresh status for the current account.".into());
    }

    // Update local state
    state.set_clocked_in(status.is_clocked_in);
    // Other devices' confirmed live work wins over a completed local break.
    if status.is_clocked_in {
        if let Ok(store) = &state.command_store {
            let cached_context = store.lock().cached_context(
                &webapp_url,
                &crate::command_store::token_fingerprint(&token),
            );
            if let Ok(Some(cached)) = cached_context {
                if let Some(context) =
                    crate::command_transport::Capabilities::parse(&cached.capabilities)
                        .and_then(|caps| caps.command_context())
                {
                    let guard = store.lock();
                    if guard
                        .for_context(&webapp_url, &context)
                        .map_err(|_| STORAGE_PAUSED)?
                        .iter()
                        .all(|command| !command.state.is_active())
                    {
                        guard
                            .end_break(&webapp_url, &context)
                            .map_err(|_| STORAGE_PAUSED)?;
                    }
                }
            }
        }
    }
    if let Ok(store) = &state.command_store {
        clock_command::remember_status(store, &webapp_url, &token, &status);
    }

    // Update tray icon
    let _ = tray::update_tray_icon(&app_handle, status.is_clocked_in);

    Ok(status)
}

/// Clocks in the user
#[tauri::command]
pub async fn clock_in(
    app_handle: AppHandle,
    work_location_type: String,
    expectation: ClockExpectation,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    let work_location_type = WorkLocationType::from_str(&work_location_type)
        .ok_or_else(|| ClockCommandError::pre_send("Invalid work location type"))?;
    run_clock_command(
        app_handle,
        ClockCommand::ClockIn(work_location_type),
        expectation,
    )
    .await
}

#[tauri::command]
pub async fn start_manual_break(
    app_handle: AppHandle,
    attribution: Option<crate::frozen_command::ClosingAttribution>,
    expectation: ClockExpectation,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    run_clock_command(
        app_handle,
        ClockCommand::AttributedClose {
            attribution: attribution.unwrap_or_default(),
            manual_break: true,
        },
        expectation,
    )
    .await
}

#[tauri::command]
pub async fn end_manual_break(
    app_handle: AppHandle,
    expectation: ClockExpectation,
) -> Result<(), String> {
    let state = app_handle.state::<Arc<AppState>>();
    let _guard = state.clock_command_lock.lock().await;
    expectation.check(&state)?;
    let token = state.get_session_token().ok_or("Sign in first.")?;
    let endpoint = state.get_webapp_url();
    let service = ClockService::new();
    let session = clock_session(&state, &service, &endpoint, &token)?;
    let negotiated = clock_command::negotiate(&session)
        .await
        .map_err(|_| STORAGE_PAUSED)?;
    let context = negotiated
        .capabilities()
        .and_then(|caps| caps.command_context())
        .ok_or("Reconnect to confirm your clock context.")?;
    if context.organization_id != expectation.organization_id {
        return Err("Organization changed. Refresh before ending the day.".into());
    }
    session
        .store
        .lock()
        .end_break(&endpoint, &context)
        .map_err(|_| STORAGE_PAUSED)?;
    Ok(())
}

/// Clocks out the user
#[tauri::command]
pub async fn clock_out(
    app_handle: AppHandle,
    attribution: Option<crate::frozen_command::ClosingAttribution>,
    expectation: ClockExpectation,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    run_clock_command(
        app_handle,
        ClockCommand::AttributedClose {
            attribution: attribution.unwrap_or_default(),
            manual_break: false,
        },
        expectation,
    )
    .await
}

/// Records the confirmed idle break: close at the idle start, resume at the
/// detected return (#281). The observed interval comes from native state, not
/// from the webview; the confirmation only names it.
#[tauri::command]
pub async fn clock_out_with_break(
    app_handle: AppHandle,
    break_id: String,
    work_location_type: String,
    expectation: ClockExpectation,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    // The confirmation is observed first, before waiting on anything.
    let confirmed = Observation::now();
    let work_location_type = WorkLocationType::from_str(&work_location_type)
        .ok_or_else(|| ClockCommandError::pre_send("Invalid work location type"))?;
    let idle = app_handle
        .state::<Arc<AppState>>()
        .pending_break(&break_id)
        .ok_or_else(|| {
            ClockCommandError::pre_send(
                "This break is no longer available. Nothing was recorded. Enter it as a time correction in Z8 if needed.",
            )
        })?;
    let outcome = run_clock_command(
        app_handle.clone(),
        ClockCommand::Break {
            evidence: BreakEvidence { idle, confirmed },
            location: work_location_type,
        },
        expectation,
    )
    .await?;
    // Recorded, saved or retained: the same span is never offered again.
    app_handle
        .state::<Arc<AppState>>()
        .clear_pending_break(&break_id);
    Ok(outcome)
}

/// The employee was still working: the idle span is discarded.
#[tauri::command]
pub fn dismiss_idle_break(app_handle: AppHandle, break_id: String) {
    app_handle
        .state::<Arc<AppState>>()
        .clear_pending_break(&break_id);
}

fn command_store(state: &AppState) -> Result<&parking_lot::Mutex<CommandStore>, String> {
    state
        .command_store
        .as_ref()
        .map_err(|_| STORAGE_PAUSED.to_string())
}

async fn run_clock_command(
    app_handle: AppHandle,
    command: ClockCommand,
    expectation: ClockExpectation,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    // Action time and zone are observed first, before waiting on anything.
    let evidence = ActionEvidence {
        occurred_at: chrono::Utc::now(),
        timezone: iana_time_zone::get_timezone().ok(),
    };
    let state = app_handle.state::<Arc<AppState>>();
    let _guard = state.clock_command_lock.try_lock().map_err(|_| {
        ClockCommandError::pre_send(
            "Another clock request is in progress. Refresh status before trying again.",
        )
    })?;
    expectation
        .check(&state)
        .map_err(ClockCommandError::pre_send)?;
    let token = state
        .get_session_token()
        .ok_or_else(|| ClockCommandError::pre_send("Not authenticated"))?;
    let webapp_url = state.get_webapp_url();
    if webapp_url.is_empty() {
        return Err(ClockCommandError::pre_send("Webapp URL not configured"));
    }
    let service = ClockService::new();
    let session = clock_session(&state, &service, &webapp_url, &token)
        .map_err(ClockCommandError::pre_send)?;
    let mut outcome =
        clock_command::execute_pilot(&session, command, evidence, &expectation.organization_id)
            .await?;
    // Do not publish an old context's current-state result into a new session.
    if state.get_session_token().as_deref() == Some(&token) && state.get_webapp_url() == webapp_url
    {
        if let ClockCommandOutcome::Committed { write } = &outcome {
            if let Some(status) = &write.status {
                state.set_clocked_in(status.is_clocked_in);
                let _ = tray::update_tray_icon(&app_handle, status.is_clocked_in);
            }
        }
    } else if let ClockCommandOutcome::Committed { write } = &mut outcome {
        write.entries.clear();
        write.status = None;
        write.context_changed = true;
    }
    Ok(outcome)
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
pub async fn logout(app_handle: AppHandle) -> Result<(), String> {
    let state = app_handle.state::<Arc<AppState>>();
    let _guard = state.clock_command_lock.lock().await;
    auth::logout(&app_handle).map_err(|e| e.to_string())
}

/// Gets the current session state
#[tauri::command]
pub fn get_session(app_handle: AppHandle) -> SessionResponse {
    let state = app_handle.state::<Arc<AppState>>();
    let token = state.get_session_token();
    let credential_error = state.credential_error.read().clone();

    SessionResponse {
        is_authenticated: token.is_some(),
        credential_error,
        session_revision: state
            .auth_generation
            .load(std::sync::atomic::Ordering::SeqCst),
    }
}

/// Gets the current settings
#[tauri::command]
pub fn get_settings(app_handle: AppHandle) -> SettingsResponse {
    let state = app_handle.state::<Arc<AppState>>();
    let settings = state.settings.read();
    let runtime_errors = state.runtime_errors.read().clone();

    SettingsResponse {
        webapp_url: settings.webapp_url.clone(),
        always_on_top: settings.always_on_top,
        auto_startup: settings.auto_startup,
        idle_enabled: settings.idle_enabled,
        idle_threshold_minutes: settings.idle_threshold_minutes,
        language: settings.language.clone(),
        runtime_errors,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Saves settings
#[tauri::command]
pub async fn save_settings(
    app_handle: AppHandle,
    webapp_url: String,
    always_on_top: bool,
    auto_startup: bool,
    idle_enabled: bool,
    idle_threshold_minutes: u64,
    language: String,
) -> Result<(), String> {
    let webapp_url = crate::auth_flow::validate_server(&webapp_url).map_err(|e| e.to_string())?;
    let state = app_handle.state::<Arc<AppState>>();
    let _guard = state.clock_command_lock.lock().await;
    let previous = state.settings.read().clone();
    let candidate = Settings {
        webapp_url: webapp_url.clone(),
        always_on_top,
        auto_startup,
        idle_enabled,
        idle_threshold_minutes,
        language,
    };
    if !(1..=240).contains(&idle_threshold_minutes)
        || !matches!(candidate.language.as_str(), "auto" | "de" | "en")
    {
        return Err("Choose a valid language and an idle threshold from 1 to 240 minutes.".into());
    }
    if previous.webapp_url != webapp_url {
        // Never send the old server's credential to the new server.
        let response = auth::client()
            .map_err(|e| e.to_string())?
            .get(format!("{webapp_url}/api/desktop/organizations"))
            .send()
            .await
            .map_err(|_| "Reconnect before switching to a different Z8 server.")?;
        if !response.status().is_success() && response.status() != reqwest::StatusCode::UNAUTHORIZED
        {
            return Err("This server does not offer the Z8 desktop sign-in API.".into());
        }
        auth::logout(&app_handle).map_err(|e| e.to_string())?;
    }
    if let Some(window) = app_handle.get_webview_window("main") {
        window
            .set_always_on_top(always_on_top)
            .map_err(|e| e.to_string())?;
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let startup_result = if auto_startup {
        startup::enable_auto_startup(
            &executable.to_string_lossy(),
            &startup::registry_key(&app_handle),
        )
    } else {
        startup::disable_auto_startup(&startup::registry_key(&app_handle))
    };
    if let Err(error) = startup_result {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_always_on_top(previous.always_on_top);
        }
        return Err(format!(
            "Windows could not change launch at sign-in: {error}"
        ));
    }
    let directory = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    if let Err(error) = candidate.save(&directory) {
        if previous.auto_startup {
            let _ = startup::enable_auto_startup(
                &executable.to_string_lossy(),
                &startup::registry_key(&app_handle),
            );
        } else {
            let _ = startup::disable_auto_startup(&startup::registry_key(&app_handle));
        }
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_always_on_top(previous.always_on_top);
        }
        return Err(format!("Preferences could not be saved: {error}"));
    }
    *state.settings.write() = candidate;
    if let Err(error) = tray::update_language(&app_handle) {
        state
            .runtime_errors
            .write()
            .push(format!("Tray language could not be updated: {error}"));
    }
    state.set_pending_break(None);
    Ok(())
}
/// Gets the count of pending offline actions
#[tauri::command]
pub fn get_pending_queue_count(app_handle: AppHandle) -> Result<i64, String> {
    let state = app_handle.state::<Arc<AppState>>();
    let queue = state.offline_queue.lock();
    queue.count().map_err(|e| e.to_string())
}

/// Only redacted device diagnostics are available until legacy ownership can
/// be established by the authorized recovery protocol. A login is not binding.
#[tauri::command]
pub fn get_queue_recovery_summary(app_handle: AppHandle) -> Result<RecoverySummary, String> {
    let state = app_handle.state::<Arc<AppState>>();
    state.get_session_token().ok_or("Not authenticated")?;
    let queue = state.offline_queue.lock();
    queue
        .recovery_summary()
        .map_err(|_| "Cannot read local recovery storage. Clock actions are paused.".into())
}

fn clock_session<'a>(
    state: &'a AppState,
    service: &'a ClockService,
    webapp_url: &'a str,
    token: &'a str,
) -> Result<ClockSession<'a>, String> {
    Ok(ClockSession {
        service,
        queue: &state.offline_queue,
        store: command_store(state)?,
        endpoint: webapp_url,
        token,
    })
}

/// Sends saved clock commands of the current context and returns what the UI
/// may show about them. While a clock action runs, it reports without sending.
#[tauri::command]
pub async fn sync_clock_commands(
    app_handle: AppHandle,
    force: bool,
) -> Result<ClockJournal, String> {
    let pacing = if force {
        Pacing::Now
    } else {
        Pacing::AfterBackoff
    };
    let state = app_handle.state::<Arc<AppState>>();
    let token = state.get_session_token().ok_or("Not authenticated")?;
    let webapp_url = state.get_webapp_url();
    if webapp_url.is_empty() {
        return Err("Webapp URL not configured".into());
    }
    let service = ClockService::new();
    let session = clock_session(&state, &service, &webapp_url, &token)?;
    // Explicit refresh waits for the current action; routine polling can report
    // cached evidence without competing with it. Keep the guard through logout.
    let guard = if force {
        Some(state.clock_command_lock.lock().await)
    } else {
        state.clock_command_lock.try_lock().ok()
    };
    if state.get_session_token().as_deref() != Some(&token) || state.get_webapp_url() != webapp_url
    {
        return Err("Clock context changed. Refresh the current account.".into());
    }
    let journal = if guard.is_some() {
        clock_command::sync(&session, pacing).await
    } else {
        clock_command::journal_offline(&session)
    };
    let journal = journal.map_err(|_| STORAGE_PAUSED.to_string())?;
    if guard.is_some()
        && (journal.sign_in_required
            || journal.commands.iter().any(|command| {
                command.waiting_for == Some(crate::command_store::WaitingFor::SignIn)
            }))
    {
        auth::logout(&app_handle).map_err(|e| e.to_string())?;
        let _ = tauri::Emitter::emit(
            &app_handle,
            "auth_error",
            "Your sign-in expired. Sign in again; saved actions remain on this device.",
        );
    }
    if state.get_session_token().is_some() {
        if let Some(projection) = &journal.projection {
            state.set_clocked_in(projection.is_clocked_in);
            let _ = tray::update_tray_icon(&app_handle, projection.is_clocked_in);
        }
    }
    Ok(journal)
}

/// Only the context that captured a command may act on it.
async fn owned_command(state: &AppState, operation_id: &str) -> Result<(), String> {
    let token = state.get_session_token().ok_or("Not authenticated")?;
    let webapp_url = state.get_webapp_url();
    let service = ClockService::new();
    let session = clock_session(state, &service, &webapp_url, &token)?;
    let context = clock_command::negotiate(&session)
        .await
        .ok()
        .and_then(|negotiated| negotiated.capabilities()?.command_context())
        .ok_or("The account and organization for this clock action cannot be confirmed.")?;
    let command = session
        .store
        .lock()
        .get(operation_id)
        .map_err(|_| STORAGE_PAUSED.to_string())?
        .ok_or("Clock action not found.")?;
    if command.endpoint != webapp_url || command.context != context {
        return Err("This clock action belongs to another account, organization or server.".into());
    }
    Ok(())
}

/// Exact retry of a stalled command: same identity and bytes, lookup first.
#[tauri::command]
pub async fn retry_clock_command(
    app_handle: AppHandle,
    operation_id: String,
) -> Result<ClockJournal, String> {
    let state = app_handle.state::<Arc<AppState>>();
    owned_command(&state, &operation_id).await?;
    command_store(&state)?
        .lock()
        .retry(&operation_id)
        .map_err(|_| "Only a clock action that stopped retrying can be retried.".to_string())?;
    sync_clock_commands(app_handle.clone(), true).await
}

/// Sets aside a command the server refused without saving it. The evidence
/// stays on this device, and nothing on the server is cancelled.
#[tauri::command]
pub async fn archive_clock_command(
    app_handle: AppHandle,
    operation_id: String,
) -> Result<ClockJournal, String> {
    let state = app_handle.state::<Arc<AppState>>();
    owned_command(&state, &operation_id).await?;
    command_store(&state)?
        .lock()
        .archive(&operation_id, chrono::Utc::now().timestamp_millis())
        .map_err(|_| {
            "Only a clock action the server refused without saving work can be archived."
                .to_string()
        })?;
    sync_clock_commands(app_handle.clone(), false).await
}
