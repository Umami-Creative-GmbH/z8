use anyhow::Result;
use tauri::{AppHandle, Emitter, Manager};
use std::sync::Arc;

use crate::state::AppState;
use crate::tray;

/// Initiates OAuth flow by opening the browser to the webapp login page
pub async fn initiate_oauth(app_handle: &AppHandle, webapp_url: &str) -> Result<()> {
    let callback_url = "z8://auth/callback";
    let auth_url = format!(
        "{}/api/auth/desktop-login?redirect={}",
        webapp_url.trim_end_matches('/'),
        url::form_urlencoded::byte_serialize(callback_url.as_bytes()).collect::<String>()
    );

    log::info!("Opening OAuth URL: {}", auth_url);

    // Open in default browser
    tauri_plugin_shell::ShellExt::shell(app_handle)
        .open(&auth_url, None)?;

    Ok(())
}

/// Handles the OAuth callback when the browser redirects back with a token
pub async fn handle_oauth_callback(app_handle: &AppHandle, token: String) -> Result<()> {
    log::info!("Processing OAuth callback");

    let state = app_handle.state::<Arc<AppState>>();

    // Validate the token by fetching clock status
    let webapp_url = state.get_webapp_url();
    if webapp_url.is_empty() {
        return Err(anyhow::anyhow!("Webapp URL not configured"));
    }

    // Validate token by making an authenticated request
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/time-entries/status", webapp_url.trim_end_matches('/')))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await?;

    if response.status().is_success() {
        // Token is valid - now store it
        state.set_session_token(Some(token.clone()));

        // Emit success event to frontend
        app_handle.emit("auth_success", token)?;

        // Focus the main window
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }

        log::info!("OAuth authentication successful");
        Ok(())
    } else {
        log::error!("Token validation failed: {}", response.status());
        app_handle.emit("auth_error", "Token validation failed")?;
        Err(anyhow::anyhow!("Token validation failed"))
    }
}

/// Logs out the user by clearing the session token
pub fn logout(app_handle: &AppHandle) -> Result<()> {
    let state = app_handle.state::<Arc<AppState>>();
    state.set_session_token(None);
    state.set_clocked_in(false);

    // Update tray icon to gray
    tray::update_tray_icon(app_handle, false)?;

    // Emit logout event
    app_handle.emit("logout", ())?;

    log::info!("User logged out");
    Ok(())
}
