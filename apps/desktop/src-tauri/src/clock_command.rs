use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use serde::Serialize;

use crate::clock::{BreakFailure, ClockService, ClockStatus, ClockWriteOutcome, WorkLocationType};
use crate::clock_journal::{self, ClockJournal, Projection};
use crate::command_store::{token_fingerprint, CommandFailure, CommandState, CommandStore};
use crate::command_sync;
use crate::command_transport::{Capabilities, CapabilitiesFetch};
use crate::frozen_command::{
    freeze_clock_in, freeze_clock_out, new_operation_id, Admission, ClockTarget, CommandContext,
    CommandKind,
};
use crate::offline::{ActionType, OfflineQueue};

pub enum ClockCommand {
    ClockIn(WorkLocationType),
    ClockOut,
    Break {
        start: String,
        location: WorkLocationType,
    },
}

/// Observed when the user acted, before any lock, network or storage work.
pub struct ActionEvidence {
    pub occurred_at: DateTime<Utc>,
    /// Device IANA zone at action time; None when it cannot be determined.
    pub timezone: Option<String>,
}

/// Everything one clock action needs from this installation.
pub struct ClockDevice<'a> {
    pub service: &'a ClockService,
    pub queue: &'a Mutex<OfflineQueue>,
    pub store: &'a Mutex<CommandStore>,
    pub endpoint: &'a str,
    pub token: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum ClockCommandOutcome {
    Committed {
        write: ClockWriteOutcome,
    },
    /// A frozen command is saved on this device and will be sent as-is.
    #[serde(rename_all = "camelCase")]
    SavedOnDevice {
        operation_id: String,
        /// Why the last attempt did not commit, if one was made.
        waiting: Option<CommandFailure>,
    },
    /// A frozen command was refused or stopped retrying; it is kept for review.
    #[serde(rename_all = "camelCase")]
    NeedsReview {
        operation_id: String,
        failure: Option<CommandFailure>,
    },
    /// Legacy transport failure: an identity-less record kept for review.
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

    fn uncertain(message: impl Into<String>) -> Self {
        Self {
            kind: ClockCommandErrorKind::PersistenceUncertain,
            message: message.into(),
        }
    }
}

fn storage_unreadable() -> ClockCommandError {
    ClockCommandError::pre_send("Cannot read local clock storage. Clock actions are paused.")
}

/// How this action is sent. Chosen before anything is frozen, so a frozen
/// command is never downgraded to the legacy transport afterwards.
enum Route {
    Commands {
        capabilities: Capabilities,
        context: CommandContext,
        admission: Admission,
        timezone: String,
        status: Option<ClockStatus>,
    },
    Legacy,
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

async fn choose_route(
    device: &ClockDevice<'_>,
    kind: CommandKind,
    timezone: Option<&str>,
) -> Result<Route, ClockCommandError> {
    let session = token_fingerprint(device.token);
    let (capabilities, admission) = match device
        .service
        .command_capabilities(device.endpoint, device.token)
        .await
    {
        CapabilitiesFetch::Fetched(capabilities) => {
            if let Err(error) = device.store.lock().save_capabilities(
                device.endpoint,
                &session,
                capabilities.raw(),
                now_ms(),
            ) {
                log::warn!("Clock context cache not updated: {error}");
            }
            (Some(capabilities), Admission::Immediate)
        }
        // Without the server, only a context this session negotiated earlier
        // may be asserted, and the command must declare delayed delivery.
        CapabilitiesFetch::Unreachable => (
            device
                .store
                .lock()
                .cached_context(device.endpoint, &session)
                .map_err(|_| storage_unreadable())?
                .and_then(|cached| Capabilities::parse(&cached.capabilities)),
            Admission::Delayed,
        ),
        CapabilitiesFetch::Unauthorized => {
            return Err(ClockCommandError::pre_send(
                "Your session has expired. Sign in again before clocking.",
            ))
        }
        CapabilitiesFetch::NotOffered => (None, Admission::Immediate),
    };
    let Some(capabilities) = capabilities else {
        return Ok(Route::Legacy);
    };
    let (Some(context), Some(timezone)) = (capabilities.command_context(), timezone) else {
        return Ok(Route::Legacy);
    };
    if !capabilities.supports(kind) || !capabilities.accepts_fresh_commands() {
        return Ok(Route::Legacy);
    }
    let status = cached_status(device, &context).map_err(|_| storage_unreadable())?;
    Ok(Route::Commands {
        capabilities,
        context,
        admission,
        timezone: timezone.to_string(),
        status,
    })
}

/// The last status this session saw for the context's employee. Employee IDs
/// are organization-specific, so this binds the status to the context.
fn cached_status(
    device: &ClockDevice<'_>,
    context: &CommandContext,
) -> anyhow::Result<Option<ClockStatus>> {
    Ok(device
        .store
        .lock()
        .cached_context(device.endpoint, &token_fingerprint(device.token))?
        .and_then(|cached| cached.status)
        .and_then(|status| serde_json::from_str::<ClockStatus>(&status).ok())
        .filter(|status| status.employee_id.as_deref() == Some(context.employee_id.as_str())))
}

/// The native caller serializes commands. No legacy command is automatically
/// retried: neither current status nor a failed response proves noncommitment.
pub async fn execute(
    device: &ClockDevice<'_>,
    command: ClockCommand,
    evidence: ActionEvidence,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    if device.queue.lock().count().map_err(|_| {
        ClockCommandError::pre_send("Cannot read local recovery storage. Clock action paused.")
    })? > 0
    {
        return Err(ClockCommandError::pre_send("Unresolved desktop records require review before another clock action. Check your time entries in Z8."));
    }

    let route = match &command {
        ClockCommand::ClockIn(_) => {
            choose_route(device, CommandKind::ClockIn, evidence.timezone.as_deref()).await?
        }
        ClockCommand::ClockOut => {
            choose_route(device, CommandKind::ClockOut, evidence.timezone.as_deref()).await?
        }
        // Breaks keep the two-request legacy transport until #281.
        ClockCommand::Break { .. } => Route::Legacy,
    };
    match route {
        Route::Commands {
            capabilities,
            context,
            admission,
            timezone,
            status,
        } => {
            let frozen = freeze_command(
                device, &command, &evidence, context, admission, &timezone, status,
            )?;
            send_frozen(device, &capabilities, frozen).await
        }
        Route::Legacy => {
            let unresolved = device
                .store
                .lock()
                .active()
                .map_err(|_| storage_unreadable())?
                .into_iter()
                .any(|saved| saved.endpoint == device.endpoint);
            if unresolved {
                return Err(ClockCommandError::pre_send(
                    "Clock actions saved on this device must reach the server first. Refresh status and check the saved actions.",
                ));
            }
            execute_legacy(device, command).await
        }
    }
}

fn freeze_command(
    device: &ClockDevice<'_>,
    command: &ClockCommand,
    evidence: &ActionEvidence,
    context: CommandContext,
    admission: Admission,
    timezone: &str,
    status: Option<ClockStatus>,
) -> Result<crate::frozen_command::FrozenCommand, ClockCommandError> {
    let active: Vec<_> = device
        .store
        .lock()
        .for_context(device.endpoint, &context)
        .map_err(|_| storage_unreadable())?
        .into_iter()
        .filter(|saved| saved.state.is_active())
        .collect();
    if active
        .iter()
        .any(|saved| saved.state != CommandState::Pending)
    {
        return Err(ClockCommandError::pre_send(
            "An earlier clock action needs review before another one. Check the saved actions.",
        ));
    }
    let last = active.last();
    let depends_on = last.map(|saved| saved.operation_id.clone());
    let operation_id = new_operation_id();
    match command {
        ClockCommand::ClockIn(location) => {
            let clocked_in = match last {
                Some(saved) => saved.kind == CommandKind::ClockIn,
                None => status.is_some_and(|status| status.is_clocked_in),
            };
            if clocked_in {
                return Err(ClockCommandError::pre_send(
                    "You are already clocked in. Refresh status before another action.",
                ));
            }
            Ok(freeze_clock_in(
                operation_id,
                context,
                evidence.occurred_at,
                timezone,
                admission,
                *location,
                depends_on,
            ))
        }
        ClockCommand::ClockOut => {
            let target = match last {
                Some(saved) if saved.kind == CommandKind::ClockIn => {
                    ClockTarget::ClockInOperation(saved.operation_id.clone())
                }
                Some(_) => {
                    return Err(ClockCommandError::pre_send(
                        "A clock-out is already saved on this device.",
                    ))
                }
                None => match status {
                    Some(ClockStatus {
                        is_clocked_in: true,
                        active_work_period: Some(period),
                        ..
                    }) => ClockTarget::WorkPeriod(period.id),
                    Some(_) => {
                        return Err(ClockCommandError::pre_send(
                            "You are not clocked in. Refresh status before another action.",
                        ))
                    }
                    None => {
                        return Err(ClockCommandError::pre_send(
                            "Clock status is unknown. Refresh status before clocking out.",
                        ))
                    }
                },
            };
            Ok(freeze_clock_out(
                operation_id,
                context,
                evidence.occurred_at,
                timezone,
                admission,
                target,
                depends_on,
            ))
        }
        ClockCommand::Break { .. } => unreachable!("breaks use the legacy transport"),
    }
}

async fn send_frozen(
    device: &ClockDevice<'_>,
    capabilities: &Capabilities,
    frozen: crate::frozen_command::FrozenCommand,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    device
        .store
        .lock()
        .capture(device.endpoint, &frozen, now_ms())
        .map_err(|_| {
            ClockCommandError::pre_send(
                "This clock action could not be saved on this device, so nothing was sent. Try again.",
            )
        })?;
    // Storage errors after capture leave the command saved; its state decides.
    if let Err(error) = command_sync::drain(
        device.service,
        device.store,
        device.endpoint,
        device.token,
        capabilities,
        true,
        now_ms,
    )
    .await
    {
        log::warn!("Saved clock commands were not fully processed: {error}");
    }
    let saved = device
        .store
        .lock()
        .get(&frozen.operation_id)
        .ok()
        .flatten()
        .ok_or_else(|| {
            ClockCommandError::uncertain(
                "The clock action was saved on this device, but its outcome could not be read. Check your time entries before trying again; do not assume it failed.",
            )
        })?;
    Ok(match saved.state {
        CommandState::Committed => {
            let mut write = device
                .service
                .committed_with_status(device.endpoint, device.token, Vec::new())
                .await;
            write.operation_id = Some(saved.operation_id);
            if let Some(status) = &write.status {
                remember_status(device.store, device.endpoint, device.token, status);
            }
            ClockCommandOutcome::Committed { write }
        }
        CommandState::Pending => ClockCommandOutcome::SavedOnDevice {
            operation_id: saved.operation_id,
            waiting: saved.failure,
        },
        CommandState::Stalled | CommandState::Rejected | CommandState::Archived => {
            ClockCommandOutcome::NeedsReview {
                operation_id: saved.operation_id,
                failure: saved.failure,
            }
        }
    })
}

/// Keeps the latest status next to this session's cached capabilities so that
/// an offline clock-out can bind the period the user last saw.
pub fn remember_status(
    store: &Mutex<CommandStore>,
    endpoint: &str,
    token: &str,
    status: &ClockStatus,
) {
    let Ok(status) = serde_json::to_string(status) else {
        return;
    };
    if let Err(error) =
        store
            .lock()
            .save_status(endpoint, &token_fingerprint(token), &status, now_ms())
    {
        log::warn!("Clock status cache not updated: {error}");
    }
}

/// Sends saved commands of the session's current context, then reports what
/// the UI may show. Runs without the server too, from the cached context.
pub async fn sync(device: &ClockDevice<'_>, force: bool) -> anyhow::Result<ClockJournal> {
    let (capabilities, reachable) = match device
        .service
        .command_capabilities(device.endpoint, device.token)
        .await
    {
        CapabilitiesFetch::Fetched(capabilities) => {
            device.store.lock().save_capabilities(
                device.endpoint,
                &token_fingerprint(device.token),
                capabilities.raw(),
                now_ms(),
            )?;
            if let Err(error) = command_sync::drain(
                device.service,
                device.store,
                device.endpoint,
                device.token,
                &capabilities,
                force,
                now_ms,
            )
            .await
            {
                log::warn!("Saved clock commands were not fully processed: {error}");
            }
            (Some(capabilities), true)
        }
        CapabilitiesFetch::Unreachable => (
            device
                .store
                .lock()
                .cached_context(device.endpoint, &token_fingerprint(device.token))?
                .and_then(|cached| Capabilities::parse(&cached.capabilities)),
            false,
        ),
        CapabilitiesFetch::Unauthorized | CapabilitiesFetch::NotOffered => (None, true),
    };
    let context = capabilities
        .as_ref()
        .and_then(Capabilities::command_context);
    let enabled = capabilities.as_ref().is_some_and(|capabilities| {
        context.is_some()
            && capabilities.supports(CommandKind::ClockIn)
            && capabilities.supports(CommandKind::ClockOut)
            && capabilities.accepts_fresh_commands()
    });
    // Offline, the last status seen for this employee stands in for the server's.
    let last_known = match (&context, reachable) {
        (Some(context), false) => cached_status(device, context)?.map(|status| Projection {
            is_clocked_in: status.is_clocked_in,
            since: status.active_work_period.map(|period| period.start_time),
        }),
        _ => None,
    };
    let legacy = device.queue.lock().recovery_summary()?;
    let journal = clock_journal::build(
        &device.store.lock(),
        legacy,
        device.endpoint,
        context.as_ref(),
        reachable,
        enabled,
        last_known,
    )?;
    Ok(journal)
}

async fn execute_legacy(
    device: &ClockDevice<'_>,
    command: ClockCommand,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    let (service, webapp_url, token) = (device.service, device.endpoint, device.token);
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
        Ok(write) => {
            if let Some(status) = &write.status {
                remember_status(device.store, device.endpoint, device.token, status);
            }
            Ok(ClockCommandOutcome::Committed { write })
        }
        Err(_) => {
            // This is failure-observation time in seconds, NOT original click
            // time or a future replay timestamp. Keep the legacy format intact.
            let recovery_id = device.queue.lock().enqueue(action_type, Utc::now().timestamp(), payload)
                .map_err(|_| ClockCommandError::uncertain(
                    "Clock outcome is unconfirmed and local recovery could not be saved. Check your time entries before trying again; do not assume the write failed.",
                ))?;
            Ok(ClockCommandOutcome::RetainedForReview { recovery_id })
        }
    }
}
