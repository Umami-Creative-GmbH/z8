//! Browser sign-in attempt: the server and verifier belong to one native attempt.
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::time::Instant;
use url::Url;

pub const CALLBACK_URL: &str = "z8://auth/callback";

pub struct LoginAttempt {
    pub server: String,
    pub verifier: String,
    started: Instant,
}

pub enum Callback {
    Code(String),
    Error(String),
}

impl LoginAttempt {
    pub fn begin(server: &str, started: Instant) -> Result<(Self, String)> {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let verifier = URL_SAFE_NO_PAD.encode(bytes);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut login = Url::parse(&format!(
            "{}/api/auth/app-login",
            server.trim_end_matches('/')
        ))?;
        login
            .query_pairs_mut()
            .append_pair("app", "desktop")
            .append_pair("redirect", CALLBACK_URL)
            .append_pair("challenge", &challenge);
        Ok((
            Self {
                server: server.trim_end_matches('/').into(),
                verifier,
                started,
            },
            login.into(),
        ))
    }

    pub fn claim(&self, current_server: &str, callback: &Url, now: Instant) -> Result<Callback> {
        if current_server.trim_end_matches('/') != self.server
            || now.saturating_duration_since(self.started).as_secs() > 300
        {
            return Err(anyhow!(
                "Sign-in expired or the server changed. Start sign-in again."
            ));
        }
        if callback.scheme() != "z8"
            || callback.host_str() != Some("auth")
            || callback.path() != "/callback"
            || !callback.username().is_empty()
            || callback.password().is_some()
            || callback.port().is_some()
            || callback.fragment().is_some()
        {
            return Err(anyhow!("Invalid sign-in callback."));
        }
        let results: Vec<_> = callback
            .query_pairs()
            .filter(|(key, _)| key == "code" || key == "error")
            .collect();
        if results.len() != 1 || results[0].1.is_empty() {
            return Err(anyhow!("Sign-in callback must contain exactly one result."));
        }
        let (key, value) = &results[0];
        if key == "code" {
            Ok(Callback::Code(value.to_string()))
        } else {
            Ok(Callback::Error(value.to_string()))
        }
    }
}

/// A tenant server is an origin, not an arbitrary URL. Development permits
/// loopback HTTP; released applications always require trusted HTTPS.
pub fn validate_server(server: &str) -> Result<String> {
    let url = Url::parse(server.trim())?;
    let local = cfg!(debug_assertions)
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(local && url.scheme() == "http"))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(anyhow!(
            "Enter a trusted HTTPS server origin, for example https://ui.z8-time.app."
        ));
    }
    Ok(url.as_str().trim_end_matches('/').into())
}
