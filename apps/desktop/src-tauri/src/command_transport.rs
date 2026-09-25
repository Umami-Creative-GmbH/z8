//! HTTP adapter for the version 2 clock command routes (#275):
//! `GET /api/time-entries/commands` (capabilities and server-derived context),
//! `POST /api/time-entries/commands` (submit) and
//! `GET /api/time-entries/commands/{operationId}` (lookup-only recovery).
use serde::Deserialize;

use crate::clock::ClockService;
use crate::frozen_command::{CommandContext, CommandKind, CLOCK_COMMAND_VERSION};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapabilitiesContext {
    user_id: String,
    organization_id: String,
    employee_id: String,
    server: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapabilitiesBody {
    command_versions: Vec<u32>,
    kinds: Vec<String>,
    submit: String,
    context: CapabilitiesContext,
}

/// What the server offers for the session's current account and organization.
#[derive(Debug, Clone)]
pub struct Capabilities {
    raw: String,
    body: CapabilitiesBody,
}

impl Capabilities {
    pub fn parse(raw: &str) -> Option<Self> {
        Some(Self {
            raw: raw.to_string(),
            body: serde_json::from_str(raw).ok()?,
        })
    }

    pub fn raw(&self) -> &str {
        &self.raw
    }

    /// None when the server cannot name its own public origin; such a context
    /// cannot be asserted, so no command is frozen against it.
    pub fn command_context(&self) -> Option<CommandContext> {
        let context = &self.body.context;
        Some(CommandContext {
            user_id: context.user_id.clone(),
            organization_id: context.organization_id.clone(),
            employee_id: context.employee_id.clone(),
            server: context.server.clone()?,
        })
    }

    pub fn supports(&self, kind: CommandKind) -> bool {
        self.body.command_versions.contains(&CLOCK_COMMAND_VERSION)
            && self.body.kinds.iter().any(|value| value == kind.as_str())
    }

    /// Fresh submission follows the organization's completed-work adoption.
    pub fn accepts_fresh_commands(&self) -> bool {
        self.body.submit == "available"
    }
}

pub enum CapabilitiesFetch {
    Fetched(Capabilities),
    Unreachable,
    Unauthorized,
    /// The server does not offer version 2 commands to this session.
    NotOffered,
}

#[derive(Debug, Clone)]
pub enum HttpReply {
    Answered {
        status: u16,
        body: Option<serde_json::Value>,
        raw: String,
    },
    /// No response. The request may still have reached the server.
    Unreachable,
}

impl HttpReply {
    async fn read(result: reqwest::Result<reqwest::Response>) -> Self {
        let Ok(response) = result else {
            return Self::Unreachable;
        };
        let status = response.status().as_u16();
        let Ok(raw) = response.text().await else {
            return Self::Unreachable;
        };
        Self::Answered {
            status,
            body: serde_json::from_str(&raw).ok(),
            raw,
        }
    }
}

fn commands_url(endpoint: &str) -> String {
    format!(
        "{}/api/time-entries/commands",
        endpoint.trim_end_matches('/')
    )
}

impl ClockService {
    pub async fn command_capabilities(&self, endpoint: &str, token: &str) -> CapabilitiesFetch {
        let reply = HttpReply::read(
            self.client
                .get(commands_url(endpoint))
                .bearer_auth(token)
                .send()
                .await,
        )
        .await;
        match reply {
            HttpReply::Unreachable => CapabilitiesFetch::Unreachable,
            HttpReply::Answered { status: 401, .. } => CapabilitiesFetch::Unauthorized,
            HttpReply::Answered {
                status: 200, raw, ..
            } => Capabilities::parse(&raw)
                .map(CapabilitiesFetch::Fetched)
                .unwrap_or(CapabilitiesFetch::NotOffered),
            HttpReply::Answered { status, .. } if status >= 500 => CapabilitiesFetch::Unreachable,
            HttpReply::Answered { .. } => CapabilitiesFetch::NotOffered,
        }
    }

    /// Sends the frozen bytes unchanged.
    pub async fn submit_command(&self, endpoint: &str, token: &str, command: &str) -> HttpReply {
        HttpReply::read(
            self.client
                .post(commands_url(endpoint))
                .bearer_auth(token)
                .header("Content-Type", "application/json")
                .body(command.to_string())
                .send()
                .await,
        )
        .await
    }

    pub async fn lookup_command(
        &self,
        endpoint: &str,
        token: &str,
        operation_id: &str,
    ) -> HttpReply {
        HttpReply::read(
            self.client
                .get(format!("{}/{operation_id}", commands_url(endpoint)))
                .bearer_auth(token)
                .send()
                .await,
        )
        .await
    }
}
