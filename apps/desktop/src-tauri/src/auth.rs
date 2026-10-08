use crate::{
    auth_flow::{Callback, LoginAttempt},
    state::AppState,
    tray,
};
use anyhow::{anyhow, Result};
use serde::Deserialize;
use std::{
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

#[derive(Deserialize)]
struct AppExchangeResponse {
    token: String,
}

pub fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}

pub async fn handle_deep_link_callback(app: &AppHandle, url: &Url) -> Result<()> {
    let result = complete_login(app, url).await;
    if let Err(error) = &result {
        let _ = app.emit("auth_error", error.to_string());
    }
    result
}

async fn complete_login(app: &AppHandle, url: &Url) -> Result<()> {
    let state = app.state::<Arc<AppState>>();
    let (attempt, callback, generation) = {
        let mut pending = state.pending_login.lock();
        let attempt = pending
            .as_ref()
            .ok_or_else(|| anyhow!("No pending sign-in. Start sign-in again."))?;
        let callback = attempt.claim(&state.get_webapp_url(), url, Instant::now())?;
        let generation = state.auth_generation.load(Ordering::SeqCst);
        (pending.take().unwrap(), callback, generation)
    };
    let code = match callback {
        Callback::Code(code) => code,
        Callback::Error(_) => {
            return Err(anyhow!(
                "Browser sign-in was cancelled or denied. Try again."
            ))
        }
    };
    let client = client()?;
    let response = client
        .post(format!("{}/api/auth/app-exchange", attempt.server))
        .header("X-Z8-App-Type", "desktop")
        .json(&serde_json::json!({ "code": code, "verifier": attempt.verifier }))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "Sign-in code was refused or expired. Start sign-in again."
        ));
    }
    let payload: AppExchangeResponse = response.json().await?;
    if payload.token.is_empty() {
        return Err(anyhow!("The server did not return a sign-in credential."));
    }
    // Membership discovery also works for accounts without an active employee.
    let response = client
        .get(format!("{}/api/desktop/organizations", attempt.server))
        .bearer_auth(&payload.token)
        .header("X-Z8-App-Type", "desktop")
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(anyhow!("The server could not validate this sign-in."));
    }
    let _guard = state.clock_command_lock.lock().await;
    if state.get_webapp_url() != attempt.server
        || state.auth_generation.load(Ordering::SeqCst) != generation
    {
        return Err(anyhow!("The sign-in context changed. Start sign-in again."));
    }
    state.set_session_token(Some(payload.token))?;
    app.emit("auth_success", ())?;
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

pub async fn initiate_oauth(app: &AppHandle, server: &str) -> Result<()> {
    let state = app.state::<Arc<AppState>>();
    let server = crate::auth_flow::validate_server(server)?;
    let (attempt, login_url) = LoginAttempt::begin(&server, Instant::now())?;
    state.cancel_login();
    *state.pending_login.lock() = Some(attempt);
    if let Err(error) =
        tauri_plugin_opener::OpenerExt::opener(app).open_url(&login_url, None::<&str>)
    {
        state.cancel_login();
        return Err(error.into());
    }
    Ok(())
}

pub fn logout(app: &AppHandle) -> Result<()> {
    let state = app.state::<Arc<AppState>>();
    state.cancel_login();
    let credential_result = state.set_session_token(None);
    state.set_clocked_in(false);
    state.set_pending_break(None);
    let context_result = if let Ok(store) = &state.command_store {
        store.lock().forget_contexts()
    } else {
        Ok(())
    };
    let tray_result = tray::update_tray_icon(app, false);
    let event_result = app.emit("logout", ());
    if let Err(error) = credential_result {
        return Err(error);
    }
    context_result?;
    tray_result?;
    event_result?;
    Ok(())
}
