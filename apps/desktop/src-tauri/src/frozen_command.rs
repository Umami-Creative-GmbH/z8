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

/// The command without vehicle use; every server that takes frozen commands
/// accepts it, and the desktop requires it to be advertised.
pub const CLOCK_COMMAND_VERSION: u32 = 2;
/// Version 2 plus optional vehicle use beside the body (#1124, server #1122).
/// Sent only when the server advertises it and vehicle use was entered.
pub const VEHICLE_CLOCK_COMMAND_VERSION: u32 = 4;

/// An organization vehicle by id, or the employee's own vehicle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum VehicleChoice {
    Own,
    Organization {
        #[serde(rename = "vehicleId")]
        vehicle_id: String,
    },
}

impl VehicleChoice {
    /// The one representation the server accepts: a lowercase UUID. Anything
    /// else would make the whole command invalid, so it is left out instead.
    fn wire(&self) -> Option<serde_json::Value> {
        match self {
            Self::Own => Some(serde_json::json!({ "kind": "own" })),
            Self::Organization { vehicle_id } => {
                let id = vehicle_id.to_ascii_lowercase();
                uuid::Uuid::parse_str(&id)
                    .ok()
                    .filter(|parsed| parsed.hyphenated().to_string() == id)
                    .map(|_| serde_json::json!({ "kind": "organization", "vehicleId": id }))
            }
        }
    }
}

/// Vehicle use the employee entered at a clock-in or clock-out, in whole
/// kilometres. Absent (or `null`) fields are omitted from the frozen command.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClockVehicleUse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vehicle: Option<VehicleChoice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_km: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_km: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distance_km: Option<u32>,
}

impl ClockVehicleUse {
    /// A clock-in names the vehicle and, optionally, the start reading.
    pub fn clock_in_wire(&self) -> Option<serde_json::Value> {
        let mut value = serde_json::json!({ "vehicle": self.vehicle.as_ref()?.wire()? });
        if let Some(start) = self.start_km {
            value["startKm"] = start.into();
        }
        Some(value)
    }

    /// A clock-out names at least one field; absent ones keep what the work records.
    pub fn clock_out_wire(&self) -> Option<serde_json::Value> {
        let mut value = serde_json::Map::new();
        if let Some(vehicle) = self.vehicle.as_ref().and_then(VehicleChoice::wire) {
            value.insert("vehicle".into(), vehicle);
        }
        for (key, reading) in [
            ("startKm", self.start_km),
            ("endKm", self.end_km),
            ("distanceKm", self.distance_km),
        ] {
            if let Some(reading) = reading {
                value.insert(key.into(), reading.into());
            }
        }
        (!value.is_empty()).then_some(serde_json::Value::Object(value))
    }
}

/// A break's one reading: the closed work's end and the resumed work's start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BreakVehicleUse {
    pub reading_km: u32,
}

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
    /// The `version` the body states.
    pub version: u32,
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

/// Version 2 without vehicle use; version 4 with it, appended as `vehicleUse`.
fn freeze(
    frame: CommandFrame,
    kind: CommandKind,
    mut fields: serde_json::Value,
    vehicle_use: Option<serde_json::Value>,
) -> FrozenCommand {
    let version = match vehicle_use {
        Some(vehicle_use) => {
            fields["vehicleUse"] = vehicle_use;
            VEHICLE_CLOCK_COMMAND_VERSION
        }
        None => CLOCK_COMMAND_VERSION,
    };
    let occurred_at = utc_instant(frame.occurred_at);
    let mut body = serde_json::json!({
        "version": version,
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
        version,
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
    freeze_clock_in_with(frame, location, None)
}

/// A clock-in with the vehicle use entered for it (#1124). Without a vehicle
/// there is nothing to send, and the command keeps its version 2 bytes.
pub fn freeze_clock_in_with(
    frame: CommandFrame,
    location: WorkLocationType,
    vehicle_use: Option<&ClockVehicleUse>,
) -> FrozenCommand {
    freeze(
        frame,
        CommandKind::ClockIn,
        serde_json::json!({ "workLocationType": location.as_str() }),
        vehicle_use.and_then(ClockVehicleUse::clock_in_wire),
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
        None,
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
    frame: CommandFrame,
    target: ClockTarget,
    location: WorkLocationType,
    evidence: &BreakEvidence,
) -> Result<FrozenCommand, BreakReview> {
    freeze_break_with(frame, target, location, evidence, None)
}

/// A confirmed idle break with the one odometer reading entered for it (#1124).
pub fn freeze_break_with(
    mut frame: CommandFrame,
    target: ClockTarget,
    location: WorkLocationType,
    evidence: &BreakEvidence,
    vehicle_use: Option<BreakVehicleUse>,
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
        vehicle_use.map(|reading| serde_json::json!({ "readingKm": reading.reading_km })),
    ))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum AttributionIntent {
    #[default]
    Preserve,
    Clear,
    Replace {
        id: String,
    },
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClosingAttribution {
    pub project: AttributionIntent,
    pub work_category: AttributionIntent,
    /// Absent unless the user picked a task (#882). An absent task follows the
    /// project on the server; `null` is never valid, so it is refused here.
    #[serde(
        default,
        deserialize_with = "present_task",
        skip_serializing_if = "Option::is_none"
    )]
    pub task: Option<AttributionIntent>,
}

fn present_task<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<AttributionIntent>, D::Error> {
    AttributionIntent::deserialize(deserializer).map(Some)
}

/// Freezes the closing attribution. The `task` key is omitted when no task was
/// chosen, so such a command keeps exactly its pre-task bytes and older servers
/// (which refuse unknown keys) still accept it.
pub fn freeze_attributed_clock_out(
    frame: CommandFrame,
    target: ClockTarget,
    attribution: &ClosingAttribution,
) -> FrozenCommand {
    freeze_attributed_clock_out_with(frame, target, attribution, None)
}

/// The closing attribution plus the vehicle use entered at the clock-out
/// (#1124): the end reading or distance, and the vehicle and start reading when
/// the work records none. Nothing entered keeps the version 2 bytes.
pub fn freeze_attributed_clock_out_with(
    frame: CommandFrame,
    target: ClockTarget,
    attribution: &ClosingAttribution,
    vehicle_use: Option<&ClockVehicleUse>,
) -> FrozenCommand {
    let mut fields = serde_json::json!({
        "target": target_json(target), "project": attribution.project,
        "workCategory": attribution.work_category,
    });
    if let Some(task) = &attribution.task {
        fields["task"] = serde_json::json!(task);
    }
    freeze(
        frame,
        CommandKind::ClockOut,
        fields,
        vehicle_use.and_then(ClockVehicleUse::clock_out_wire),
    )
}
