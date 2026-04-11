use anyhow::{anyhow, Result};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

use crate::state::AppState;
use crate::tray;

const APP_TYPE_HEADER_NAME: &str = "X-Z8-App-Type";
const DESKTOP_APP_TYPE: &str = "desktop";

#[derive(Debug, PartialEq, Eq)]
enum CallbackResult {
    Code(String),
    Error(String),
}

#[derive(Deserialize)]
struct AppExchangeResponse {
    token: String,
}

#[cfg(test)]
mod tests {
    use super::{exchange_app_callback_code, parse_callback_result, CallbackResult};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use url::Url;

    #[test]
    fn parses_callback_code_from_deep_link() {
        let url = Url::parse("z8://auth/callback?code=ONE-TIME-CODE").expect("valid callback url");

        assert_eq!(
            parse_callback_result(&url),
            Some(CallbackResult::Code("ONE-TIME-CODE".to_string()))
        );
    }

    #[test]
    fn parses_callback_error_from_deep_link() {
        let url = Url::parse(
            "z8://auth/callback?error=access_denied&error_description=Desktop%20disabled",
        )
        .expect("valid callback url");

        assert_eq!(
            parse_callback_result(&url),
            Some(CallbackResult::Error("Desktop disabled".to_string()))
        );
    }

    #[test]
    fn ignores_legacy_token_callback_deep_link() {
        let url = Url::parse("z8://auth/callback?token=session-token").expect("valid callback url");

        assert_eq!(parse_callback_result(&url), None);
    }

    #[tokio::test]
    async fn exchanges_callback_code_for_session_token() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("read local address");

        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = [0; 4096];
            let bytes_read = stream.read(&mut buffer).expect("read request body");
            let request = String::from_utf8_lossy(&buffer[..bytes_read]);

            assert!(request.starts_with("POST /api/auth/app-exchange HTTP/1.1\r\n"));
            assert!(request.contains("x-z8-app-type: desktop\r\n"));
            assert!(request.contains("content-type: application/json\r\n"));
            assert!(request.contains("{\"code\":\"ONE-TIME-CODE\"}"));

            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 25\r\nconnection: close\r\n\r\n{\"token\":\"session-token\"}",
                )
                .expect("write response");
        });

        let client = reqwest::Client::new();
        let token = exchange_app_callback_code(
            &client,
            &format!("http://{}", address),
            "ONE-TIME-CODE",
        )
        .await
        .expect("exchange should succeed");

        assert_eq!(token, "session-token");
        server.join().expect("server should complete");
    }
}

pub async fn handle_deep_link_callback(app_handle: &AppHandle, url: &Url) -> Result<()> {
    log::info!("Processing OAuth callback");

    match parse_callback_result(url) {
        Some(CallbackResult::Code(code)) => {
            let state = app_handle.state::<Arc<AppState>>();
            let webapp_url = state.get_webapp_url();
            if webapp_url.is_empty() {
                return Err(anyhow!("Webapp URL not configured"));
            }

            let client = reqwest::Client::new();
            let token = exchange_app_callback_code(&client, &webapp_url, &code)
                .await
                .map_err(|error| {
                    let _ = app_handle.emit("auth_error", error.to_string());
                    error
                })?;

            handle_oauth_callback(app_handle, token).await
        }
        Some(CallbackResult::Error(message)) => {
            log::error!("OAuth callback error: {}", message);
            app_handle.emit("auth_error", message.clone())?;
            Err(anyhow!(message))
        }
        None => {
            let message = "OAuth callback missing code or error";
            app_handle.emit("auth_error", message)?;
            Err(anyhow!(message))
        }
    }
}

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

fn parse_callback_result(url: &Url) -> Option<CallbackResult> {
    let error_description = url
        .query_pairs()
        .find(|(key, _)| key == "error_description")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty());

    if let Some(error) = url
        .query_pairs()
        .find(|(key, _)| key == "error")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
    {
        return Some(CallbackResult::Error(error_description.unwrap_or(error)));
    }

    if let Some(code) = url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
    {
        return Some(CallbackResult::Code(code));
    }

    None
}

async fn exchange_app_callback_code(
    client: &reqwest::Client,
    webapp_url: &str,
    code: &str,
) -> Result<String> {
    let response = client
        .post(format!(
            "{}/api/auth/app-exchange",
            webapp_url.trim_end_matches('/')
        ))
        .header(APP_TYPE_HEADER_NAME, DESKTOP_APP_TYPE)
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await?;

    if !response.status().is_success() {
        log::error!("Code exchange failed: {}", response.status());
        return Err(anyhow!("Code exchange failed"));
    }

    let payload: AppExchangeResponse = response.json().await?;
    if payload.token.is_empty() {
        return Err(anyhow!("Code exchange response did not include a session token"));
    }

    Ok(payload.token)
}

/// Validates and stores the session token after the browser redirects back.
pub async fn handle_oauth_callback(app_handle: &AppHandle, token: String) -> Result<()> {
    let state = app_handle.state::<Arc<AppState>>();

    // Validate the token by fetching clock status
    let webapp_url = state.get_webapp_url();
    if webapp_url.is_empty() {
        return Err(anyhow!("Webapp URL not configured"));
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
        Err(anyhow!("Token validation failed"))
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
