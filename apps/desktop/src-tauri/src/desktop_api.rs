//! Only named desktop operations cross IPC. Credentials stay in native code.
use crate::{auth, state::AppState};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug)]
enum RequestFailure {
    Offline,
    Other(String),
}
impl From<&str> for RequestFailure {
    fn from(message: &str) -> Self {
        Self::Other(message.into())
    }
}
impl From<String> for RequestFailure {
    fn from(message: String) -> Self {
        Self::Other(message)
    }
}
impl From<RequestFailure> for String {
    fn from(error: RequestFailure) -> Self {
        match error {
            RequestFailure::Offline => {
                "Cannot reach the server. Reconnect to manage your organization.".into()
            }
            RequestFailure::Other(message) => message,
        }
    }
}

async fn request(
    app: &AppHandle,
    path: &str,
    body: Option<Value>,
) -> Result<Value, RequestFailure> {
    let state = app.state::<Arc<AppState>>();
    let token = state.get_session_token().ok_or("Sign in to Z8.")?;
    let server = state.get_webapp_url();
    let client = auth::client().map_err(|_| "Could not initialize a secure connection.")?;
    let url = format!("{server}{path}");
    let builder = match body {
        Some(body) => client.post(&url).json(&body),
        None => client.get(&url),
    };
    let response = builder
        .bearer_auth(&token)
        .header("X-Z8-App-Type", "desktop")
        .send()
        .await
        .map_err(|_| RequestFailure::Offline)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        auth::logout(app).map_err(|error| error.to_string())?;
        let _ = app.emit(
            "auth_error",
            "Your sign-in expired. Sign in again; saved clock actions remain on this device.",
        );
        return Err("Your sign-in expired. Sign in again.".into());
    }
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(
            "Access was refused. Check organization membership, SSO and employee access in Z8."
                .into(),
        );
    }
    if !response.status().is_success() {
        return Err(format!(
            "The server refused this request ({}).",
            response.status().as_u16()
        )
        .into());
    }
    if state.get_session_token().as_deref() != Some(&token) || state.get_webapp_url() != server {
        return Err("The sign-in context changed. Refresh the current organization.".into());
    }
    response
        .json()
        .await
        .map_err(|_| "The server returned an unreadable response.".into())
}

#[tauri::command]
pub async fn get_organizations(app_handle: AppHandle) -> Result<Value, String> {
    let state = app_handle.state::<Arc<AppState>>();
    let _guard = state.clock_command_lock.lock().await;
    let endpoint = state.get_webapp_url();
    let fingerprint = crate::command_store::token_fingerprint(
        &state.get_session_token().ok_or("Sign in to Z8.")?,
    );
    match request(&app_handle, "/api/desktop/organizations", None).await {
        Ok(body) => {
            if let Ok(store) = &state.command_store {
                store
                    .lock()
                    .save_organizations(&endpoint, &fingerprint, &body.to_string())
                    .map_err(|_| "Could not save your organization for offline restart.")?;
            }
            Ok(body)
        }
        Err(RequestFailure::Offline) => state
            .command_store
            .as_ref()
            .map_err(|_| "Clock storage is unavailable.")?
            .lock()
            .offline_organizations(&endpoint, &fingerprint)
            .map_err(|_| "Cannot read saved organization context.")?
            .ok_or_else(|| {
                "Reconnect once to confirm your account and organization before clocking offline."
                    .into()
            }),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
pub async fn switch_organization(
    app_handle: AppHandle,
    organization_id: String,
) -> Result<Value, String> {
    let state = app_handle.state::<Arc<AppState>>();
    let _guard = state.clock_command_lock.lock().await;
    // Clear negotiated authority before the request: a lost switch response
    // must not leave permission to clock offline in the previous organization.
    state
        .command_store
        .as_ref()
        .map_err(|_| "Clock storage is unavailable.")?
        .lock()
        .forget_contexts()
        .map_err(|_| "Could not pause the previous clock context.")?;
    state.set_pending_break(None);
    state.set_clocked_in(false);
    request(
        &app_handle,
        "/api/organizations/switch",
        Some(serde_json::json!({"organizationId": organization_id})),
    )
    .await?;
    request(&app_handle, "/api/desktop/organizations", None)
        .await
        .map_err(Into::into)
}
#[tauri::command]
pub async fn get_desktop_context(app_handle: AppHandle) -> Result<Value, String> {
    let state = app_handle.state::<Arc<AppState>>();
    let _guard = state.clock_command_lock.lock().await;
    let endpoint = state.get_webapp_url();
    let token = state.get_session_token().ok_or("Sign in first.")?;
    let store = state
        .command_store
        .as_ref()
        .map_err(|_| "Clock storage is unavailable.")?;
    let service = crate::clock::ClockService::new();
    let session = crate::clock_command::ClockSession {
        service: &service,
        queue: &state.offline_queue,
        store,
        endpoint: &endpoint,
        token: &token,
    };
    let negotiated = crate::clock_command::negotiate(&session)
        .await
        .map_err(|_| "Cannot confirm clock context.")?;
    let context = negotiated
        .capabilities()
        .and_then(|caps| caps.command_context());
    match request(&app_handle, "/api/desktop/context", None).await {
        Ok(mut body) => {
            if let Some(context) = &context {
                if body["userId"] != context.user_id
                    || body["organizationId"] != context.organization_id
                    || body["employeeId"] != context.employee_id
                {
                    return Err("The organization's clock context changed. Refresh the organization before clocking.".into());
                }
                store
                    .lock()
                    .save_snapshot(&endpoint, context, &body.to_string())
                    .map_err(|_| "Your day summary could not be saved for offline use.")?;
            }
            if let Err(error) = crate::tray::set_employee_locale(
                &app_handle,
                body["locale"].as_str().unwrap_or("en"),
            ) {
                state
                    .runtime_errors
                    .write()
                    .push(format!("Tray language could not be updated: {error}"));
            }
            body["cached"] = false.into();
            Ok(body)
        }
        Err(RequestFailure::Offline) => {
            let body = context
                .as_ref()
                .map(|context| store.lock().snapshot(&endpoint, context))
                .transpose()
                .map_err(|_| "Cannot read the saved day summary.")?
                .flatten();
            let mut body: Value = serde_json::from_str(
                &body.ok_or("Connect once to load your employee day summary.")?,
            )
            .map_err(|_| "The saved day summary is unreadable.")?;
            if let Err(error) = crate::tray::set_employee_locale(
                &app_handle,
                body["locale"].as_str().unwrap_or("en"),
            ) {
                state
                    .runtime_errors
                    .write()
                    .push(format!("Tray language could not be updated: {error}"));
            }
            body["cached"] = true.into();
            Ok(body)
        }
        Err(error) => Err(error.into()),
    }
}
#[tauri::command]
pub async fn open_webapp(
    app_handle: AppHandle,
    section: String,
    language: String,
) -> Result<(), String> {
    let state = app_handle.state::<Arc<AppState>>();
    let _guard = state.clock_command_lock.lock().await;
    // Confirm the browser destination's organization rather than guessing from
    // an old webview cache. Browser authentication remains its own session.
    let organizations = request(&app_handle, "/api/desktop/organizations", None).await?;
    let id = organizations["activeOrganizationId"]
        .as_str()
        .ok_or("Select an organization first.")?;
    if !matches!(section.as_str(), "time" | "reports" | "preferences") {
        return Err("Unknown Z8 section.".into());
    }
    let user_id = organizations["userId"]
        .as_str()
        .ok_or("Update the server to support desktop handoff.")?;
    let mut url = url::Url::parse(&format!("{}/api/desktop/open", state.get_webapp_url()))
        .map_err(|_| "Invalid server.")?;
    url.query_pairs_mut()
        .append_pair("organizationId", id)
        .append_pair("userId", user_id)
        .append_pair("section", &section)
        .append_pair("language", if language == "de" { "de" } else { "en" });
    tauri_plugin_opener::OpenerExt::opener(&app_handle)
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(())
}
