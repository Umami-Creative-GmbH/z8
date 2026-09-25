//! Durable local lifecycle of frozen clock commands (#280).
//!
//! Lives in the existing `offline_queue.db` next to the legacy `queue` table,
//! which it never reads or rewrites. Old binaries only know `queue`, so they
//! cannot process or delete these records. The frozen business command is
//! immutable; attempts, failures and the committed receipt are separate
//! lifecycle columns. Unresolved evidence cannot be deleted.
use anyhow::{anyhow, ensure, Result};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

use crate::frozen_command::{CommandContext, CommandKind, FrozenCommand, CLOCK_COMMAND_VERSION};

/// `PRAGMA user_version` of the database. Version 0 is the legacy queue alone.
pub const COMMAND_STORE_VERSION: i64 = 1;
/// Automatic attempts stop here; the record stays until the user retries it.
pub const MAX_TRANSIENT_FAILURES: i64 = 8;

const SCHEMA_V1: &str = "
CREATE TABLE clock_command (
    recovery_id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    command_version INTEGER NOT NULL,
    kind TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    context_user_id TEXT NOT NULL,
    context_organization_id TEXT NOT NULL,
    context_employee_id TEXT NOT NULL,
    context_server TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    depends_on_operation_id TEXT,
    command TEXT NOT NULL,
    captured_at_ms INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'stalled', 'rejected', 'committed', 'archived')),
    attempts INTEGER NOT NULL DEFAULT 0,
    transient_failures INTEGER NOT NULL DEFAULT 0,
    last_attempt_at_ms INTEGER,
    failure TEXT,
    receipt TEXT,
    resolved_at_ms INTEGER
);
CREATE INDEX idx_clock_command_state ON clock_command(state, recovery_id);
CREATE TRIGGER clock_command_frozen
BEFORE UPDATE OF operation_id, command_version, kind, endpoint, context_user_id,
    context_organization_id, context_employee_id, context_server, occurred_at, timezone,
    depends_on_operation_id, command, captured_at_ms ON clock_command
BEGIN SELECT RAISE(ABORT, 'frozen clock command is immutable'); END;
CREATE TRIGGER clock_command_retained
BEFORE DELETE ON clock_command WHEN OLD.state <> 'committed'
BEGIN SELECT RAISE(ABORT, 'unresolved clock evidence is retained'); END;
CREATE TABLE clock_context (
    endpoint TEXT PRIMARY KEY,
    session_fingerprint TEXT NOT NULL,
    capabilities TEXT NOT NULL,
    capabilities_at_ms INTEGER NOT NULL,
    status TEXT,
    status_at_ms INTEGER
);
CREATE TABLE clock_endpoint (
    endpoint TEXT PRIMARY KEY,
    accepted_commands_at_ms INTEGER NOT NULL
);
";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandState {
    /// Saved; sent automatically, in order, while its context is current.
    Pending,
    /// Outcome unknown after the automatic attempt bound. Retried only on request.
    Stalled,
    /// The server refused it without writing. Needs review.
    Rejected,
    /// The server's committed receipt is stored. No longer active.
    Committed,
    /// A rejected command the user set aside. Evidence retained.
    Archived,
}

impl CommandState {
    fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "pending" => Self::Pending,
            "stalled" => Self::Stalled,
            "rejected" => Self::Rejected,
            "committed" => Self::Committed,
            "archived" => Self::Archived,
            other => return Err(anyhow!("Unknown clock command state {other}")),
        })
    }

    pub fn is_active(self) -> bool {
        matches!(self, Self::Pending | Self::Stalled | Self::Rejected)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureClass {
    /// Transport or server failure; the outcome is unknown and the same command is resent.
    Transient,
    /// Session, context, billing or adoption must change first. Nothing is counted.
    Paused,
    /// Refused without writing; needs review.
    Rejected,
}

/// Refusals that point at existing committed evidence under the identity. They
/// are reviewed like other refusals but can never be archived.
pub const COMMITTED_EVIDENCE_CODES: [&str; 3] =
    ["collision", "integrity_review_required", "conflict"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandFailure {
    pub class: FailureClass,
    pub code: String,
    pub http_status: Option<u16>,
    /// The server's response body, kept as evidence.
    pub response: Option<serde_json::Value>,
    pub at_ms: i64,
}

/// What a paused command waits for before a resend can succeed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WaitingFor {
    SignIn,
    Access,
    Subscription,
    OriginalContext,
    ServerAdoption,
    AppUpdate,
    /// An answer the app does not recognize.
    Server,
}

impl WaitingFor {
    /// The server refusals that pause a command instead of rejecting it.
    pub fn for_code(code: &str) -> Option<Self> {
        Some(match code {
            "unauthorized" => Self::SignIn,
            "access_denied" => Self::Access,
            "billing_required" => Self::Subscription,
            "context_mismatch" => Self::OriginalContext,
            "not_adopted" | "submit_unavailable" => Self::ServerAdoption,
            "unsupported_version" => Self::AppUpdate,
            _ => return None,
        })
    }
}

impl CommandFailure {
    /// Whether the server refused the command without any committed work
    /// under its identity, so that setting it aside hides nothing.
    pub fn refused_without_commit(&self) -> bool {
        self.class == FailureClass::Rejected
            && !COMMITTED_EVIDENCE_CODES.contains(&self.code.as_str())
    }

    pub fn waiting_for(&self) -> Option<WaitingFor> {
        (self.class == FailureClass::Paused)
            .then(|| WaitingFor::for_code(&self.code).unwrap_or(WaitingFor::Server))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCommand {
    /// Local recovery identity. Never the business operation identity.
    pub recovery_id: i64,
    pub operation_id: String,
    pub kind: CommandKind,
    pub endpoint: String,
    pub context: CommandContext,
    pub occurred_at: String,
    pub timezone: String,
    pub depends_on: Option<String>,
    /// The exact frozen body.
    pub command: String,
    pub captured_at_ms: i64,
    pub state: CommandState,
    /// Sends started. A positive count means the server may have committed it.
    pub attempts: i64,
    pub transient_failures: i64,
    pub last_attempt_at_ms: Option<i64>,
    pub failure: Option<CommandFailure>,
    pub receipt: Option<String>,
    pub resolved_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CachedContext {
    pub capabilities: String,
    pub capabilities_at_ms: i64,
    pub status: Option<String>,
}

/// Binds the context cache to one session without storing the token again.
pub fn token_fingerprint(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

const COLUMNS: &str = "recovery_id, operation_id, kind, endpoint, context_user_id,
    context_organization_id, context_employee_id, context_server, occurred_at, timezone,
    depends_on_operation_id, command, captured_at_ms, state, attempts, transient_failures,
    last_attempt_at_ms, failure, receipt, resolved_at_ms";

fn conversion_error(column: usize, error: impl Into<anyhow::Error>) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        column,
        rusqlite::types::Type::Text,
        error.into().into(),
    )
}

fn stored_command(row: &Row<'_>) -> rusqlite::Result<StoredCommand> {
    let kind: String = row.get(2)?;
    let state: String = row.get(13)?;
    let failure: Option<String> = row.get(17)?;
    Ok(StoredCommand {
        recovery_id: row.get(0)?,
        operation_id: row.get(1)?,
        kind: CommandKind::parse(&kind)
            .ok_or_else(|| conversion_error(2, anyhow!("Unknown clock command kind {kind}")))?,
        endpoint: row.get(3)?,
        context: CommandContext {
            user_id: row.get(4)?,
            organization_id: row.get(5)?,
            employee_id: row.get(6)?,
            server: row.get(7)?,
        },
        occurred_at: row.get(8)?,
        timezone: row.get(9)?,
        depends_on: row.get(10)?,
        command: row.get(11)?,
        captured_at_ms: row.get(12)?,
        state: CommandState::parse(&state).map_err(|error| conversion_error(13, error))?,
        attempts: row.get(14)?,
        transient_failures: row.get(15)?,
        last_attempt_at_ms: row.get(16)?,
        failure: failure
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| conversion_error(17, error))?,
        receipt: row.get(18)?,
        resolved_at_ms: row.get(19)?,
    })
}

pub struct CommandStore {
    conn: Connection,
}

impl CommandStore {
    /// Opens the shared device database and upgrades it in one transaction.
    /// An interrupted upgrade leaves the legacy database exactly as it was, and
    /// a newer store version is refused rather than read by an older client.
    pub fn open(app_data_dir: &Path) -> Result<Self> {
        let mut conn = Connection::open(app_data_dir.join("offline_queue.db"))?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        let transaction = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version: i64 = transaction.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        ensure!(
            version <= COMMAND_STORE_VERSION,
            "Clock storage was written by a newer Z8 Timer (version {version}). Clock actions are paused."
        );
        if version < 1 {
            transaction.execute_batch(SCHEMA_V1)?;
            transaction.execute_batch("PRAGMA user_version = 1")?;
        }
        transaction.commit()?;
        Ok(Self { conn })
    }

    /// Acceptance means the committed row, not a successful INSERT alone.
    pub fn capture(
        &mut self,
        endpoint: &str,
        command: &FrozenCommand,
        captured_at_ms: i64,
    ) -> Result<i64> {
        let transaction = self.conn.transaction()?;
        let changed = transaction.execute(
            "INSERT INTO clock_command (operation_id, command_version, kind, endpoint,
                context_user_id, context_organization_id, context_employee_id, context_server,
                occurred_at, timezone, depends_on_operation_id, command, captured_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                command.operation_id,
                CLOCK_COMMAND_VERSION,
                command.kind.as_str(),
                endpoint,
                command.context.user_id,
                command.context.organization_id,
                command.context.employee_id,
                command.context.server,
                command.occurred_at,
                command.timezone,
                command.depends_on,
                command.body,
                captured_at_ms,
            ],
        )?;
        ensure!(changed == 1, "Clock command was not saved");
        let recovery_id = transaction.last_insert_rowid();
        transaction.commit()?;
        Ok(recovery_id)
    }

    pub fn get(&self, operation_id: &str) -> Result<Option<StoredCommand>> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {COLUMNS} FROM clock_command WHERE operation_id = ?"),
                [operation_id],
                stored_command,
            )
            .optional()?)
    }

    fn select(&self, filter: &str, values: &[&dyn rusqlite::ToSql]) -> Result<Vec<StoredCommand>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM clock_command WHERE {filter} ORDER BY recovery_id"
        ))?;
        let rows = statement.query_map(values, stored_command)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Every unresolved command of every context, in capture order.
    pub fn active(&self) -> Result<Vec<StoredCommand>> {
        self.select("state IN ('pending', 'stalled', 'rejected')", &[])
    }

    /// All retained commands captured for exactly this endpoint and context.
    pub fn for_context(
        &self,
        endpoint: &str,
        context: &CommandContext,
    ) -> Result<Vec<StoredCommand>> {
        self.select(
            "endpoint = ? AND context_user_id = ? AND context_organization_id = ?
                AND context_employee_id = ? AND context_server = ?",
            &[
                &endpoint,
                &context.user_id,
                &context.organization_id,
                &context.employee_id,
                &context.server,
            ],
        )
    }

    fn update_one(&mut self, statement: &str, values: &[&dyn rusqlite::ToSql]) -> Result<()> {
        let transaction = self.conn.transaction()?;
        let changed = transaction.execute(statement, values)?;
        ensure!(changed == 1, "Clock command is not in the expected state");
        transaction.commit()?;
        Ok(())
    }

    /// Recorded before every send, so that after a crash the command is looked
    /// up before it is sent again.
    pub fn mark_attempt(&mut self, recovery_id: i64, at_ms: i64) -> Result<()> {
        self.update_one(
            "UPDATE clock_command SET attempts = attempts + 1, last_attempt_at_ms = ?
             WHERE recovery_id = ? AND state = 'pending'",
            &[&at_ms, &recovery_id],
        )
    }

    /// Leaves the active queue only together with the committed receipt.
    pub fn record_receipt(&mut self, recovery_id: i64, receipt: &str, at_ms: i64) -> Result<()> {
        self.update_one(
            "UPDATE clock_command SET state = 'committed', receipt = ?, resolved_at_ms = ?
             WHERE recovery_id = ? AND state IN ('pending', 'stalled')",
            &[&receipt, &at_ms, &recovery_id],
        )
    }

    pub fn record_failure(
        &mut self,
        recovery_id: i64,
        failure: &CommandFailure,
    ) -> Result<CommandState> {
        let evidence = serde_json::to_string(failure)?;
        let transaction = self.conn.transaction()?;
        let changed = match failure.class {
            FailureClass::Transient => transaction.execute(
                "UPDATE clock_command SET failure = ?, transient_failures = transient_failures + 1,
                    state = CASE WHEN transient_failures + 1 >= ? THEN 'stalled' ELSE state END
                 WHERE recovery_id = ? AND state = 'pending'",
                params![evidence, MAX_TRANSIENT_FAILURES, recovery_id],
            )?,
            FailureClass::Paused => transaction.execute(
                "UPDATE clock_command SET failure = ? WHERE recovery_id = ? AND state = 'pending'",
                params![evidence, recovery_id],
            )?,
            FailureClass::Rejected => transaction.execute(
                "UPDATE clock_command SET failure = ?, state = 'rejected'
                 WHERE recovery_id = ? AND state = 'pending'",
                params![evidence, recovery_id],
            )?,
        };
        ensure!(changed == 1, "Clock command is not in the expected state");
        let state: String = transaction.query_row(
            "SELECT state FROM clock_command WHERE recovery_id = ?",
            [recovery_id],
            |row| row.get(0),
        )?;
        transaction.commit()?;
        CommandState::parse(&state)
    }

    /// Exact retry of a stalled command: same identity, same bytes.
    pub fn retry(&mut self, operation_id: &str) -> Result<()> {
        self.update_one(
            "UPDATE clock_command SET state = 'pending', transient_failures = 0
             WHERE operation_id = ? AND state = 'stalled'",
            &[&operation_id],
        )
    }

    /// Sets aside a command the server refused without writing. The evidence
    /// stays; this cancels nothing on the server.
    pub fn archive(&mut self, operation_id: &str, at_ms: i64) -> Result<()> {
        let refused = self
            .get(operation_id)?
            .and_then(|command| command.failure)
            .is_some_and(|failure| failure.refused_without_commit());
        ensure!(
            refused,
            "Only a command refused without committed work can be archived"
        );
        self.update_one(
            "UPDATE clock_command SET state = 'archived', resolved_at_ms = ?
             WHERE operation_id = ? AND state = 'rejected'",
            &[&at_ms, &operation_id],
        )
    }

    /// Removes committed commands resolved before the cutoff, unless an
    /// unresolved command still depends on them. Nothing else is ever deleted.
    pub fn prune_committed(&mut self, resolved_before_ms: i64) -> Result<usize> {
        let transaction = self.conn.transaction()?;
        let removed = transaction.execute(
            "DELETE FROM clock_command
             WHERE state = 'committed' AND resolved_at_ms < ?
               AND operation_id NOT IN (
                 SELECT depends_on_operation_id FROM clock_command
                 WHERE depends_on_operation_id IS NOT NULL
                   AND state IN ('pending', 'stalled', 'rejected'))",
            [resolved_before_ms],
        )?;
        transaction.commit()?;
        Ok(removed)
    }

    /// Replaces the endpoint's cached capabilities. A different session drops
    /// the previous session's status.
    pub fn save_capabilities(
        &mut self,
        endpoint: &str,
        session_fingerprint: &str,
        capabilities: &str,
        at_ms: i64,
    ) -> Result<()> {
        let transaction = self.conn.transaction()?;
        transaction.execute(
            "INSERT INTO clock_context (endpoint, session_fingerprint, capabilities, capabilities_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (endpoint) DO UPDATE SET
                capabilities = ?3, capabilities_at_ms = ?4,
                status = CASE WHEN session_fingerprint = ?2 THEN status END,
                status_at_ms = CASE WHEN session_fingerprint = ?2 THEN status_at_ms END,
                session_fingerprint = ?2",
            params![endpoint, session_fingerprint, capabilities, at_ms],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Saved only next to capabilities of the same session.
    pub fn save_status(
        &mut self,
        endpoint: &str,
        session_fingerprint: &str,
        status: &str,
        at_ms: i64,
    ) -> Result<bool> {
        let transaction = self.conn.transaction()?;
        let changed = transaction.execute(
            "UPDATE clock_context SET status = ?, status_at_ms = ?
             WHERE endpoint = ? AND session_fingerprint = ?",
            params![status, at_ms, endpoint, session_fingerprint],
        )?;
        transaction.commit()?;
        Ok(changed == 1)
    }

    pub fn cached_context(
        &self,
        endpoint: &str,
        session_fingerprint: &str,
    ) -> Result<Option<CachedContext>> {
        Ok(self
            .conn
            .query_row(
                "SELECT capabilities, capabilities_at_ms, status FROM clock_context
                 WHERE endpoint = ? AND session_fingerprint = ?",
                [endpoint, session_fingerprint],
                |row| {
                    Ok(CachedContext {
                        capabilities: row.get(0)?,
                        capabilities_at_ms: row.get(1)?,
                        status: row.get(2)?,
                    })
                },
            )
            .optional()?)
    }

    /// Logout forgets cached contexts. Captured commands and endpoint
    /// acceptance are not touched.
    pub fn forget_contexts(&mut self) -> Result<()> {
        self.conn.execute("DELETE FROM clock_context", [])?;
        Ok(())
    }

    /// Remembers that this endpoint accepted frozen commands on this device.
    /// It outlives logout, so that an offline session which cannot confirm its
    /// context refuses instead of using the legacy writer there.
    pub fn record_endpoint_acceptance(&mut self, endpoint: &str, at_ms: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO clock_endpoint (endpoint, accepted_commands_at_ms) VALUES (?1, ?2)
             ON CONFLICT (endpoint) DO UPDATE SET accepted_commands_at_ms = ?2",
            params![endpoint, at_ms],
        )?;
        Ok(())
    }

    pub fn endpoint_accepted_commands(&self, endpoint: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM clock_endpoint WHERE endpoint = ?",
                [endpoint],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }
}
