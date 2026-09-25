//! Legacy transport behavior (#268), which stays in use wherever the server
//! does not accept version 2 commands.
use crate::break_evidence::BreakEvidence;
use crate::clock::WorkLocationType;
use crate::clock_command::{execute, ActionEvidence, ClockCommand, ClockCommandOutcome};
use crate::offline::{ActionType, ReviewReason, StoredValue};
use crate::support::{capabilities, confirmed_break, Device};
use crate::test_http::{request_body, request_line, server};
use rusqlite::Connection;

const CLOSE_ENTRY: &str = r#"{"entry":{"id":"close-1","employeeId":"employee-1","type":"clock_out","timestamp":"2026-05-09T10:15:30Z"}}"#;
const OPEN_ENTRY: &str = r#"{"entry":{"id":"open-1","employeeId":"employee-1","type":"clock_in","timestamp":"2026-05-09T10:30:00Z"}}"#;

/// A confirmed break whose idle start is the legacy fixtures' close time.
fn legacy_break() -> BreakEvidence {
    confirmed_break(
        "2026-05-09T10:15:30Z".parse().unwrap(),
        Some("Europe/Berlin"),
        Some("Europe/Berlin"),
    )
}

fn evidence() -> ActionEvidence {
    ActionEvidence {
        occurred_at: chrono::Utc::now(),
        timezone: Some("Europe/Berlin".into()),
    }
}

#[tokio::test]
async fn every_committed_command_survives_status_failure_without_queueing() {
    let unadopted = capabilities("org-1", "unavailable");
    for (command, responses, expected_entries) in [
        (
            ClockCommand::ClockIn(WorkLocationType::Remote),
            vec![
                Some((200, unadopted.clone())),
                Some((200, OPEN_ENTRY.to_string())),
                Some((503, "{}".to_string())),
            ],
            1,
        ),
        (
            ClockCommand::ClockOut,
            vec![
                // A server without version 2 commands.
                Some((404, "{}".to_string())),
                Some((200, CLOSE_ENTRY.to_string())),
                Some((503, "{}".to_string())),
            ],
            1,
        ),
        (
            ClockCommand::Break {
                evidence: legacy_break(),
                location: WorkLocationType::Remote,
            },
            vec![
                // Breaks negotiate too; this server has no version 2 commands.
                Some((404, "{}".to_string())),
                Some((200, CLOSE_ENTRY.to_string())),
                Some((200, OPEN_ENTRY.to_string())),
                Some((503, "{}".to_string())),
            ],
            2,
        ),
    ] {
        let device = Device::new();
        let (url, server) = server(responses);
        let outcome = device.act(&url, command).await.unwrap();
        let ClockCommandOutcome::Committed { write } = outcome else {
            panic!("Must remain committed")
        };
        assert!(write.status.is_none());
        assert!(write.status_refresh_failed);
        assert_eq!(write.entries.len(), expected_entries);
        assert_eq!(write.operation_id, None);
        assert_eq!(device.queue.lock().count().unwrap(), 0);
        assert!(
            device.saved().is_empty(),
            "No frozen command without server support"
        );
        let requests = server.join().unwrap();
        assert!(requests
            .last()
            .unwrap()
            .starts_with("GET /api/time-entries/status "));
        let writes: Vec<_> = requests
            .iter()
            .filter(|request| request_line(request) == "POST /api/time-entries HTTP/1.1")
            .collect();
        assert_eq!(writes.len(), expected_entries);
        if expected_entries == 1 && write.entries[0].entry_type == "clock_out" {
            assert_eq!(
                request_body(writes[0]),
                r#"{"type":"clock_out"}"#,
                "Ordinary legacy close still omits its timestamp"
            );
        }
    }
}

#[tokio::test]
async fn actual_persistence_failure_reaches_the_clock_caller() {
    let device = Device::new();
    let conn = Connection::open(device.dir.path().join("offline_queue.db")).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_enqueue BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT, 'storage failure'); END;").unwrap();
    let (url, server) = server(vec![Some((404, "{}".to_string())), None]);
    let error = device.act(&url, ClockCommand::ClockOut).await.unwrap_err();
    assert!(error.message.contains("local recovery could not be saved"));
    assert!(error.message.contains("do not assume the write failed"));
    assert_eq!(server.join().unwrap().len(), 2);
    let device = device.restart();
    assert_eq!(device.queue.lock().count().unwrap(), 0);
}

#[tokio::test]
async fn partial_break_is_retained_with_acknowledged_close_and_blocks_resubmission_after_restart() {
    let device = Device::new();
    let (url, server) = server(vec![
        Some((404, "{}".to_string())),
        Some((200, CLOSE_ENTRY.to_string())),
        Some((400, "{}".to_string())),
    ]);
    let command = ClockCommand::Break {
        evidence: legacy_break(),
        location: WorkLocationType::Remote,
    };
    let outcome = device.act(&url, command).await.unwrap();
    let ClockCommandOutcome::RetainedForReview { recovery_id } = outcome else {
        panic!("Must require review")
    };
    assert_eq!(server.join().unwrap().len(), 3);
    let device = device.restart();
    let records = device.queue.lock().get_pending().unwrap();
    assert_eq!(records[0].id, recovery_id);
    assert!(records[0]
        .reasons
        .contains(&ReviewReason::BreakMayBePartiallyCommitted));
    let StoredValue::Text(bytes) = &records[0].payload else {
        panic!("Expected original payload")
    };
    let payload: serde_json::Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(payload["breakStartTime"], "2026-05-09T10:15:30Z");
    if cfg!(feature = "desktop-recovery-evidence") {
        assert_eq!(payload["observedFailure"]["closeAcknowledged"], true);
        assert_eq!(payload["observedFailure"]["closeEntry"]["id"], "close-1");
        assert_eq!(payload["observedFailure"]["resumeAttempted"], true);
    } else {
        assert!(
            payload.get("observedFailure").is_none(),
            "New receipt capture must remain inactive by default"
        );
    }
    let error = execute(
        &device.at("http://127.0.0.1:1", "different-context"),
        ClockCommand::ClockOut,
        evidence(),
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("require review"));
    assert_eq!(device.queue.lock().get_pending().unwrap(), records);
}

#[tokio::test]
async fn legacy_record_does_not_use_current_context_or_failure_timestamp_for_submission() {
    let device = Device::new();
    device
        .queue
        .lock()
        .enqueue(ActionType::ClockOut, 1, None)
        .unwrap();
    let error = execute(
        &device.at("http://127.0.0.1:1", "other-session"),
        ClockCommand::ClockIn(WorkLocationType::Office),
        evidence(),
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("require review"));
    assert_eq!(
        device.queue.lock().get_pending().unwrap()[0].timestamp,
        StoredValue::Integer(1)
    );
    assert!(
        device.saved().is_empty(),
        "Legacy history is never upgraded into a command"
    );
}
