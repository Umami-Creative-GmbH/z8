use crate::{
    clock::WorkLocationType,
    clock_command::{execute_pilot, ActionEvidence, ClockCommand},
    command_store::{token_fingerprint, CommandStore},
    command_transport::Capabilities,
    support::{self, Device, BREAK_KINDS, TOKEN},
    test_http,
};
use chrono::Utc;

fn evidence() -> ActionEvidence {
    ActionEvidence {
        occurred_at: Utc::now(),
        timezone: Some("Europe/Berlin".into()),
    }
}

#[tokio::test]
async fn pilot_never_falls_back_to_an_older_server_writer() {
    let device = Device::new();
    let (endpoint, requests) = test_http::server(vec![Some((404, "{}"))]);
    let error = execute_pilot(
        &device.at(&endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Home),
        evidence(),
        "org-1",
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("not ready"));
    assert!(device.saved().is_empty());
    let requests = requests.join().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("GET "));
}

#[tokio::test]
async fn pilot_refuses_a_changed_organization_and_missing_atomic_breaks() {
    let endpoint = "http://127.0.0.1:9";
    let device = Device::new();
    device.negotiated_with(endpoint, "org-1", false, BREAK_KINDS);
    let error = execute_pilot(
        &device.at(endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Home),
        evidence(),
        "org-2",
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("Organization changed"));
    device.negotiated(endpoint, "org-1", false);
    let error = execute_pilot(
        &device.at(endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Home),
        evidence(),
        "org-1",
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("atomic breaks"));
    assert!(device.saved().is_empty());
}

#[tokio::test]
async fn offline_clock_in_requires_a_previously_confirmed_status() {
    let endpoint = "http://127.0.0.1:9";
    let device = Device::new();
    device
        .store
        .lock()
        .save_capabilities(
            endpoint,
            &token_fingerprint(TOKEN),
            &support::capabilities_with("org-1", "available", BREAK_KINDS),
            1,
        )
        .unwrap();
    let error = execute_pilot(
        &device.at(endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Home),
        evidence(),
        "org-1",
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("status is unknown"));
    assert!(device.saved().is_empty());
}

#[tokio::test]
async fn update_backup_keeps_original_bytes_and_context_scoped_manual_break() {
    let endpoint = "http://127.0.0.1:9";
    let device = Device::new();
    device.negotiated_with(endpoint, "org-1", true, BREAK_KINDS);
    device
        .act(endpoint, ClockCommand::StartBreak)
        .await
        .unwrap();
    let original = device.saved()[0].clone();
    let context = Capabilities::parse(&support::capabilities_with(
        "org-1",
        "available",
        BREAK_KINDS,
    ))
    .unwrap()
    .command_context()
    .unwrap();
    let directory = tempfile::tempdir().unwrap();
    device
        .store
        .lock()
        .backup_before_update(&directory.path().join("offline_queue.db"))
        .unwrap();
    let restored = CommandStore::open(directory.path()).unwrap();
    assert_eq!(
        restored
            .get(&original.operation_id)
            .unwrap()
            .unwrap()
            .command,
        original.command
    );
    assert!(restored.on_break(endpoint, &context).unwrap());
    let other = Capabilities::parse(&support::capabilities_with(
        "org-2",
        "available",
        BREAK_KINDS,
    ))
    .unwrap()
    .command_context()
    .unwrap();
    assert!(!restored.on_break(endpoint, &other).unwrap());
    restored.end_break(endpoint, &context).unwrap();
    assert!(!restored.on_break(endpoint, &context).unwrap());
    assert_eq!(restored.active().unwrap().len(), 1); // End Day adds no write.
    let conn = rusqlite::Connection::open(directory.path().join("offline_queue.db")).unwrap();
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn failed_manual_bookmark_capture_rolls_back_the_clock_command() {
    let endpoint = "http://127.0.0.1:9";
    let device = Device::new();
    device.negotiated_with(endpoint, "org-1", true, BREAK_KINDS);
    let conn = rusqlite::Connection::open(device.dir.path().join("offline_queue.db")).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_bookmark BEFORE INSERT ON companion_break BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END;").unwrap();
    assert!(device
        .act(endpoint, ClockCommand::StartBreak)
        .await
        .is_err());
    assert!(device.saved().is_empty());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM companion_break", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn offline_restart_inventory_requires_matching_negotiated_identity_and_is_not_an_access_grant() {
    let device = Device::new();
    let endpoint = "https://app.z8.test";
    let fingerprint = token_fingerprint(TOKEN);
    let body = serde_json::json!({"userId":"user-1","activeOrganizationId":"org-1","organizations":[{"id":"org-1","name":"Acme","hasEmployeeRecord":true}]}).to_string();
    device
        .store
        .lock()
        .save_organizations(endpoint, &fingerprint, &body)
        .unwrap();
    assert!(device
        .store
        .lock()
        .offline_organizations(endpoint, &fingerprint)
        .unwrap()
        .is_none());
    device.negotiated_with(endpoint, "org-1", false, BREAK_KINDS);
    let device = device.restart();
    assert_eq!(
        device
            .store
            .lock()
            .offline_organizations(endpoint, &fingerprint)
            .unwrap()
            .unwrap()["activeOrganizationId"],
        "org-1"
    );
    assert!(device
        .store
        .lock()
        .offline_organizations(endpoint, &token_fingerprint("another-session"))
        .unwrap()
        .is_none());
    device.negotiated_with(endpoint, "org-2", false, BREAK_KINDS);
    assert!(device
        .store
        .lock()
        .offline_organizations(endpoint, &fingerprint)
        .unwrap()
        .is_none());
    device.negotiated_with(endpoint, "org-1", false, BREAK_KINDS);
    device.store.lock().forget_contexts().unwrap();
    assert!(device
        .store
        .lock()
        .offline_organizations(endpoint, &fingerprint)
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn first_status_read_binds_confirmed_status_before_enabling_offline_clocking() {
    let device = Device::new();
    let capabilities = support::capabilities_with("org-1", "available", BREAK_KINDS);
    let status = support::status(false);
    let (endpoint, requests) =
        test_http::server(vec![Some((200, &capabilities)), Some((200, &status))]);
    crate::clock_command::refresh_status(&device.at(&endpoint, TOKEN))
        .await
        .unwrap();
    let cached = device
        .store
        .lock()
        .cached_context(&endpoint, &token_fingerprint(TOKEN))
        .unwrap()
        .unwrap();
    assert!(cached.status.is_some());
    assert!(
        !serde_json::from_str::<crate::clock::ClockStatus>(&cached.status.unwrap())
            .unwrap()
            .is_clocked_in
    );
    let requests = requests.join().unwrap();
    assert!(requests[0].starts_with("GET /api/time-entries/commands "));
    assert!(requests[1].starts_with("GET /api/time-entries/status "));
}

#[tokio::test]
async fn status_for_a_different_employee_cannot_seed_offline_clocking() {
    let device = Device::new();
    let capabilities = support::capabilities_with("org-1", "available", BREAK_KINDS);
    let status = support::status(false).replace(support::EMPLOYEE, "another-employee");
    let (endpoint, requests) =
        test_http::server(vec![Some((200, &capabilities)), Some((200, &status))]);
    assert!(
        crate::clock_command::refresh_status(&device.at(&endpoint, TOKEN))
            .await
            .is_err()
    );
    assert!(device
        .store
        .lock()
        .cached_context(&endpoint, &token_fingerprint(TOKEN))
        .unwrap()
        .unwrap()
        .status
        .is_none());
    requests.join().unwrap();
}
