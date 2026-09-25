//! Pre-send durable capture and recovery through the real caller operation,
//! the real SQLite store and loopback HTTP (#280).
use crate::clock::WorkLocationType;
use crate::clock_command::{ClockCommand, ClockCommandOutcome};
use crate::command_store::{CommandState, FailureClass};
use crate::support::{capabilities, receipt, rejection, status, Device, PERIOD, SERVER};
use crate::test_http::{free_endpoint, request_body, request_line, serve, serve_on, server};
use rusqlite::Connection;
use std::sync::{Arc, Mutex as StdMutex};

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap()
}

/// The operation a submission or lookup request is about.
fn operation(request: &str) -> String {
    match request_line(request).split(' ').nth(1).unwrap() {
        "/api/time-entries/commands" => json(request_body(request))["operationId"]
            .as_str()
            .unwrap()
            .to_string(),
        path => path.rsplit('/').next().unwrap().to_string(),
    }
}

fn committed_lookup(request: &str) -> String {
    serde_json::json!({
        "outcome": "committed",
        "operationId": operation(request),
        "receipt": { "kind": "start_live_work", "result": { "workPeriodId": PERIOD } },
        "command": {},
        "evidence": "standing",
    })
    .to_string()
}

fn not_committed(request: &str) -> String {
    serde_json::json!({ "outcome": "not_committed", "operationId": operation(request) }).to_string()
}

fn clock_in() -> ClockCommand {
    ClockCommand::ClockIn(WorkLocationType::Office)
}

#[tokio::test]
async fn online_clock_in_is_frozen_and_saved_before_its_first_send() {
    let device = Device::new();
    let database = device.dir.path().join("offline_queue.db");
    let seen_before_send = Arc::new(StdMutex::new(None));
    let seen = seen_before_send.clone();
    let (url, server) = serve(3, move |index, request| match index {
        0 => Some((200, capabilities("org-1", "available"))),
        1 => {
            // The server receives exactly the bytes that are already durable.
            let row: (String, i64, String) = Connection::open(&database)
                .unwrap()
                .query_row(
                    "SELECT command, attempts, state FROM clock_command",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
            *seen.lock().unwrap() = Some((row, request_body(request).to_string()));
            Some((201, receipt("executed", request)))
        }
        _ => Some((200, status(true))),
    });

    let outcome = device
        .act(&url, ClockCommand::ClockIn(WorkLocationType::Home))
        .await
        .unwrap();

    let requests = server.join().unwrap();
    assert_eq!(
        request_line(&requests[0]),
        "GET /api/time-entries/commands HTTP/1.1"
    );
    assert_eq!(
        request_line(&requests[1]),
        "POST /api/time-entries/commands HTTP/1.1"
    );
    assert_eq!(
        request_line(&requests[2]),
        "GET /api/time-entries/status HTTP/1.1"
    );
    let ((stored, attempts, state), sent) = seen_before_send.lock().unwrap().take().unwrap();
    assert_eq!(stored, sent);
    assert_eq!(attempts, 1);
    assert_eq!(state, "pending");

    let command = json(&sent);
    assert_eq!(command["version"], 2);
    assert_eq!(command["kind"], "clock_in");
    assert_eq!(
        command["admission"], "delayed",
        "Saved before sending, so it may be delivered late"
    );
    assert_eq!(command["timezone"], "Europe/Berlin");
    assert_eq!(command["workLocationType"], "home");
    assert_eq!(command["context"]["organizationId"], "org-1");
    assert_eq!(command["context"]["server"], SERVER);

    let ClockCommandOutcome::Committed { write } = outcome else {
        panic!("Expected a committed receipt")
    };
    assert_eq!(
        write.operation_id.as_deref(),
        command["operationId"].as_str()
    );
    assert!(write.status.unwrap().is_clocked_in);
    let saved = device.saved();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].state, CommandState::Committed);
    assert_eq!(
        json(saved[0].receipt.as_deref().unwrap())["outcome"],
        "executed"
    );
}

#[tokio::test]
async fn lost_response_is_looked_up_after_restart_and_never_sent_twice() {
    let device = Device::new();
    let (url, server) = server(vec![Some((200, capabilities("org-1", "available"))), None]);
    let outcome = device.act(&url, clock_in()).await.unwrap();
    let requests = server.join().unwrap();
    let operation_id = operation(&requests[1]);
    let ClockCommandOutcome::SavedOnDevice {
        operation_id: saved,
        waiting,
    } = outcome
    else {
        panic!("An unanswered send is saved, not failed")
    };
    assert_eq!(saved, operation_id);
    assert_eq!(waiting.unwrap().class, FailureClass::Transient);

    let device = device.restart();
    let server = serve_on(&url, 1, |_, request| Some((200, committed_lookup(request))));
    device.sync(&url, "org-1", "available").await;
    let requests = server.join().unwrap();
    assert_eq!(
        request_line(&requests[0]),
        format!("GET /api/time-entries/commands/{operation_id} HTTP/1.1")
    );
    let saved = device.saved();
    assert_eq!(saved[0].state, CommandState::Committed);
    assert_eq!(
        saved[0].attempts, 1,
        "Recovered by lookup, not by a second send"
    );
    assert_eq!(
        json(saved[0].receipt.as_deref().unwrap())["evidence"],
        "standing"
    );
}

#[tokio::test]
async fn unknown_outcome_resends_the_identical_command_after_a_negative_lookup() {
    let device = Device::new();
    let (url, server) = serve(2, |index, request| match index {
        0 => Some((200, capabilities("org-1", "available"))),
        _ => Some((
            500,
            serde_json::json!({ "outcome": "unknown", "operationId": operation(request) })
                .to_string(),
        )),
    });
    device.act(&url, clock_in()).await.unwrap();
    let first = server.join().unwrap();

    let server = serve_on(&url, 2, |index, request| match index {
        0 => Some((200, not_committed(request))),
        _ => Some((200, receipt("replayed", request))),
    });
    device.sync(&url, "org-1", "available").await;
    let second = server.join().unwrap();
    assert!(request_line(&second[0]).starts_with("GET /api/time-entries/commands/"));
    assert_eq!(
        request_body(&second[1]),
        request_body(&first[1]),
        "Same identity and bytes"
    );
    let saved = device.saved();
    assert_eq!(saved[0].state, CommandState::Committed);
    assert_eq!(saved[0].attempts, 2);
}

#[tokio::test]
async fn offline_actions_bind_the_queued_clock_in_and_are_sent_in_order_after_restart() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated(&url, "org-1", false);

    let started = device
        .act(&url, ClockCommand::ClockIn(WorkLocationType::Remote))
        .await
        .unwrap();
    let closed = device.act(&url, ClockCommand::ClockOut).await.unwrap();
    assert!(matches!(started, ClockCommandOutcome::SavedOnDevice { .. }));
    assert!(matches!(closed, ClockCommandOutcome::SavedOnDevice { .. }));
    let saved = device.saved();
    assert_eq!(saved.len(), 2);
    let (start, close) = (json(&saved[0].command), json(&saved[1].command));
    assert_eq!(start["admission"], "delayed");
    assert_eq!(close["admission"], "delayed");
    assert_eq!(close["target"]["clockInOperationId"], start["operationId"]);
    assert_eq!(
        saved[1].depends_on.as_deref(),
        start["operationId"].as_str()
    );
    assert_eq!(
        saved[0].attempts, 1,
        "The offline attempt was recorded before sending"
    );
    assert_eq!(
        saved[1].attempts, 0,
        "A dependant is not sent before its predecessor"
    );
    let error = device.act(&url, ClockCommand::ClockOut).await.unwrap_err();
    assert!(error.message.contains("already saved"), "{}", error.message);

    let device = device.restart();
    let server = serve_on(&url, 3, |index, request| match index {
        0 => Some((200, not_committed(request))),
        _ => Some((201, receipt("executed", request))),
    });
    device.sync(&url, "org-1", "available").await;
    let requests = server.join().unwrap();
    assert_eq!(request_body(&requests[1]), saved[0].command);
    assert_eq!(request_body(&requests[2]), saved[1].command);
    assert!(device
        .saved()
        .iter()
        .all(|command| command.state == CommandState::Committed));
}

#[tokio::test]
async fn offline_clock_out_binds_the_period_last_seen_for_this_employee() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated(&url, "org-1", true);
    device.act(&url, ClockCommand::ClockOut).await.unwrap();
    let command = json(&device.saved()[0].command);
    assert_eq!(
        command["target"],
        serde_json::json!({ "workPeriodId": PERIOD })
    );
    assert_eq!(
        command["project"],
        serde_json::json!({ "kind": "preserve" })
    );
    assert_eq!(
        command["workCategory"],
        serde_json::json!({ "kind": "preserve" })
    );
}

#[tokio::test]
async fn a_context_switch_pauses_queued_work_instead_of_retargeting_it() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated(&url, "org-1", false);
    device.act(&url, clock_in()).await.unwrap();

    // The session now points at another organization: nothing is sent.
    device.sync(&url, "org-2", "available").await;
    let waiting = &device.saved()[0];
    assert_eq!(waiting.state, CommandState::Pending);
    assert_eq!(waiting.attempts, 1);
    assert_eq!(waiting.context.organization_id, "org-1");

    // Work in the new context is independent and proceeds.
    let server = serve_on(&url, 3, |index, request| match index {
        0 => Some((200, capabilities("org-2", "available"))),
        1 => Some((201, receipt("executed", request))),
        _ => Some((503, "{}".to_string())),
    });
    let outcome = device.act(&url, clock_in()).await.unwrap();
    let requests = server.join().unwrap();
    let ClockCommandOutcome::Committed { write } = outcome else {
        panic!("Independent context proceeds")
    };
    assert!(
        write.status_refresh_failed,
        "Committed despite the failed status read"
    );
    assert_eq!(
        json(request_body(&requests[1]))["context"]["organizationId"],
        "org-2"
    );
    let saved = device.saved();
    assert_eq!(
        saved[0].state,
        CommandState::Pending,
        "org-1 work still waits"
    );
    assert_eq!(saved[0].attempts, 1);
}

#[tokio::test]
async fn a_rejected_predecessor_holds_its_dependant_and_blocks_new_actions() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated(&url, "org-1", false);
    device.act(&url, clock_in()).await.unwrap();
    device.act(&url, ClockCommand::ClockOut).await.unwrap();

    let server = serve_on(&url, 2, |index, request| match index {
        0 => Some((200, not_committed(request))),
        _ => Some((409, rejection(&operation(request), "occupancy_conflict"))),
    });
    device.sync(&url, "org-1", "available").await;
    assert_eq!(server.join().unwrap().len(), 2, "The clock-out is not sent");
    let saved = device.saved();
    assert_eq!(saved[0].state, CommandState::Rejected);
    let evidence = saved[0].failure.as_ref().unwrap();
    assert_eq!(evidence.code, "occupancy_conflict");
    assert_eq!(evidence.http_status, Some(409));
    assert_eq!(saved[1].state, CommandState::Pending);
    assert_eq!(saved[1].attempts, 0);

    let server = serve_on(&url, 1, |_, _| {
        Some((200, capabilities("org-1", "available")))
    });
    let error = device.act(&url, clock_in()).await.unwrap_err();
    server.join().unwrap();
    assert!(error.message.contains("needs review"), "{}", error.message);
    assert_eq!(device.saved().len(), 2, "No new identity was captured");

    // Archiving keeps the evidence and releases the dependant, which the
    // server then judges against its own bound target.
    device
        .store
        .lock()
        .archive(&saved[0].operation_id, 1)
        .unwrap();
    let server = serve_on(&url, 1, |_, request| {
        Some((409, rejection(&operation(request), "target_unknown")))
    });
    device.sync(&url, "org-1", "available").await;
    let requests = server.join().unwrap();
    assert_eq!(request_body(&requests[0]), saved[1].command);
    let saved = device.saved();
    assert_eq!(saved[0].state, CommandState::Archived);
    assert_eq!(
        saved[0].failure.as_ref().unwrap().code,
        "occupancy_conflict"
    );
    assert_eq!(saved[1].state, CommandState::Rejected);
}

#[tokio::test]
async fn failed_local_capture_sends_nothing() {
    let device = Device::new();
    Connection::open(device.dir.path().join("offline_queue.db"))
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_capture BEFORE INSERT ON clock_command BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
        )
        .unwrap();
    let (url, server) = server(vec![Some((200, capabilities("org-1", "available")))]);
    let error = device.act(&url, clock_in()).await.unwrap_err();
    assert_eq!(
        server.join().unwrap().len(),
        1,
        "Only capabilities were read"
    );
    assert!(error.message.contains("nothing was sent"));
    assert!(device.saved().is_empty());
}

#[tokio::test]
async fn failed_receipt_write_keeps_the_command_until_lookup_confirms_it() {
    let device = Device::new();
    let conn = Connection::open(device.dir.path().join("offline_queue.db")).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER fail_receipt BEFORE UPDATE OF receipt ON clock_command BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
    )
    .unwrap();
    let (url, server) = serve(2, |index, request| match index {
        0 => Some((200, capabilities("org-1", "available"))),
        _ => Some((201, receipt("executed", request))),
    });
    let outcome = device.act(&url, clock_in()).await.unwrap();
    server.join().unwrap();
    assert!(
        matches!(outcome, ClockCommandOutcome::SavedOnDevice { .. }),
        "Not acknowledged locally until the receipt is durable"
    );
    assert_eq!(device.saved()[0].state, CommandState::Pending);

    conn.execute_batch("DROP TRIGGER fail_receipt;").unwrap();
    let server = serve_on(&url, 1, |_, request| Some((200, committed_lookup(request))));
    device.sync(&url, "org-1", "available").await;
    assert_eq!(
        server.join().unwrap().len(),
        1,
        "Recovered by lookup, no resend"
    );
    assert_eq!(device.saved()[0].state, CommandState::Committed);
}

#[tokio::test]
async fn unadopted_server_keeps_the_legacy_transport_and_freezes_nothing() {
    let device = Device::new();
    let (url, server) = server(vec![
        Some((200, capabilities("org-1", "unavailable"))),
        Some((200, r#"{"entry":{"id":"entry-1","employeeId":"e","type":"clock_in","timestamp":"2026-09-20T08:00:00Z"}}"#.to_string())),
        Some((200, status(true))),
    ]);
    let outcome = device.act(&url, clock_in()).await.unwrap();
    let requests = server.join().unwrap();
    assert_eq!(
        request_line(&requests[1]),
        "POST /api/time-entries HTTP/1.1"
    );
    assert!(matches!(outcome, ClockCommandOutcome::Committed { .. }));
    assert!(device.saved().is_empty());
}

#[tokio::test]
async fn saved_commands_are_never_downgraded_when_the_server_stops_accepting_them() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated(&url, "org-1", false);
    device.act(&url, clock_in()).await.unwrap();

    // Submission becomes unavailable: the attempted command is only looked up.
    let server = serve_on(&url, 1, |_, request| Some((200, not_committed(request))));
    device.sync(&url, "org-1", "unavailable").await;
    assert_eq!(server.join().unwrap().len(), 1);
    let waiting = &device.saved()[0];
    assert_eq!(waiting.state, CommandState::Pending);
    assert_eq!(waiting.failure.as_ref().unwrap().code, "submit_unavailable");
    assert_eq!(
        waiting.failure.as_ref().unwrap().class,
        FailureClass::Paused
    );

    // New actions do not go around it through the legacy transport either.
    let server = serve_on(&url, 1, |_, _| {
        Some((200, capabilities("org-1", "unavailable")))
    });
    let error = device.act(&url, ClockCommand::ClockOut).await.unwrap_err();
    assert_eq!(server.join().unwrap().len(), 1);
    assert!(error.message.contains("must reach the server first"));
    let error = device
        .act(
            &url,
            ClockCommand::Break {
                evidence: crate::support::confirmed_break(
                    "2026-09-20T10:00:00Z".parse().unwrap(),
                    Some("Europe/Berlin"),
                    Some("Europe/Berlin"),
                ),
                location: WorkLocationType::Office,
            },
        )
        .await
        .unwrap_err();
    assert!(error.message.contains("must reach the server first"));
}

#[tokio::test]
async fn an_expired_session_pauses_without_counting_a_failure() {
    let device = Device::new();
    let (url, server) = serve(2, |index, request| match index {
        0 => Some((200, capabilities("org-1", "available"))),
        _ => Some((401, rejection(&operation(request), "unauthorized"))),
    });
    let outcome = device.act(&url, clock_in()).await.unwrap();
    server.join().unwrap();
    let ClockCommandOutcome::SavedOnDevice { waiting, .. } = outcome else {
        panic!("Paused, not failed")
    };
    assert_eq!(waiting.unwrap().class, FailureClass::Paused);
    let saved = &device.saved()[0];
    assert_eq!(saved.state, CommandState::Pending);
    assert_eq!(saved.transient_failures, 0);
    let journal =
        crate::clock_command::journal_offline(&device.at(&url, crate::support::TOKEN)).unwrap();
    assert_eq!(
        journal.commands[0].waiting_for,
        Some(crate::command_store::WaitingFor::SignIn)
    );
}

#[tokio::test]
async fn a_receipt_for_another_operation_is_not_accepted() {
    let device = Device::new();
    let (url, server) = serve(2, |index, _| match index {
        0 => Some((200, capabilities("org-1", "available"))),
        _ => Some((
            201,
            serde_json::json!({
                "outcome": "executed",
                "operationId": "00000000-0000-4000-8000-000000000000",
                "receipt": {},
            })
            .to_string(),
        )),
    });
    let outcome = device.act(&url, clock_in()).await.unwrap();
    server.join().unwrap();
    assert!(matches!(outcome, ClockCommandOutcome::SavedOnDevice { .. }));
    assert_eq!(device.saved()[0].state, CommandState::Pending);
}

#[tokio::test]
async fn automatic_retries_back_off_and_stop_without_losing_the_command() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated(&url, "org-1", false);
    device.act(&url, clock_in()).await.unwrap();
    let saved = device.saved()[0].clone();
    assert_eq!(saved.transient_failures, 1);
    let failed_at = saved.failure.unwrap().at_ms;

    // Within the backoff window an unforced run sends nothing.
    let capabilities =
        crate::command_transport::Capabilities::parse(&capabilities("org-1", "available")).unwrap();
    crate::command_sync::drain(
        &device.service,
        &device.store,
        &url,
        crate::support::TOKEN,
        &capabilities,
        crate::command_sync::Pacing::AfterBackoff,
        || failed_at + 1_000,
    )
    .await
    .unwrap();
    assert_eq!(device.saved()[0].transient_failures, 1);

    for _ in 0..20 {
        crate::command_sync::drain(
            &device.service,
            &device.store,
            &url,
            crate::support::TOKEN,
            &capabilities,
            crate::command_sync::Pacing::Now,
            || chrono::Utc::now().timestamp_millis(),
        )
        .await
        .unwrap();
    }
    let stalled = &device.saved()[0];
    assert_eq!(stalled.state, CommandState::Stalled);
    assert_eq!(stalled.command, saved.command);
    assert_eq!(
        stalled.transient_failures,
        crate::command_store::MAX_TRANSIENT_FAILURES
    );
}

#[tokio::test]
async fn the_journal_discloses_only_the_current_context_and_projects_saved_work() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated(&url, "org-1", false);
    device.act(&url, clock_in()).await.unwrap();

    let journal = crate::clock_command::sync(
        &device.at(&url, crate::support::TOKEN),
        crate::command_sync::Pacing::AfterBackoff,
    )
    .await
    .unwrap();
    assert!(!journal.server_reachable);
    assert!(
        journal.commands_enabled,
        "Offline capture uses the negotiated context"
    );
    assert_eq!(journal.commands.len(), 1);
    assert_eq!(journal.other_contexts, 0);
    let projection = journal.projection.unwrap();
    assert!(projection.is_clocked_in);
    assert_eq!(
        projection.since.as_deref(),
        Some(journal.commands[0].occurred_at.as_str())
    );
    assert_eq!(journal.commands[0].command, device.saved()[0].command);

    // Another organization's session sees a count, never the details.
    device.negotiated(&url, "org-2", false);
    let journal = crate::clock_command::sync(
        &device.at(&url, crate::support::TOKEN),
        crate::command_sync::Pacing::AfterBackoff,
    )
    .await
    .unwrap();
    assert!(journal.commands.is_empty());
    assert_eq!(journal.other_contexts, 1);
    assert_eq!(
        journal.projection,
        Some(crate::clock_journal::Projection {
            is_clocked_in: false,
            since: None
        }),
        "Only the new context's own last status is projected"
    );
}

#[tokio::test]
async fn offline_after_restart_the_journal_projects_the_last_status_seen() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated(&url, "org-1", true);
    let device = device.restart();
    let journal = crate::clock_command::sync(
        &device.at(&url, crate::support::TOKEN),
        crate::command_sync::Pacing::AfterBackoff,
    )
    .await
    .unwrap();
    assert!(!journal.server_reachable);
    assert_eq!(
        journal.projection,
        Some(crate::clock_journal::Projection {
            is_clocked_in: true,
            since: Some("2026-09-20T08:00:00.000Z".into()),
        })
    );
    // A different session has no negotiated context or status to rely on.
    let journal = crate::clock_command::sync(
        &device.at(&url, "session-b"),
        crate::command_sync::Pacing::AfterBackoff,
    )
    .await
    .unwrap();
    assert!(!journal.commands_enabled);
    assert_eq!(journal.projection, None);
}

#[tokio::test]
async fn an_accepting_context_never_falls_back_to_the_legacy_writer() {
    let device = Device::new();
    let (url, server) = server(vec![Some((200, capabilities("org-1", "available")))]);
    let error = crate::clock_command::execute(
        &device.at(&url, crate::support::TOKEN),
        clock_in(),
        crate::clock_command::ActionEvidence {
            occurred_at: chrono::Utc::now(),
            timezone: None,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(server.join().unwrap().len(), 1, "No legacy request");
    assert!(error.message.contains("time zone"), "{}", error.message);
    assert!(device.saved().is_empty());
    assert_eq!(device.queue.lock().count().unwrap(), 0);
}

#[tokio::test]
async fn a_refusal_over_committed_evidence_cannot_be_archived() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated(&url, "org-1", false);
    device.act(&url, clock_in()).await.unwrap();
    let server = serve_on(&url, 2, |index, request| match index {
        0 => Some((200, not_committed(request))),
        _ => Some((409, rejection(&operation(request), "collision"))),
    });
    device.sync(&url, "org-1", "available").await;
    server.join().unwrap();
    let saved = device.saved()[0].clone();
    assert_eq!(saved.state, CommandState::Rejected);
    assert!(device.store.lock().archive(&saved.operation_id, 1).is_err());
    assert_eq!(device.saved()[0].state, CommandState::Rejected);

    let journal = crate::clock_command::sync(
        &device.at(&url, crate::support::TOKEN),
        crate::command_sync::Pacing::AfterBackoff,
    )
    .await
    .unwrap();
    assert!(!journal.commands[0].archivable);
}

#[tokio::test]
async fn offline_without_a_confirmed_context_refuses_where_frozen_commands_were_accepted() {
    let device = Device::new();
    let url = free_endpoint();
    // An earlier session saw this server accept frozen commands, then signed out.
    let server = serve_on(&url, 1, |_, _| {
        Some((200, capabilities("org-1", "available")))
    });
    crate::clock_command::negotiate(&device.at(&url, crate::support::TOKEN))
        .await
        .unwrap();
    server.join().unwrap();
    device.store.lock().forget_contexts().unwrap();

    // A new session, offline before it could confirm its context.
    let error = crate::clock_command::execute(
        &device.at(&url, "session-b"),
        clock_in(),
        crate::clock_command::ActionEvidence {
            occurred_at: chrono::Utc::now(),
            timezone: Some("Europe/Berlin".into()),
        },
    )
    .await
    .unwrap_err();
    assert!(
        error.message.contains("Nothing was recorded"),
        "{}",
        error.message
    );
    assert!(device.saved().is_empty());
    assert_eq!(
        device.queue.lock().count().unwrap(),
        0,
        "No identity-less legacy row"
    );
}

#[tokio::test]
async fn offline_without_any_accepting_history_keeps_the_legacy_transport() {
    let device = Device::new();
    let url = free_endpoint();
    let outcome = device.act(&url, clock_in()).await.unwrap();
    assert!(matches!(
        outcome,
        ClockCommandOutcome::RetainedForReview { .. }
    ));
    assert!(device.saved().is_empty());
}
