//! Atomic idle breaks (#281) through the real caller, the real device store and
//! loopback HTTP: one frozen close/resume command instead of two requests.
use crate::break_evidence::BreakEvidence;
use crate::clock::WorkLocationType;
use crate::clock_command::{ClockCommand, ClockCommandErrorKind, ClockCommandOutcome};
use crate::command_store::CommandState;
use crate::frozen_command::{utc_instant, CommandKind};
use crate::offline::ActionType;
use crate::support::{
    capabilities_with, confirmed_break, receipt, status, Device, BREAK_KINDS, CLOCK_KINDS, PERIOD,
};
use crate::test_http::{free_endpoint, request_body, request_line, serve, serve_on};
use chrono::{Duration, Utc};
use rusqlite::Connection;
use std::sync::{Arc, Mutex as StdMutex};

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap()
}

fn evidence() -> BreakEvidence {
    confirmed_break(
        Utc::now() - Duration::minutes(40),
        Some("Europe/Lisbon"),
        Some("Europe/Berlin"),
    )
}

fn take_break(evidence: BreakEvidence) -> ClockCommand {
    ClockCommand::Break {
        evidence,
        location: WorkLocationType::Office,
    }
}

#[tokio::test]
async fn an_online_break_is_one_frozen_command_saved_before_it_is_sent() {
    let device = Device::new();
    let database = device.dir.path().join("offline_queue.db");
    let evidence = evidence();
    let seen_before_send = Arc::new(StdMutex::new(None));
    let seen = seen_before_send.clone();
    let (url, server) = serve(3, move |index, request| match index {
        0 => Some((200, capabilities_with("org-1", "available", BREAK_KINDS))),
        1 => {
            let stored: String = Connection::open(&database)
                .unwrap()
                .query_row("SELECT command FROM clock_command", [], |row| row.get(0))
                .unwrap();
            *seen.lock().unwrap() = Some((stored, request_body(request).to_string()));
            Some((201, receipt("executed", request)))
        }
        _ => Some((200, status(true))),
    });
    device.negotiated_with(&url, "org-1", true, BREAK_KINDS);

    let outcome = device
        .act(&url, take_break(evidence.clone()))
        .await
        .unwrap();

    let requests = server.join().unwrap();
    let lines: Vec<_> = requests
        .iter()
        .map(|request| request_line(request))
        .collect();
    assert_eq!(
        lines,
        [
            "GET /api/time-entries/commands HTTP/1.1",
            "POST /api/time-entries/commands HTTP/1.1",
            "GET /api/time-entries/status HTTP/1.1",
        ],
        "One atomic write, never the two legacy requests"
    );
    let (stored, sent) = seen_before_send.lock().unwrap().take().unwrap();
    assert_eq!(stored, sent, "The exact bytes were durable before sending");
    let command = json(&sent);
    assert_eq!(command["kind"], "break");
    assert_eq!(command["admission"], "delayed");
    assert_eq!(
        command["target"],
        serde_json::json!({ "workPeriodId": PERIOD })
    );
    // Resume at the detected return, not the later confirmation or click.
    assert_eq!(
        command["occurredAt"],
        utc_instant(evidence.idle.returned.at.utc)
    );
    assert_eq!(command["timezone"], "Europe/Berlin");
    assert_eq!(
        command["breakStart"],
        serde_json::json!({
            "at": utc_instant(evidence.idle.last_activity.utc),
            "timezone": "Europe/Lisbon",
        })
    );
    assert_eq!(
        command["observations"]["confirmed"]["utc"],
        utc_instant(evidence.confirmed.utc)
    );
    let ClockCommandOutcome::Committed { write } = outcome else {
        panic!("Expected a committed receipt")
    };
    assert_eq!(
        write.operation_id.as_deref(),
        command["operationId"].as_str()
    );
    assert!(write.entries.is_empty());
    assert_eq!(device.saved()[0].state, CommandState::Committed);
    assert_eq!(device.saved()[0].kind, CommandKind::Break);
}

#[tokio::test]
async fn offline_breaks_bind_queued_work_and_the_next_clock_out_binds_the_break() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated_with(&url, "org-1", false, BREAK_KINDS);

    device
        .act(&url, ClockCommand::ClockIn(WorkLocationType::Remote))
        .await
        .unwrap();
    let paused = device.act(&url, take_break(evidence())).await.unwrap();
    assert!(matches!(paused, ClockCommandOutcome::SavedOnDevice { .. }));
    // Still clocked in after the break: another clock-in is refused.
    let error = device
        .act(&url, ClockCommand::ClockIn(WorkLocationType::Remote))
        .await
        .unwrap_err();
    assert!(
        error.message.contains("already clocked in"),
        "{}",
        error.message
    );
    device.act(&url, ClockCommand::ClockOut).await.unwrap();

    let saved = device.saved();
    let (start, pause, close) = (
        json(&saved[0].command),
        json(&saved[1].command),
        json(&saved[2].command),
    );
    assert_eq!(pause["target"]["clockInOperationId"], start["operationId"]);
    assert_eq!(
        saved[1].depends_on.as_deref(),
        start["operationId"].as_str()
    );
    // The resumed work is created under the break's identity.
    assert_eq!(close["target"]["clockInOperationId"], pause["operationId"]);
    assert_eq!(
        saved[2].depends_on.as_deref(),
        pause["operationId"].as_str()
    );

    let device = device.restart();
    let server = serve_on(&url, 4, |index, request| match index {
        // The clock-in was attempted offline, so it is looked up first.
        0 => {
            let path = request_line(request).split(' ').nth(1).unwrap();
            let operation_id = path.rsplit('/').next().unwrap();
            Some((
                200,
                serde_json::json!({ "outcome": "not_committed", "operationId": operation_id })
                    .to_string(),
            ))
        }
        _ => Some((201, receipt("executed", request))),
    });
    device
        .sync_with(&url, "org-1", "available", BREAK_KINDS)
        .await;
    let requests = server.join().unwrap();
    assert_eq!(request_body(&requests[1]), saved[0].command);
    assert_eq!(request_body(&requests[2]), saved[1].command);
    assert_eq!(request_body(&requests[3]), saved[2].command);
    assert!(device
        .saved()
        .iter()
        .all(|command| command.state == CommandState::Committed));
}

#[tokio::test]
async fn a_break_the_journal_projects_as_resumed_work() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated_with(&url, "org-1", true, BREAK_KINDS);
    let evidence = evidence();
    device
        .act(&url, take_break(evidence.clone()))
        .await
        .unwrap();
    let journal =
        crate::clock_command::journal_offline(&device.at(&url, crate::support::TOKEN)).unwrap();
    let projection = journal.projection.unwrap();
    assert!(projection.is_clocked_in);
    assert_eq!(
        projection.since.as_deref(),
        Some(utc_instant(evidence.idle.returned.at.utc).as_str())
    );
}

#[tokio::test]
async fn uncertain_break_evidence_is_refused_before_anything_is_saved_or_sent() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated_with(&url, "org-1", true, BREAK_KINDS);

    let mut moved = evidence();
    moved.idle.returned.at.utc = moved.idle.returned.at.utc + Duration::hours(1);
    let unzoned = confirmed_break(
        Utc::now() - Duration::minutes(40),
        None,
        Some("Europe/Berlin"),
    );
    for evidence in [moved, unzoned] {
        let error = device.act(&url, take_break(evidence)).await.unwrap_err();
        assert!(matches!(error.kind, ClockCommandErrorKind::PreSend));
        assert!(error.message.contains("correction"), "{}", error.message);
    }
    assert!(device.saved().is_empty());
    assert_eq!(device.queue.lock().count().unwrap(), 0);
}

#[tokio::test]
async fn a_retained_legacy_partial_break_blocks_the_atomic_break() {
    let device = Device::new();
    let url = free_endpoint();
    device.negotiated_with(&url, "org-1", true, BREAK_KINDS);
    device
        .queue
        .lock()
        .enqueue(
            ActionType::ClockOutWithBreak,
            1,
            Some(r#"{"breakStartTime":"2026-09-20T10:00:00Z","workLocationType":"office"}"#.into()),
        )
        .unwrap();
    let before = device.queue.lock().get_pending().unwrap();

    let error = device.act(&url, take_break(evidence())).await.unwrap_err();

    assert!(
        error.message.contains("require review"),
        "{}",
        error.message
    );
    // Neither replayed as close then resume nor assumed uncommitted.
    assert!(device.saved().is_empty());
    assert_eq!(device.queue.lock().get_pending().unwrap(), before);
    let summary = device.queue.lock().recovery_summary().unwrap();
    assert_eq!(summary.possible_partial_breaks, 1);
}

#[tokio::test]
async fn a_server_without_break_commands_keeps_the_two_request_break() {
    let device = Device::new();
    let evidence = evidence();
    let (url, server) = serve(4, |index, _| {
        match index {
        0 => Some((200, capabilities_with("org-1", "available", CLOCK_KINDS))),
        1 => Some((
            200,
            r#"{"entry":{"id":"close-1","employeeId":"e","type":"clock_out","timestamp":"2026-09-20T10:00:00Z"}}"#.into(),
        )),
        2 => Some((
            200,
            r#"{"entry":{"id":"open-1","employeeId":"e","type":"clock_in","timestamp":"2026-09-20T10:30:00Z"}}"#.into(),
        )),
        _ => Some((200, status(true))),
    }
    });
    device.negotiated_with(&url, "org-1", true, CLOCK_KINDS);

    let outcome = device
        .act(&url, take_break(evidence.clone()))
        .await
        .unwrap();

    let requests = server.join().unwrap();
    assert_eq!(
        request_line(&requests[1]),
        "POST /api/time-entries HTTP/1.1"
    );
    let close = json(request_body(&requests[1]));
    assert_eq!(close["type"], "clock_out");
    assert_eq!(
        chrono::DateTime::parse_from_rfc3339(close["timestamp"].as_str().unwrap()).unwrap(),
        evidence.idle.last_activity.utc
    );
    assert_eq!(json(request_body(&requests[2]))["type"], "clock_in");
    assert!(matches!(outcome, ClockCommandOutcome::Committed { .. }));
    assert!(
        device.saved().is_empty(),
        "Nothing is frozen for this server"
    );
}
