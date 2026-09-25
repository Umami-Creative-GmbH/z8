//! What the desktop UI may show about saved clock commands (#280).
//!
//! Details are disclosed only for the session's current context. Commands
//! captured under another account, organization, employee or server are
//! counted, never described.
use anyhow::Result;
use serde::Serialize;

use crate::command_store::{CommandFailure, CommandState, CommandStore, StoredCommand, WaitingFor};
use crate::frozen_command::{CommandContext, CommandKind};
use crate::offline::RecoverySummary;

/// Resolved commands shown next to the active ones.
const RECENT_RESOLVED: usize = 10;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandView {
    pub operation_id: String,
    pub kind: CommandKind,
    pub occurred_at: String,
    pub timezone: String,
    pub state: CommandState,
    pub attempts: i64,
    pub captured_at_ms: i64,
    pub depends_on: Option<String>,
    pub failure: Option<CommandFailure>,
    /// What a paused command waits for.
    pub waiting_for: Option<WaitingFor>,
    /// Refused without committed work under its identity, so it may be archived.
    pub archivable: bool,
    /// The exact frozen command, for inspection and export.
    pub command: String,
    /// The server's original receipt; current status is a separate read.
    pub receipt: Option<String>,
}

impl From<StoredCommand> for CommandView {
    fn from(command: StoredCommand) -> Self {
        Self {
            operation_id: command.operation_id,
            kind: command.kind,
            occurred_at: command.occurred_at,
            timezone: command.timezone,
            state: command.state,
            attempts: command.attempts,
            captured_at_ms: command.captured_at_ms,
            depends_on: command.depends_on,
            waiting_for: command
                .failure
                .as_ref()
                .and_then(CommandFailure::waiting_for),
            archivable: command.state == CommandState::Rejected
                && command
                    .failure
                    .as_ref()
                    .is_some_and(CommandFailure::refused_without_commit),
            failure: command.failure,
            command: command.command,
            receipt: command.receipt,
        }
    }
}

/// Clock state once the saved, possibly committing commands are applied.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub is_clocked_in: bool,
    pub since: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockJournal {
    /// Identity-less records from the legacy transport.
    pub legacy: RecoverySummary,
    pub server_reachable: bool,
    /// A new action can be frozen for the session's context now.
    pub commands_enabled: bool,
    pub commands: Vec<CommandView>,
    pub other_contexts: usize,
    pub projection: Option<Projection>,
}

/// The session a journal is built for.
pub struct JournalScope<'a> {
    pub endpoint: &'a str,
    /// The session's current context, when it is known.
    pub context: Option<&'a CommandContext>,
    pub server_reachable: bool,
    pub commands_enabled: bool,
    /// Shown when no saved command determines the clock state.
    pub last_known: Option<Projection>,
}

pub fn build(
    store: &CommandStore,
    legacy: RecoverySummary,
    scope: JournalScope<'_>,
) -> Result<ClockJournal> {
    let JournalScope {
        endpoint,
        context,
        server_reachable,
        commands_enabled,
        last_known,
    } = scope;
    let own =
        |command: &StoredCommand| command.endpoint == endpoint && Some(&command.context) == context;
    let other_contexts = store
        .active()?
        .iter()
        .filter(|command| !own(command))
        .count();
    let mut commands = match context {
        Some(context) => store.for_context(endpoint, context)?,
        None => Vec::new(),
    };
    let projection = commands
        .iter()
        .filter(|command| matches!(command.state, CommandState::Pending | CommandState::Stalled))
        .last()
        .map(|command| Projection {
            is_clocked_in: command.kind == CommandKind::ClockIn,
            since: (command.kind == CommandKind::ClockIn).then(|| command.occurred_at.clone()),
        })
        .or(last_known);
    // Active first in capture order, then the most recently resolved.
    let (mut shown, mut resolved): (Vec<_>, Vec<_>) = commands
        .drain(..)
        .partition(|command| command.state.is_active());
    resolved.sort_by_key(|command| std::cmp::Reverse(command.resolved_at_ms));
    shown.extend(resolved.into_iter().take(RECENT_RESOLVED));
    Ok(ClockJournal {
        legacy,
        server_reachable,
        commands_enabled,
        commands: shown.into_iter().map(CommandView::from).collect(),
        other_contexts,
        projection,
    })
}
