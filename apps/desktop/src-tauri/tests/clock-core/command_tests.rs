use crate::clock::{ClockService, WorkLocationType};
use crate::clock_command::{execute, ClockCommand, ClockCommandOutcome};
use crate::offline::{ActionType, OfflineQueue, ReviewReason, StoredValue};
use parking_lot::Mutex;
use rusqlite::Connection;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

const CLOSE_ENTRY: &str = r#"{"entry":{"id":"close-1","employeeId":"employee-1","type":"clock_out","timestamp":"2026-05-09T10:15:30Z"}}"#;
const OPEN_ENTRY: &str = r#"{"entry":{"id":"open-1","employeeId":"employee-1","type":"clock_in","timestamp":"2026-05-09T10:30:00Z"}}"#;

fn server(
    responses: Vec<Option<(u16, &'static str)>>,
) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let thread = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for response in responses {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            Instant::now() < deadline,
                            "Expected another desktop request"
                        );
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let size = stream.read(&mut buffer).unwrap();
                assert!(size > 0);
                request.extend_from_slice(&buffer[..size]);
                let text = String::from_utf8_lossy(&request);
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(request).unwrap());
            if let Some((status, body)) = response {
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        }
        requests
    });
    (url, thread)
}

#[tokio::test]
async fn every_committed_command_survives_status_failure_without_queueing() {
    for (command, responses, expected_entries) in [
        (
            ClockCommand::ClockIn(WorkLocationType::Remote),
            vec![Some((200, OPEN_ENTRY)), Some((503, "{}"))],
            1,
        ),
        (
            ClockCommand::ClockOut,
            vec![Some((200, CLOSE_ENTRY)), Some((503, "{}"))],
            1,
        ),
        (
            ClockCommand::Break {
                start: "2026-05-09T10:15:30Z".into(),
                location: WorkLocationType::Remote,
            },
            vec![
                Some((200, CLOSE_ENTRY)),
                Some((200, OPEN_ENTRY)),
                Some((503, "{}")),
            ],
            2,
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let queue = Mutex::new(OfflineQueue::new(dir.path()).unwrap());
        let (url, server) = server(responses);
        let outcome = execute(&ClockService::new(), &queue, &url, "test-token", command)
            .await
            .unwrap();
        let ClockCommandOutcome::Committed { write } = outcome else {
            panic!("Must remain committed")
        };
        assert!(write.status.is_none());
        assert!(write.status_refresh_failed);
        assert_eq!(write.entries.len(), expected_entries);
        assert_eq!(queue.lock().count().unwrap(), 0);
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), expected_entries + 1);
        assert!(requests.last().unwrap().starts_with("GET "));
        if expected_entries == 1 && write.entries[0].entry_type == "clock_out" {
            assert!(
                requests[0].ends_with(r#"{"type":"clock_out"}"#),
                "Ordinary close still omits timestamp"
            );
        }
    }
}

#[tokio::test]
async fn actual_persistence_failure_reaches_the_clock_caller() {
    let dir = tempfile::tempdir().unwrap();
    let queue = Mutex::new(OfflineQueue::new(dir.path()).unwrap());
    let conn = Connection::open(dir.path().join("offline_queue.db")).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_enqueue BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT, 'storage failure'); END;").unwrap();
    let (url, server) = server(vec![None]);
    let error = execute(
        &ClockService::new(),
        &queue,
        &url,
        "test-token",
        ClockCommand::ClockOut,
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("local recovery could not be saved"));
    assert!(error.message.contains("do not assume the write failed"));
    assert_eq!(server.join().unwrap().len(), 1);
    drop(queue);
    assert_eq!(OfflineQueue::new(dir.path()).unwrap().count().unwrap(), 0);
}

#[tokio::test]
async fn partial_break_is_retained_with_acknowledged_close_and_blocks_resubmission_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let queue = Mutex::new(OfflineQueue::new(dir.path()).unwrap());
    let (url, server) = server(vec![Some((200, CLOSE_ENTRY)), Some((400, "{}"))]);
    let command = ClockCommand::Break {
        start: "2026-05-09T10:15:30Z".into(),
        location: WorkLocationType::Remote,
    };
    let outcome = execute(&ClockService::new(), &queue, &url, "test-token", command)
        .await
        .unwrap();
    let ClockCommandOutcome::RetainedForReview { recovery_id } = outcome else {
        panic!("Must require review")
    };
    assert_eq!(server.join().unwrap().len(), 2);
    drop(queue);
    let queue = Mutex::new(OfflineQueue::new(dir.path()).unwrap());
    let records = queue.lock().get_pending().unwrap();
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
        &ClockService::new(),
        &queue,
        "http://127.0.0.1:1",
        "different-context",
        ClockCommand::ClockOut,
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("require review"));
    assert_eq!(queue.lock().get_pending().unwrap(), records);
}

#[tokio::test]
async fn legacy_record_does_not_use_current_context_or_failure_timestamp_for_submission() {
    let dir = tempfile::tempdir().unwrap();
    let mut queue = OfflineQueue::new(dir.path()).unwrap();
    queue.enqueue(ActionType::ClockOut, 1, None).unwrap();
    let queue = Mutex::new(queue);
    let error = execute(
        &ClockService::new(),
        &queue,
        "http://127.0.0.1:1",
        "other-session",
        ClockCommand::ClockIn(WorkLocationType::Office),
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("require review"));
    assert_eq!(
        queue.lock().get_pending().unwrap()[0].timestamp,
        StoredValue::Integer(1)
    );
}
