//! Version 2 frozen clock commands (#280, server contract #275).
//!
//! A command is frozen once, before its first network attempt, and every later
//! attempt resends exactly these bytes under the same operation identity. The
//! server stores the command verbatim in its receipt and treats any difference
//! as a collision, so nothing here may be recomputed after capture.
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::break_evidence::{BreakEvidence, BreakReview, Observation};
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
    /// A confirmed idle break: one atomic close at the idle start and resume at
    /// the detected return (#281).
    Break,
}

impl CommandKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClockIn => "clock_in",
            Self::ClockOut => "clock_out",
            Self::Break => "break",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "clock_in" => Some(Self::ClockIn),
            "clock_out" => Some(Self::ClockOut),
            "break" => Some(Self::Break),
            _ => None,
        }
    }
}

/// The work a clock-out or break closes: a known period, or the queued clock-in
/// (or break) that creates it. Never "whichever period is active when the command is sent".
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

/// Everything a command carries besides its kind-specific fields.
#[derive(Debug, Clone)]
pub struct CommandFrame {
    pub operation_id: String,
    pub context: CommandContext,
    pub occurred_at: DateTime<Utc>,
    /// Device IANA zone at action time.
    pub timezone: String,
    pub admission: Admission,
    /// The earlier queued operation that must be committed or archived first.
    pub depends_on: Option<String>,
}

fn freeze(frame: CommandFrame, kind: CommandKind, fields: serde_json::Value) -> FrozenCommand {
    let occurred_at = utc_instant(frame.occurred_at);
    let mut body = serde_json::json!({
        "version": CLOCK_COMMAND_VERSION,
        "operationId": frame.operation_id,
        "kind": kind.as_str(),
        "admission": frame.admission,
        "occurredAt": occurred_at,
        "timezone": frame.timezone,
        "context": frame.context,
    });
    for (key, value) in fields.as_object().into_iter().flatten() {
        body[key] = value.clone();
    }
    FrozenCommand {
        operation_id: frame.operation_id,
        kind,
        context: frame.context,
        occurred_at,
        timezone: frame.timezone,
        depends_on: frame.depends_on,
        body: body.to_string(),
    }
}

pub fn freeze_clock_in(frame: CommandFrame, location: WorkLocationType) -> FrozenCommand {
    freeze(
        frame,
        CommandKind::ClockIn,
        serde_json::json!({ "workLocationType": location.as_str() }),
    )
}

fn target_json(target: ClockTarget) -> serde_json::Value {
    match target {
        ClockTarget::WorkPeriod(id) => serde_json::json!({ "workPeriodId": id }),
        ClockTarget::ClockInOperation(id) => serde_json::json!({ "clockInOperationId": id }),
    }
}

/// Desktop clock-out has no attribution input, so it states "preserve"
/// explicitly rather than omitting the intent.
pub fn freeze_clock_out(frame: CommandFrame, target: ClockTarget) -> FrozenCommand {
    freeze(
        frame,
        CommandKind::ClockOut,
        serde_json::json!({
            "target": target_json(target),
            "project": { "kind": "preserve" },
            "workCategory": { "kind": "preserve" },
        }),
    )
}

fn observation_json(observation: Observation, timezone: Option<&str>) -> serde_json::Value {
    let mut value = serde_json::json!({
        "utc": utc_instant(observation.utc),
        "monotonicMs": observation.monotonic_ms,
    });
    if let Some(timezone) = timezone {
        value["timezone"] = serde_json::Value::String(timezone.to_string());
    }
    value
}

/// A confirmed idle break. Its action instant and zone are the detected return,
/// not the frame's click time: the break closes the target at the last input
/// before idleness, with the zone observed when idleness was detected, and
/// resumes at the return. Evidence that leaves the interval uncertain is not
/// frozen; it needs a reviewed correction instead.
pub fn freeze_break(
    mut frame: CommandFrame,
    target: ClockTarget,
    location: WorkLocationType,
    evidence: &BreakEvidence,
) -> Result<FrozenCommand, BreakReview> {
    if let Some(review) = evidence.review() {
        return Err(review);
    }
    let idle = &evidence.idle;
    let (Some(start_zone), Some(return_zone)) =
        (&idle.idle_detected.timezone, &idle.returned.timezone)
    else {
        return Err(BreakReview::StartZoneUnavailable);
    };
    frame.occurred_at = idle.returned.at.utc;
    frame.timezone = return_zone.clone();
    Ok(freeze(
        frame,
        CommandKind::Break,
        serde_json::json!({
            "target": target_json(target),
            "workLocationType": location.as_str(),
            "breakStart": {
                "at": utc_instant(idle.last_activity.utc),
                "timezone": start_zone,
            },
            "observations": {
                "lastActivity": observation_json(idle.last_activity, None),
                "idleDetected": observation_json(idle.idle_detected.at, Some(start_zone)),
                "returnDetected": observation_json(idle.returned.at, Some(return_zone)),
                "confirmed": observation_json(evidence.confirmed, None),
            },
        }),
    ))
}
