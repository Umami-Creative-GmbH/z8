use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use serde::Serialize;

use crate::clock::{BreakFailure, ClockService, ClockWriteOutcome, WorkLocationType};
use crate::offline::{ActionType, OfflineQueue};

pub enum ClockCommand {
    ClockIn(WorkLocationType),
    ClockOut,
    Break {
        start: String,
        location: WorkLocationType,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum ClockCommandOutcome {
    Committed {
        write: ClockWriteOutcome,
    },
    RetainedForReview {
        #[serde(rename = "recoveryId")]
        recovery_id: i64,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClockCommandErrorKind {
    PreSend,
    PersistenceUncertain,
}

#[derive(Debug, Serialize)]
pub struct ClockCommandError {
    pub kind: ClockCommandErrorKind,
    pub message: String,
}

impl ClockCommandError {
    pub fn pre_send(message: impl Into<String>) -> Self {
        Self {
            kind: ClockCommandErrorKind::PreSend,
            message: message.into(),
        }
    }
}

/// The native caller serializes commands. No legacy command is automatically
/// retried: neither current status nor a failed response proves noncommitment.
pub async fn execute(
    service: &ClockService,
    queue: &Mutex<OfflineQueue>,
    webapp_url: &str,
    token: &str,
    command: ClockCommand,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    if queue.lock().count().map_err(|_| {
        ClockCommandError::pre_send("Cannot read local recovery storage. Clock action paused.")
    })? > 0
    {
        return Err(ClockCommandError::pre_send("Unresolved desktop records require review before another clock action. Check your time entries in Z8."));
    }

    let (action_type, payload, result) = match command {
        ClockCommand::ClockIn(location) => (
            ActionType::ClockIn,
            Some(location.as_str().to_string()),
            service
                .clock_in_with_status(webapp_url, token, location)
                .await,
        ),
        ClockCommand::ClockOut => (
            ActionType::ClockOut,
            None,
            service.clock_out_with_status(webapp_url, token).await,
        ),
        ClockCommand::Break { start, location } => {
            let instant = DateTime::parse_from_rfc3339(&start)
                .map_err(|_| ClockCommandError::pre_send("Invalid break start time"))?
                .with_timezone(&Utc);
            let result = service
                .break_with_status(webapp_url, token, instant, location)
                .await;
            let mut payload = serde_json::json!({
                "breakStartTime": start,
                "workLocationType": location.as_str(),
            });
            // Additional receipt capture waits for ownership-aware cleanup.
            if cfg!(feature = "desktop-recovery-evidence") {
                if let Err(error) = &result {
                    if let Some(failure) = error.downcast_ref::<BreakFailure>() {
                        payload["observedFailure"] = serde_json::json!(failure);
                    }
                }
            }
            (
                ActionType::ClockOutWithBreak,
                Some(payload.to_string()),
                result,
            )
        }
    };

    match result {
        Ok(write) => Ok(ClockCommandOutcome::Committed { write }),
        Err(_) => {
            // This is failure-observation time in seconds, NOT original click
            // time or a future replay timestamp. Keep the legacy format intact.
            let recovery_id = queue.lock().enqueue(action_type, Utc::now().timestamp(), payload)
                .map_err(|_| ClockCommandError {
                    kind: ClockCommandErrorKind::PersistenceUncertain,
                    message: "Clock outcome is unconfirmed and local recovery could not be saved. Check your time entries before trying again; do not assume the write failed.".into(),
                })?;
            Ok(ClockCommandOutcome::RetainedForReview { recovery_id })
        }
    }
}
