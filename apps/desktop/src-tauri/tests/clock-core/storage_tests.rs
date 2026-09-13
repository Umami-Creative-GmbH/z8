use crate::offline::{ActionType, OfflineQueue, ReviewReason, StoredValue};
use rusqlite::{params, Connection};

#[test]
fn malformed_and_exhausted_rows_remain_inspectable_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    drop(OfflineQueue::new(dir.path()).unwrap());
    let conn = Connection::open(dir.path().join("offline_queue.db")).unwrap();
    conn.execute(
        "INSERT INTO queue(action_type, timestamp, payload, retry_count, created_at) VALUES (?, ?, ?, ?, ?)",
        params!["not-json", 1, " original payload ", 0, 1],
    ).unwrap();
    conn.execute(
        "INSERT INTO queue(action_type, timestamp, payload, retry_count, created_at) VALUES (?, ?, ?, ?, ?)",
        params![r#""ClockOutWithBreak""#, 2, "2026-05-09T10:15:30Z", 5, 2],
    ).unwrap();
    drop(conn);

    let queue = OfflineQueue::new(dir.path()).unwrap();
    let records = queue.get_pending().unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(
        records[0].action_type,
        StoredValue::Text(b"not-json".to_vec())
    );
    assert_eq!(
        records[0].payload,
        StoredValue::Text(b" original payload ".to_vec())
    );
    assert!(records[0].reasons.contains(&ReviewReason::MalformedRecord));
    assert!(records[1].reasons.contains(&ReviewReason::RetriesExhausted));
    assert!(records[1]
        .reasons
        .contains(&ReviewReason::BreakMayBePartiallyCommitted));
    assert_eq!(records[1].timestamp, StoredValue::Integer(2));
    assert_eq!(queue.count().unwrap(), 2);
    drop(queue);
    assert_eq!(
        OfflineQueue::new(dir.path())
            .unwrap()
            .get_pending()
            .unwrap(),
        records
    );
}

#[test]
fn ignored_insert_is_not_reported_as_accepted_queueing() {
    let dir = tempfile::tempdir().unwrap();
    let mut queue = OfflineQueue::new(dir.path()).unwrap();
    let conn = Connection::open(dir.path().join("offline_queue.db")).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER reject_enqueue BEFORE INSERT ON queue BEGIN SELECT RAISE(IGNORE); END;",
    )
    .unwrap();
    assert!(queue.enqueue(ActionType::ClockOut, 100, None).is_err());
    assert_eq!(queue.count().unwrap(), 0);
}

#[test]
fn failed_commit_rolls_back_and_restart_does_not_report_a_saved_record() {
    let dir = tempfile::tempdir().unwrap();
    let mut queue = OfflineQueue::new(dir.path()).unwrap();
    let reader = Connection::open(dir.path().join("offline_queue.db")).unwrap();
    // A real shared lock permits INSERT's reserved lock, but blocks COMMIT.
    reader.execute_batch("BEGIN; SELECT * FROM queue;").unwrap();
    assert!(queue.enqueue(ActionType::ClockOut, 100, None).is_err());
    reader.execute_batch("ROLLBACK;").unwrap();
    drop(queue);
    let mut restarted = OfflineQueue::new(dir.path()).unwrap();
    assert_eq!(restarted.count().unwrap(), 0);
    restarted
        .enqueue(ActionType::ClockIn, 101, Some("remote".into()))
        .unwrap();
    assert_eq!(restarted.count().unwrap(), 1);
}

#[test]
fn malformed_sqlite_storage_classes_do_not_hide_other_records_or_change_bytes() {
    let dir = tempfile::tempdir().unwrap();
    drop(OfflineQueue::new(dir.path()).unwrap());
    let conn = Connection::open(dir.path().join("offline_queue.db")).unwrap();
    conn.execute_batch(
        "INSERT INTO queue(action_type, timestamp, payload, retry_count, created_at)
        VALUES (CAST(X'FFFE' AS TEXT), 'not-an-instant', X'0001FF', NULL, 1);",
    )
    .unwrap();
    conn.execute_batch(
        "INSERT INTO queue(action_type, timestamp, payload, retry_count, created_at)
        VALUES ('\"ClockOut\"', 1, NULL, 2147483648, 2);",
    )
    .unwrap();
    let records = OfflineQueue::new(dir.path())
        .unwrap()
        .get_pending()
        .unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].action_type, StoredValue::Text(vec![255, 254]));
    assert_eq!(records[0].payload, StoredValue::Blob(vec![0, 1, 255]));
    assert_eq!(records[0].retry_count, StoredValue::Null);
    assert!(records[0].reasons.contains(&ReviewReason::MalformedRecord));
    assert!(records[1].reasons.contains(&ReviewReason::RetriesExhausted));
    assert_eq!(
        records,
        OfflineQueue::new(dir.path())
            .unwrap()
            .get_pending()
            .unwrap()
    );
}

#[test]
fn enqueue_survives_process_exit_without_destructors() {
    let dir = tempfile::tempdir().unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "storage_tests::crash_writer_process",
        ])
        .env("Z8_QUEUE_CRASH_TEST_DIR", dir.path())
        .status()
        .unwrap();
    assert!(status.success());
    let queue = OfflineQueue::new(dir.path()).unwrap();
    let records = queue.get_pending().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].timestamp, StoredValue::Integer(123));
    assert_eq!(records[0].payload, StoredValue::Text(b"home".to_vec()));
}

#[test]
#[ignore = "subprocess fixture; executed by enqueue_survives_process_exit_without_destructors"]
fn crash_writer_process() {
    let directory = std::env::var_os("Z8_QUEUE_CRASH_TEST_DIR").unwrap();
    let mut queue = OfflineQueue::new(std::path::Path::new(&directory)).unwrap();
    queue
        .enqueue(ActionType::ClockIn, 123, Some("home".into()))
        .unwrap();
    std::process::exit(0);
}
