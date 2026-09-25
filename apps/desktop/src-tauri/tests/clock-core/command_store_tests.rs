use crate::clock::WorkLocationType;
use crate::command_store::{
    token_fingerprint, CommandFailure, CommandState, CommandStore, FailureClass,
    MAX_TRANSIENT_FAILURES,
};
use crate::frozen_command::{
    freeze_clock_in, freeze_clock_out, new_operation_id, Admission, ClockTarget, CommandContext,
    CommandFrame, FrozenCommand,
};
use crate::offline::{ActionType, OfflineQueue};
use chrono::{TimeZone, Utc};
use rusqlite::{params, Connection};

const ENDPOINT: &str = "https://app.z8.test";

pub fn context(organization_id: &str) -> CommandContext {
    CommandContext {
        user_id: "user-1".into(),
        organization_id: organization_id.into(),
        employee_id: "7d1f3f0e-8a4c-4a7e-9f39-0b8f1a2c3d4e".into(),
        server: ENDPOINT.into(),
    }
}

fn frame(organization_id: &str, depends_on: Option<String>) -> CommandFrame {
    CommandFrame {
        operation_id: new_operation_id(),
        context: context(organization_id),
        occurred_at: Utc.with_ymd_and_hms(2026, 9, 20, 8, 0, 0).unwrap(),
        timezone: "Europe/Berlin".into(),
        admission: Admission::Delayed,
        depends_on,
    }
}

fn clock_in(organization_id: &str) -> FrozenCommand {
    freeze_clock_in(frame(organization_id, None), WorkLocationType::Office)
}

fn failure(class: FailureClass, code: &str) -> CommandFailure {
    CommandFailure {
        class,
        code: code.into(),
        http_status: Some(409),
        response: Some(serde_json::json!({ "outcome": "rejected", "code": code })),
        at_ms: 5,
    }
}

fn user_version(dir: &std::path::Path) -> i64 {
    Connection::open(dir.join("offline_queue.db"))
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

fn has_table(dir: &std::path::Path, name: &str) -> bool {
    Connection::open(dir.join("offline_queue.db"))
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
        == 1
}

fn legacy_store(dir: &std::path::Path) -> Vec<crate::offline::QueuedAction> {
    let mut queue = OfflineQueue::new(dir).unwrap();
    queue
        .enqueue(ActionType::ClockOut, 1_700_000_000, None)
        .unwrap();
    let conn = Connection::open(dir.join("offline_queue.db")).unwrap();
    conn.execute(
        "INSERT INTO queue(action_type, timestamp, payload, retry_count, created_at) VALUES (?, ?, ?, ?, ?)",
        params![r#""ClockOutWithBreak""#, 2, "2026-05-09T10:15:30Z", 5, 2],
    )
    .unwrap();
    queue.get_pending().unwrap()
}

#[test]
fn upgrade_keeps_every_legacy_row_byte_identical_and_is_repeatable() {
    let dir = tempfile::tempdir().unwrap();
    let before = legacy_store(dir.path());
    assert_eq!(user_version(dir.path()), 0);

    drop(CommandStore::open(dir.path()).unwrap());
    assert_eq!(user_version(dir.path()), 1);
    drop(CommandStore::open(dir.path()).unwrap());
    assert_eq!(user_version(dir.path()), 1);

    // Identity-less legacy rows are not converted, guessed or given business IDs.
    assert_eq!(
        OfflineQueue::new(dir.path())
            .unwrap()
            .get_pending()
            .unwrap(),
        before
    );
}

#[test]
fn interrupted_upgrade_rolls_back_completely_and_a_restart_completes_it() {
    let dir = tempfile::tempdir().unwrap();
    let before = legacy_store(dir.path());
    // A real failure after the first upgrade statement already ran.
    Connection::open(dir.path().join("offline_queue.db"))
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER clock_command_frozen AFTER INSERT ON queue BEGIN SELECT 1; END;",
        )
        .unwrap();

    assert!(CommandStore::open(dir.path()).is_err());
    assert_eq!(user_version(dir.path()), 0);
    assert!(!has_table(dir.path(), "clock_command"));
    assert_eq!(
        OfflineQueue::new(dir.path())
            .unwrap()
            .get_pending()
            .unwrap(),
        before
    );

    Connection::open(dir.path().join("offline_queue.db"))
        .unwrap()
        .execute_batch("DROP TRIGGER clock_command_frozen;")
        .unwrap();
    drop(CommandStore::open(dir.path()).unwrap());
    assert_eq!(user_version(dir.path()), 1);
    assert_eq!(
        OfflineQueue::new(dir.path())
            .unwrap()
            .get_pending()
            .unwrap(),
        before
    );
}

#[test]
fn a_newer_store_is_refused_rather_than_read_by_an_older_client() {
    let dir = tempfile::tempdir().unwrap();
    drop(CommandStore::open(dir.path()).unwrap());
    Connection::open(dir.path().join("offline_queue.db"))
        .unwrap()
        .execute_batch("PRAGMA user_version = 2;")
        .unwrap();
    assert!(CommandStore::open(dir.path()).is_err());
    assert_eq!(user_version(dir.path()), 2);
}

#[test]
fn captured_command_is_immutable_and_unresolved_evidence_cannot_be_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = CommandStore::open(dir.path()).unwrap();
    let command = clock_in("org-1");
    store.capture(ENDPOINT, &command, 10).unwrap();

    let conn = Connection::open(dir.path().join("offline_queue.db")).unwrap();
    for statement in [
        "UPDATE clock_command SET command = '{}'",
        "UPDATE clock_command SET operation_id = 'other'",
        "UPDATE clock_command SET context_organization_id = 'org-2'",
        "UPDATE clock_command SET depends_on_operation_id = 'other'",
        "DELETE FROM clock_command",
    ] {
        assert!(conn.execute_batch(statement).is_err(), "{statement}");
    }
    let stored = store.get(&command.operation_id).unwrap().unwrap();
    assert_eq!(stored.command, command.body);
    assert_eq!(stored.state, CommandState::Pending);
    assert_eq!(stored.captured_at_ms, 10);

    for state in [CommandState::Rejected, CommandState::Archived] {
        if state == CommandState::Rejected {
            store
                .record_failure(
                    stored.recovery_id,
                    &failure(FailureClass::Rejected, "occupancy_conflict"),
                )
                .unwrap();
        } else {
            store.archive(&command.operation_id, 20).unwrap();
        }
        assert!(conn.execute_batch("DELETE FROM clock_command").is_err());
    }
}

#[test]
fn failed_capture_is_reported_and_leaves_no_record() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = CommandStore::open(dir.path()).unwrap();
    let conn = Connection::open(dir.path().join("offline_queue.db")).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER reject_capture BEFORE INSERT ON clock_command BEGIN SELECT RAISE(IGNORE); END;",
    )
    .unwrap();
    assert!(store.capture(ENDPOINT, &clock_in("org-1"), 10).is_err());
    conn.execute_batch("DROP TRIGGER reject_capture;").unwrap();
    // A shared read lock lets INSERT proceed but blocks COMMIT.
    conn.execute_batch("BEGIN; SELECT * FROM clock_command;")
        .unwrap();
    assert!(store.capture(ENDPOINT, &clock_in("org-1"), 11).is_err());
    conn.execute_batch("ROLLBACK;").unwrap();
    drop(store);
    assert!(CommandStore::open(dir.path())
        .unwrap()
        .active()
        .unwrap()
        .is_empty());
}

#[test]
fn capture_survives_process_exit_without_destructors() {
    let dir = tempfile::tempdir().unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "command_store_tests::capture_then_exit_process",
        ])
        .env("Z8_COMMAND_CRASH_TEST_DIR", dir.path())
        .status()
        .unwrap();
    assert!(status.success());
    let store = CommandStore::open(dir.path()).unwrap();
    let active = store.active().unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(
        active[0].operation_id,
        "3b241101-e2bb-4255-8caf-4136c566a962"
    );
    assert_eq!(
        active[0].attempts, 1,
        "The attempt was recorded before sending"
    );
}

#[test]
#[ignore = "subprocess fixture; executed by capture_survives_process_exit_without_destructors"]
fn capture_then_exit_process() {
    let directory = std::env::var_os("Z8_COMMAND_CRASH_TEST_DIR").unwrap();
    let mut store = CommandStore::open(std::path::Path::new(&directory)).unwrap();
    let mut command = clock_in("org-1");
    command.operation_id = "3b241101-e2bb-4255-8caf-4136c566a962".into();
    let recovery_id = store.capture(ENDPOINT, &command, 1).unwrap();
    store.mark_attempt(recovery_id, 2).unwrap();
    std::process::exit(0);
}

#[test]
fn committed_receipt_is_persisted_before_the_command_leaves_the_active_queue() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = CommandStore::open(dir.path()).unwrap();
    let first = clock_in("org-1");
    let id = store.capture(ENDPOINT, &first, 10).unwrap();

    let conn = Connection::open(dir.path().join("offline_queue.db")).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER fail_receipt BEFORE UPDATE OF receipt ON clock_command BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
    )
    .unwrap();
    assert!(store
        .record_receipt(id, r#"{"outcome":"executed"}"#, 20)
        .is_err());
    assert_eq!(
        store.active().unwrap().len(),
        1,
        "Still active without a receipt"
    );
    conn.execute_batch("DROP TRIGGER fail_receipt;").unwrap();

    store
        .record_receipt(id, r#"{"outcome":"executed"}"#, 20)
        .unwrap();
    assert!(store.active().unwrap().is_empty());
    let committed = store.get(&first.operation_id).unwrap().unwrap();
    assert_eq!(committed.state, CommandState::Committed);
    assert_eq!(
        committed.receipt.as_deref(),
        Some(r#"{"outcome":"executed"}"#)
    );
    assert_eq!(committed.resolved_at_ms, Some(20));
}

#[test]
fn only_resolved_commands_without_active_dependants_are_pruned() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = CommandStore::open(dir.path()).unwrap();
    let old = clock_in("org-1");
    let old_id = store.capture(ENDPOINT, &old, 1).unwrap();
    store.record_receipt(old_id, "{}", 100).unwrap();
    let depended = clock_in("org-1");
    let depended_id = store.capture(ENDPOINT, &depended, 2).unwrap();
    store.record_receipt(depended_id, "{}", 100).unwrap();
    let dependant = freeze_clock_out(
        frame("org-1", Some(depended.operation_id.clone())),
        ClockTarget::ClockInOperation(depended.operation_id.clone()),
    );
    store.capture(ENDPOINT, &dependant, 3).unwrap();
    let recent = clock_in("org-1");
    let recent_id = store.capture(ENDPOINT, &recent, 4).unwrap();
    store.record_receipt(recent_id, "{}", 900).unwrap();
    let rejected = clock_in("org-1");
    let rejected_id = store.capture(ENDPOINT, &rejected, 5).unwrap();
    store
        .record_failure(
            rejected_id,
            &failure(FailureClass::Rejected, "occupancy_conflict"),
        )
        .unwrap();
    store.archive(&rejected.operation_id, 6).unwrap();

    assert_eq!(store.prune_committed(500).unwrap(), 1);
    assert!(store.get(&old.operation_id).unwrap().is_none());
    for kept in [&depended, &dependant, &recent, &rejected] {
        assert!(store.get(&kept.operation_id).unwrap().is_some());
    }
}

#[test]
fn transient_failures_stall_after_the_bound_and_never_delete() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = CommandStore::open(dir.path()).unwrap();
    let command = clock_in("org-1");
    let id = store.capture(ENDPOINT, &command, 1).unwrap();
    for attempt in 1..=MAX_TRANSIENT_FAILURES {
        let state = store
            .record_failure(id, &failure(FailureClass::Transient, "unreachable"))
            .unwrap();
        let expected = if attempt == MAX_TRANSIENT_FAILURES {
            CommandState::Stalled
        } else {
            CommandState::Pending
        };
        assert_eq!(state, expected);
    }
    assert!(
        store.archive(&command.operation_id, 2).is_err(),
        "Uncertain work is not archived"
    );
    store.retry(&command.operation_id).unwrap();
    let retried = store.get(&command.operation_id).unwrap().unwrap();
    assert_eq!(retried.state, CommandState::Pending);
    assert_eq!(retried.transient_failures, 0);
    assert_eq!(
        retried.failure.unwrap().code,
        "unreachable",
        "Evidence is kept"
    );
}

#[test]
fn paused_failures_keep_the_command_pending_and_rejections_need_review() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = CommandStore::open(dir.path()).unwrap();
    let command = clock_in("org-1");
    let id = store.capture(ENDPOINT, &command, 1).unwrap();
    assert_eq!(
        store
            .record_failure(id, &failure(FailureClass::Paused, "context_mismatch"))
            .unwrap(),
        CommandState::Pending
    );
    assert!(
        store.retry(&command.operation_id).is_err(),
        "Only stalled work is retried"
    );
    assert_eq!(
        store
            .record_failure(id, &failure(FailureClass::Rejected, "target_not_active"))
            .unwrap(),
        CommandState::Rejected
    );
    assert!(
        store.record_receipt(id, "{}", 3).is_err(),
        "Review state is not overwritten"
    );
    store.archive(&command.operation_id, 4).unwrap();
    let archived = store.get(&command.operation_id).unwrap().unwrap();
    assert_eq!(archived.state, CommandState::Archived);
    assert_eq!(archived.command, command.body);
    assert_eq!(archived.failure.unwrap().code, "target_not_active");
}

#[test]
fn context_cache_is_bound_to_endpoint_and_session() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = CommandStore::open(dir.path()).unwrap();
    let session = token_fingerprint("token-a");
    assert_ne!(session, token_fingerprint("token-b"));
    assert!(!session.contains("token-a"));

    assert!(
        !store.save_status(ENDPOINT, &session, "{}", 1).unwrap(),
        "No capabilities yet"
    );
    store
        .save_capabilities(ENDPOINT, &session, r#"{"a":1}"#, 2)
        .unwrap();
    assert!(store
        .save_status(ENDPOINT, &session, r#"{"s":1}"#, 3)
        .unwrap());
    let cached = store.cached_context(ENDPOINT, &session).unwrap().unwrap();
    assert_eq!(cached.capabilities, r#"{"a":1}"#);
    assert_eq!(cached.status.as_deref(), Some(r#"{"s":1}"#));

    assert!(store
        .cached_context(ENDPOINT, &token_fingerprint("token-b"))
        .unwrap()
        .is_none());
    assert!(store
        .cached_context("https://other.test", &session)
        .unwrap()
        .is_none());
    assert!(!store
        .save_status(ENDPOINT, &token_fingerprint("token-b"), "{}", 4)
        .unwrap());

    // New capabilities for another session drop the old session's status.
    store
        .save_capabilities(ENDPOINT, &token_fingerprint("token-b"), r#"{"b":1}"#, 5)
        .unwrap();
    let replaced = store
        .cached_context(ENDPOINT, &token_fingerprint("token-b"))
        .unwrap()
        .unwrap();
    assert_eq!(replaced.status, None);

    store.forget_contexts().unwrap();
    assert!(store
        .cached_context(ENDPOINT, &token_fingerprint("token-b"))
        .unwrap()
        .is_none());
}
