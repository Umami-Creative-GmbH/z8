use chrono::{DateTime, SecondsFormat, Utc};
use parking_lot::Mutex;
use serde::Serialize;

use crate::break_evidence::{BreakEvidence, BreakReview};
use crate::clock::{BreakFailure, ClockService, ClockStatus, ClockWriteOutcome, WorkLocationType};
use crate::clock_journal::{self, ClockJournal, JournalScope, Projection};
use crate::command_store::{token_fingerprint, CommandFailure, CommandState, CommandStore};
use crate::command_sync::{self, Pacing};
use crate::command_transport::{Capabilities, CapabilitiesFetch};
use crate::frozen_command::{
    freeze_break, freeze_clock_in, freeze_clock_out, new_operation_id, Admission, ClockTarget,
    CommandContext, CommandFrame, CommandKind, FrozenCommand,
};
use crate::offline::{ActionType, OfflineQueue};

/// Shown whenever local clock storage cannot be opened, read or written.
pub const STORAGE_PAUSED: &str = "Cannot read local clock storage. Clock actions are paused.";

pub enum ClockCommand {
    ClockIn(WorkLocationType),
    ClockOut,
    /// A confirmed idle break: close at the idle start, resume at the detected
    /// return, where `location` is the resumed work's location (#281).
    Break {
        evidence: BreakEvidence,
        location: WorkLocationType,
    },
}

impl ClockCommand {
    fn kind(&self) -> CommandKind {
        match self {
            Self::ClockIn(_) => CommandKind::ClockIn,
            Self::ClockOut => CommandKind::ClockOut,
            Self::Break { .. } => CommandKind::Break,
        }
    }
}

/// Why a break needs a reviewed correction instead of an automatic record.
fn break_review_error(review: BreakReview) -> ClockCommandError {
    ClockCommandError::pre_send(match review {
        BreakReview::ClockDiscontinuity => {
            "The device clock changed while you were away, so this break cannot be recorded automatically. Nothing was recorded. Enter the break as a time correction in Z8."
        }
        BreakReview::StartZoneUnavailable | BreakReview::ReturnZoneUnavailable => {
            "The device time zone could not be read while you were away, so this break cannot be recorded automatically. Nothing was recorded. Enter the break as a time correction in Z8."
        }
    })
}

/// Observed when the user acted, before any lock, network or storage work.
pub struct ActionEvidence {
    pub occurred_at: DateTime<Utc>,
    /// Device IANA zone at action time; None when it cannot be determined.
    pub timezone: Option<String>,
}

/// One signed-in session's view of this installation: the HTTP service, the
/// device stores, and the endpoint and token of the session.
pub struct ClockSession<'a> {
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

fn storage_paused() -> ClockCommandError {
    ClockCommandError::pre_send(STORAGE_PAUSED)
}

/// How this action is sent. Chosen before anything is frozen, so a frozen
/// command is never downgraded to the legacy transport afterwards.
enum Route {
    Commands {
        capabilities: Capabilities,
        context: CommandContext,
        status: Option<ClockStatus>,
    },
    Legacy,
}

/// What the server offers this session now, or what it offered it before.
pub enum Negotiated {
    /// Fetched now and cached for this endpoint and session.
    Live(Capabilities),
    /// The server is unreachable: only what this session negotiated earlier.
    Cached(Option<Capabilities>),
    Unauthorized,
    NotOffered,
}

impl Negotiated {
    pub fn capabilities(&self) -> Option<&Capabilities> {
        match self {
            Self::Live(capabilities) => Some(capabilities),
            Self::Cached(capabilities) => capabilities.as_ref(),
            Self::Unauthorized | Self::NotOffered => None,
        }
    }
}

pub fn cached_capabilities(session: &ClockSession<'_>) -> anyhow::Result<Option<Capabilities>> {
    Ok(session
        .store
        .lock()
        .cached_context(session.endpoint, &token_fingerprint(session.token))?
        .and_then(|cached| Capabilities::parse(&cached.capabilities)))
}

pub async fn negotiate(session: &ClockSession<'_>) -> anyhow::Result<Negotiated> {
    Ok(
        match session
            .service
            .command_capabilities(session.endpoint, session.token)
            .await
        {
            CapabilitiesFetch::Fetched(capabilities) => {
                let mut store = session.store.lock();
                let cached = store.save_capabilities(
                    session.endpoint,
                    &token_fingerprint(session.token),
                    capabilities.raw(),
                    now_ms(),
                );
                let accepted = if capabilities.accepts_frozen_commands() {
                    store.record_endpoint_acceptance(session.endpoint, now_ms())
                } else {
                    Ok(())
                };
                if let Err(error) = cached.and(accepted) {
                    log::warn!("Clock context cache not updated: {error}");
                }
                Negotiated::Live(capabilities)
            }
            CapabilitiesFetch::Unreachable => Negotiated::Cached(cached_capabilities(session)?),
            CapabilitiesFetch::Unauthorized => Negotiated::Unauthorized,
            CapabilitiesFetch::NotOffered => Negotiated::NotOffered,
        },
    )
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

async fn choose_route(
    session: &ClockSession<'_>,
    kind: CommandKind,
) -> Result<Route, ClockCommandError> {
    let capabilities = match negotiate(session).await.map_err(|_| storage_paused())? {
        Negotiated::Unauthorized => {
            return Err(ClockCommandError::pre_send(
                "Your session has expired. Sign in again before clocking.",
            ))
        }
        // Offline, only a context this session negotiated earlier may be asserted.
        Negotiated::Live(capabilities) | Negotiated::Cached(Some(capabilities)) => capabilities,
        Negotiated::Cached(None) => {
            let accepted = session
                .store
                .lock()
                .endpoint_accepted_commands(session.endpoint)
                .map_err(|_| storage_paused())?;
            if accepted {
                // This server takes frozen commands, but this session cannot
                // confirm its context yet. The legacy writer is not a fallback.
                return Err(ClockCommandError::pre_send(
                    "This device has not confirmed your account with Z8 since you signed in. Connect once, then clock again. Nothing was recorded.",
                ));
            }
            return Ok(Route::Legacy);
        }
        Negotiated::NotOffered => return Ok(Route::Legacy),
    };
    // A server that takes frozen clock-in/out but predates atomic breaks keeps
    // the two-request break (#280).
    let Some(context) = capabilities
        .command_context()
        .filter(|_| capabilities.accepts_frozen_commands() && capabilities.supports(kind))
    else {
        return Ok(Route::Legacy);
    };
    let status = cached_status(session, &context).map_err(|_| storage_paused())?;
    Ok(Route::Commands {
        capabilities,
        context,
        status,
    })
}

/// The last status this session saw for the context's employee. Employee IDs
/// are organization-specific, so this binds the status to the context.
fn cached_status(
    session: &ClockSession<'_>,
    context: &CommandContext,
) -> anyhow::Result<Option<ClockStatus>> {
    Ok(session
        .store
        .lock()
        .cached_context(session.endpoint, &token_fingerprint(session.token))?
        .and_then(|cached| cached.status)
        .and_then(|status| serde_json::from_str::<ClockStatus>(&status).ok())
        .filter(|status| status.employee_id.as_deref() == Some(context.employee_id.as_str())))
}

/// The native caller serializes commands. No legacy command is automatically
/// retried: neither current status nor a failed response proves noncommitment.
pub async fn execute(
    session: &ClockSession<'_>,
    command: ClockCommand,
    evidence: ActionEvidence,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    if session.queue.lock().count().map_err(|_| {
        ClockCommandError::pre_send("Cannot read local recovery storage. Clock action paused.")
    })? > 0
    {
        return Err(ClockCommandError::pre_send("Unresolved desktop records require review before another clock action. Check your time entries in Z8."));
    }

    // A break whose interval is uncertain is recorded by no transport; it needs
    // a reviewed correction.
    if let ClockCommand::Break { evidence, .. } = &command {
        if !evidence.clocks_agree() {
            return Err(break_review_error(BreakReview::ClockDiscontinuity));
        }
    }

    match choose_route(session, command.kind()).await? {
        Route::Commands {
            capabilities,
            context,
            status,
        } => {
            // A break carries the zones it observed; other actions need the zone
            // read at the click. This context accepts frozen commands, so the
            // legacy writer is not a fallback either way.
            let timezone = match (&command, evidence.timezone) {
                (ClockCommand::Break { .. }, _) => String::new(),
                (_, Some(timezone)) => timezone,
                (_, None) => {
                    return Err(ClockCommandError::pre_send(
                        "The device time zone could not be read, so this clock action was not recorded. Try again.",
                    ))
                }
            };
            let frame = CommandFrame {
                operation_id: new_operation_id(),
                context,
                occurred_at: evidence.occurred_at,
                timezone,
                // Every desktop command is saved before sending and may be
                // delivered late, online or not, so each one declares delayed.
                admission: Admission::Delayed,
                depends_on: None,
            };
            let frozen = freeze_command(session, &command, frame, status)?;
            send_frozen(session, &capabilities, frozen).await
        }
        Route::Legacy => {
            let unresolved = session
                .store
                .lock()
                .active()
                .map_err(|_| storage_paused())?
                .into_iter()
                .any(|saved| saved.endpoint == session.endpoint);
            if unresolved {
                return Err(ClockCommandError::pre_send(
                    "Clock actions saved on this device must reach the server first. Refresh status and check the saved actions.",
                ));
            }
            execute_legacy(session, command).await
        }
    }
}

/// Binds the action to the work it continues and freezes it.
fn freeze_command(
    session: &ClockSession<'_>,
    command: &ClockCommand,
    mut frame: CommandFrame,
    status: Option<ClockStatus>,
) -> Result<FrozenCommand, ClockCommandError> {
    let active: Vec<_> = session
        .store
        .lock()
        .for_context(session.endpoint, &frame.context)
        .map_err(|_| storage_paused())?
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
    frame.depends_on = last.map(|saved| saved.operation_id.clone());
    // The work a clock-out or break closes: the work an unsent clock-in or break
    // creates, or else the period last seen for this employee. Never whichever
    // period is active when the command is sent.
    let target = || match last {
        Some(saved) if saved.kind != CommandKind::ClockOut => {
            Ok(ClockTarget::ClockInOperation(saved.operation_id.clone()))
        }
        Some(_) => Err(ClockCommandError::pre_send(
            "A clock-out is already saved on this device.",
        )),
        None => match &status {
            Some(ClockStatus {
                is_clocked_in: true,
                active_work_period: Some(period),
                ..
            }) => Ok(ClockTarget::WorkPeriod(period.id.clone())),
            Some(_) => Err(ClockCommandError::pre_send(
                "You are not clocked in. Refresh status before another action.",
            )),
            None => Err(ClockCommandError::pre_send(
                "Clock status is unknown. Refresh status before clocking out.",
            )),
        },
    };
    match command {
        ClockCommand::ClockIn(location) => {
            let clocked_in = match last {
                Some(saved) => saved.kind != CommandKind::ClockOut,
                None => status.is_some_and(|status| status.is_clocked_in),
            };
            if clocked_in {
                return Err(ClockCommandError::pre_send(
                    "You are already clocked in. Refresh status before another action.",
                ));
            }
            Ok(freeze_clock_in(frame, *location))
        }
        ClockCommand::ClockOut => Ok(freeze_clock_out(frame, target()?)),
        ClockCommand::Break { evidence, location } => {
            let target = target()?;
            // The target must be the work the employee was in when they went
            // idle. Work that started later means it changed while they were away.
            let work_start = match last {
                Some(saved) => Some(saved.occurred_at.as_str()),
                None => status
                    .as_ref()
                    .and_then(|status| status.active_work_period.as_ref())
                    .map(|period| period.start_time.as_str()),
            };
            let started_before_break = work_start
                .and_then(|start| DateTime::parse_from_rfc3339(start).ok())
                .is_some_and(|start| start < evidence.idle.last_activity.utc);
            if !started_before_break {
                return Err(ClockCommandError::pre_send(
                    "Your clocked work changed while you were away, so this break cannot be recorded automatically. Nothing was recorded. Enter the break as a time correction in Z8.",
                ));
            }
            freeze_break(frame, target, *location, evidence).map_err(break_review_error)
        }
    }
}

async fn send_frozen(
    session: &ClockSession<'_>,
    capabilities: &Capabilities,
    frozen: FrozenCommand,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    session
        .store
        .lock()
        .capture(session.endpoint, &frozen, now_ms())
        .map_err(|_| {
            ClockCommandError::pre_send(
                "This clock action could not be saved on this device, so nothing was sent. Try again.",
            )
        })?;
    // Storage errors after capture leave the command saved; its state decides.
    send_saved(session, capabilities, Pacing::Now).await;
    let saved = session
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
            let mut write = session
                .service
                .committed_with_status(session.endpoint, session.token, Vec::new())
                .await;
            write.operation_id = Some(saved.operation_id);
            if let Some(status) = &write.status {
                remember_status(session.store, session.endpoint, session.token, status);
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

async fn send_saved(session: &ClockSession<'_>, capabilities: &Capabilities, pacing: Pacing) {
    if let Err(error) = command_sync::drain(
        session.service,
        session.store,
        session.endpoint,
        session.token,
        capabilities,
        pacing,
        now_ms,
    )
    .await
    {
        log::warn!("Saved clock commands were not fully processed: {error}");
    }
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

/// Reports saved commands without the network, from this session's cache.
pub fn journal_offline(session: &ClockSession<'_>) -> anyhow::Result<ClockJournal> {
    let capabilities = cached_capabilities(session)?;
    let context = capabilities
        .as_ref()
        .and_then(Capabilities::command_context);
    let legacy = session.queue.lock().recovery_summary()?;
    clock_journal::build(
        &session.store.lock(),
        legacy,
        JournalScope {
            endpoint: session.endpoint,
            context: context.as_ref(),
            server_reachable: true,
            commands_enabled: false,
            breaks_enabled: false,
            last_known: None,
        },
    )
}

/// Sends saved commands of the session's current context, then reports what
/// the UI may show. Runs without the server too, from the cached context.
pub async fn sync(session: &ClockSession<'_>, pacing: Pacing) -> anyhow::Result<ClockJournal> {
    let negotiated = negotiate(session).await?;
    if let Negotiated::Live(capabilities) = &negotiated {
        send_saved(session, capabilities, pacing).await;
    }
    let server_reachable = !matches!(negotiated, Negotiated::Cached(_));
    let capabilities = negotiated.capabilities();
    let context = capabilities.and_then(Capabilities::command_context);
    // Offline, the last status seen for this employee stands in for the server's.
    let last_known = match (&context, server_reachable) {
        (Some(context), false) => cached_status(session, context)?.map(|status| Projection {
            is_clocked_in: status.is_clocked_in,
            since: status.active_work_period.map(|period| period.start_time),
        }),
        _ => None,
    };
    let legacy = session.queue.lock().recovery_summary()?;
    let journal = clock_journal::build(
        &session.store.lock(),
        legacy,
        JournalScope {
            endpoint: session.endpoint,
            context: context.as_ref(),
            server_reachable,
            commands_enabled: capabilities.is_some_and(Capabilities::accepts_frozen_commands),
            breaks_enabled: capabilities.is_some_and(|capabilities| {
                capabilities.accepts_frozen_commands() && capabilities.supports(CommandKind::Break)
            }),
            last_known,
        },
    )?;
    Ok(journal)
}

async fn execute_legacy(
    session: &ClockSession<'_>,
    command: ClockCommand,
) -> Result<ClockCommandOutcome, ClockCommandError> {
    let (service, webapp_url, token) = (session.service, session.endpoint, session.token);
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
        // The legacy two-request break is unchanged: it closes at the idle start
        // and resumes at request time, and neither request is atomic (#268).
        ClockCommand::Break { evidence, location } => {
            let instant = evidence.idle.last_activity.utc;
            let result = service
                .break_with_status(webapp_url, token, instant, location)
                .await;
            let mut payload = serde_json::json!({
                "breakStartTime": instant.to_rfc3339_opts(SecondsFormat::AutoSi, true),
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
                remember_status(session.store, session.endpoint, session.token, status);
            }
            Ok(ClockCommandOutcome::Committed { write })
        }
        Err(_) => {
            // This is failure-observation time in seconds, NOT original click
            // time or a future replay timestamp. Keep the legacy format intact.
            let recovery_id = session.queue.lock().enqueue(action_type, Utc::now().timestamp(), payload)
                .map_err(|_| ClockCommandError::uncertain(
                    "Clock outcome is unconfirmed and local recovery could not be saved. Check your time entries before trying again; do not assume the write failed.",
                ))?;
            Ok(ClockCommandOutcome::RetainedForReview { recovery_id })
        }
    }
}
