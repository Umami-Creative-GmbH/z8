//! Version 2 frozen clock commands (#280, server contract #275).
//!
//! A command is frozen once, before its first network attempt, and every later
//! attempt resends exactly these bytes under the same operation identity. The
//! server stores the command verbatim in its receipt and treats any difference
//! as a collision, so nothing here may be recomputed after capture.
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::clock::WorkLocationType;

pub const CLOCK_COMMAND_VERSION: u32 = 2;

/// Consistency assertions captured with the action. They never grant access;
/// the server derives ownership and refuses a command whose context differs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandContext {
    pub user_id: String,
    pub organization_id: String,
    pub employee_id: String,
    pub server: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Admission {
    /// Sent while the server was reachable: five minutes either way.
    Immediate,
    /// Captured without a reachable server: seven days past, five minutes future.
    Delayed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandKind {
    ClockIn,
    ClockOut,
}

impl CommandKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClockIn => "clock_in",
            Self::ClockOut => "clock_out",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "clock_in" => Some(Self::ClockIn),
            "clock_out" => Some(Self::ClockOut),
            _ => None,
        }
    }
}

/// The work a clock-out closes: a known period, or the queued clock-in that
/// creates it. Never "whichever period is active when the command is sent".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClockTarget {
    WorkPeriod(String),
    ClockInOperation(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrozenCommand {
    pub operation_id: String,
    pub kind: CommandKind,
    pub context: CommandContext,
    pub occurred_at: String,
    pub timezone: String,
    /// The earlier queued operation that must be committed or archived first.
    pub depends_on: Option<String>,
    /// Exact JSON sent on every attempt.
    pub body: String,
}

/// A random (version 4) UUID in the one representation the server accepts.
pub fn new_operation_id() -> String {
    uuid::Uuid::new_v4().hyphenated().to_string()
}

/// UTC with at most millisecond precision, truncated rather than rounded so
/// that a captured instant never moves later.
pub fn utc_instant(instant: DateTime<Utc>) -> String {
    instant.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn freeze(
    operation_id: String,
    kind: CommandKind,
    context: CommandContext,
    occurred_at: DateTime<Utc>,
    timezone: &str,
    admission: Admission,
    depends_on: Option<String>,
    fields: serde_json::Value,
) -> FrozenCommand {
    let occurred_at = utc_instant(occurred_at);
    let mut body = serde_json::json!({
        "version": CLOCK_COMMAND_VERSION,
        "operationId": operation_id,
        "kind": kind.as_str(),
        "admission": admission,
        "occurredAt": occurred_at,
        "timezone": timezone,
        "context": context,
    });
    for (key, value) in fields.as_object().into_iter().flatten() {
        body[key] = value.clone();
    }
    FrozenCommand {
        operation_id,
        kind,
        context,
        occurred_at,
        timezone: timezone.to_string(),
        depends_on,
        body: body.to_string(),
    }
}

pub fn freeze_clock_in(
    operation_id: String,
    context: CommandContext,
    occurred_at: DateTime<Utc>,
    timezone: &str,
    admission: Admission,
    location: WorkLocationType,
    depends_on: Option<String>,
) -> FrozenCommand {
    freeze(
        operation_id,
        CommandKind::ClockIn,
        context,
        occurred_at,
        timezone,
        admission,
        depends_on,
        serde_json::json!({ "workLocationType": location.as_str() }),
    )
}

/// Desktop clock-out has no attribution input, so it states "preserve"
/// explicitly rather than omitting the intent.
pub fn freeze_clock_out(
    operation_id: String,
    context: CommandContext,
    occurred_at: DateTime<Utc>,
    timezone: &str,
    admission: Admission,
    target: ClockTarget,
    depends_on: Option<String>,
) -> FrozenCommand {
    let target = match target {
        ClockTarget::WorkPeriod(id) => serde_json::json!({ "workPeriodId": id }),
        ClockTarget::ClockInOperation(id) => serde_json::json!({ "clockInOperationId": id }),
    };
    freeze(
        operation_id,
        CommandKind::ClockOut,
        context,
        occurred_at,
        timezone,
        admission,
        depends_on,
        serde_json::json!({
            "target": target,
            "project": { "kind": "preserve" },
            "workCategory": { "kind": "preserve" },
        }),
    )
}
