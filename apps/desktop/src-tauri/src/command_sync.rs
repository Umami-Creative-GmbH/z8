//! Sends saved clock commands and records their outcomes (#280).
//!
//! Only commands captured for the current endpoint, account, organization,
//! employee and server are processed; others wait for their own context.
//! Commands go out in capture order, and the first one that does not commit
//! stops the run, so no command overtakes the one it depends on.
//! A command that may already have reached the server is looked up before it
//! is sent again, and it is always resent with the same identity and bytes.
use anyhow::Result;
use parking_lot::Mutex;

use crate::clock::ClockService;
use crate::command_store::{
    CommandFailure, CommandState, CommandStore, FailureClass, StoredCommand,
};
use crate::command_transport::{Capabilities, HttpReply};

const BACKOFF_BASE_MS: i64 = 30_000;
const BACKOFF_MAX_MS: i64 = 30 * 60_000;

#[derive(Debug)]
pub enum SendOutcome {
    Committed(String),
    Failed(CommandFailure),
}

#[derive(Debug)]
pub enum LookupOutcome {
    Committed(String),
    NotCommitted,
    Failed(CommandFailure),
}

fn failure(class: FailureClass, code: &str, reply: &HttpReply, at_ms: i64) -> CommandFailure {
    let (http_status, response) = match reply {
        HttpReply::Answered { status, body, raw } => (
            Some(*status),
            Some(
                body.clone()
                    .unwrap_or_else(|| serde_json::Value::String(raw.clone())),
            ),
        ),
        HttpReply::Unreachable => (None, None),
    };
    CommandFailure {
        class,
        code: code.to_string(),
        http_status,
        response,
        at_ms,
    }
}

fn field<'a>(body: &'a Option<serde_json::Value>, name: &str) -> Option<&'a str> {
    body.as_ref()?.get(name)?.as_str()
}

/// Session, context, billing, adoption or version must change before a resend
/// can succeed. These pause the command without counting an attempt.
const PAUSED_CODES: [&str; 6] = [
    "unauthorized",
    "access_denied",
    "billing_required",
    "context_mismatch",
    "not_adopted",
    "unsupported_version",
];

/// A receipt counts only for the command that was sent.
pub fn classify_submission(reply: &HttpReply, operation_id: &str, at_ms: i64) -> SendOutcome {
    let HttpReply::Answered { status, body, raw } = reply else {
        return SendOutcome::Failed(failure(
            FailureClass::Transient,
            "unreachable",
            reply,
            at_ms,
        ));
    };
    let outcome = field(body, "outcome");
    if matches!(status, 200 | 201)
        && matches!(outcome, Some("executed" | "replayed"))
        && field(body, "operationId") == Some(operation_id)
    {
        return SendOutcome::Committed(raw.clone());
    }
    let (class, code) = match (outcome, field(body, "code")) {
        (Some("rejected"), Some(code)) if PAUSED_CODES.contains(&code) => {
            (FailureClass::Paused, code)
        }
        (Some("rejected"), Some(code @ "approval_policy_unavailable")) => {
            (FailureClass::Transient, code)
        }
        // Every other typed refusal was decided without writing.
        (Some("rejected"), Some(code)) => (FailureClass::Rejected, code),
        (Some("unknown"), _) => (FailureClass::Transient, "unknown"),
        _ if *status == 401 => (FailureClass::Paused, "unauthorized"),
        // A success status or server error without a readable answer may have committed.
        _ if *status < 300 || *status >= 500 => (FailureClass::Transient, "unrecognized_response"),
        _ => (FailureClass::Paused, "unrecognized_response"),
    };
    SendOutcome::Failed(failure(class, code, reply, at_ms))
}

pub fn classify_lookup(reply: &HttpReply, operation_id: &str, at_ms: i64) -> LookupOutcome {
    let HttpReply::Answered { status, body, raw } = reply else {
        return LookupOutcome::Failed(failure(
            FailureClass::Transient,
            "unreachable",
            reply,
            at_ms,
        ));
    };
    let answers_this_command = field(body, "operationId") == Some(operation_id);
    match (*status, field(body, "outcome")) {
        (200, Some("committed")) if answers_this_command => LookupOutcome::Committed(raw.clone()),
        (200, Some("not_committed")) if answers_this_command => LookupOutcome::NotCommitted,
        // The identity is held by other work or another scope. Never resend it.
        (200, Some("conflict")) => {
            LookupOutcome::Failed(failure(FailureClass::Rejected, "conflict", reply, at_ms))
        }
        (401, _) => {
            LookupOutcome::Failed(failure(FailureClass::Paused, "unauthorized", reply, at_ms))
        }
        (403, _) => {
            LookupOutcome::Failed(failure(FailureClass::Paused, "access_denied", reply, at_ms))
        }
        (status, _) if status >= 500 => LookupOutcome::Failed(failure(
            FailureClass::Transient,
            "lookup_unavailable",
            reply,
            at_ms,
        )),
        (status, _) if status < 300 => LookupOutcome::Failed(failure(
            FailureClass::Transient,
            "unrecognized_response",
            reply,
            at_ms,
        )),
        _ => LookupOutcome::Failed(failure(
            FailureClass::Paused,
            "unrecognized_response",
            reply,
            at_ms,
        )),
    }
}

fn backoff_ms(transient_failures: i64) -> i64 {
    let exponent = (transient_failures - 1).clamp(0, 16) as u32;
    (BACKOFF_BASE_MS.saturating_mul(1 << exponent)).min(BACKOFF_MAX_MS)
}

/// Processes the current context's saved commands. `force` skips the retry
/// backoff; it is used for a fresh user action or an explicit retry.
pub async fn drain(
    service: &ClockService,
    store: &Mutex<CommandStore>,
    endpoint: &str,
    token: &str,
    capabilities: &Capabilities,
    force: bool,
    now_ms: impl Fn() -> i64,
) -> Result<()> {
    let Some(context) = capabilities.command_context() else {
        return Ok(());
    };
    let commands: Vec<StoredCommand> = store
        .lock()
        .for_context(endpoint, &context)?
        .into_iter()
        .filter(|command| command.state.is_active())
        .collect();

    for command in commands {
        // A command awaiting review or an explicit retry holds back every later
        // one. Each command depends on the one captured before it (`depends_on`),
        // so stopping here also pauses all dependants.
        if command.state != CommandState::Pending {
            return Ok(());
        }
        if !force
            && command.transient_failures > 0
            && command
                .failure
                .as_ref()
                .is_some_and(|last| now_ms() < last.at_ms + backoff_ms(command.transient_failures))
        {
            return Ok(());
        }

        if command.attempts > 0 {
            let reply = service
                .lookup_command(endpoint, token, &command.operation_id)
                .await;
            match classify_lookup(&reply, &command.operation_id, now_ms()) {
                LookupOutcome::Committed(receipt) => {
                    store
                        .lock()
                        .record_receipt(command.recovery_id, &receipt, now_ms())?;
                    continue;
                }
                LookupOutcome::NotCommitted => {}
                LookupOutcome::Failed(failure) => {
                    store.lock().record_failure(command.recovery_id, &failure)?;
                    return Ok(());
                }
            }
        }

        if !capabilities.supports(command.kind) || !capabilities.accepts_fresh_commands() {
            let failure = CommandFailure {
                class: FailureClass::Paused,
                code: "submit_unavailable".into(),
                http_status: None,
                response: Some(serde_json::from_str(capabilities.raw())?),
                at_ms: now_ms(),
            };
            store.lock().record_failure(command.recovery_id, &failure)?;
            return Ok(());
        }

        // Never send without first recording that the send may happen.
        store.lock().mark_attempt(command.recovery_id, now_ms())?;
        let reply = service
            .submit_command(endpoint, token, &command.command)
            .await;
        match classify_submission(&reply, &command.operation_id, now_ms()) {
            SendOutcome::Committed(receipt) => {
                store
                    .lock()
                    .record_receipt(command.recovery_id, &receipt, now_ms())?;
            }
            SendOutcome::Failed(failure) => {
                store.lock().record_failure(command.recovery_id, &failure)?;
                return Ok(());
            }
        }
    }
    Ok(())
}
