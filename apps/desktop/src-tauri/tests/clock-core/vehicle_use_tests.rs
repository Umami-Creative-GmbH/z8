//! Vehicle use from the desktop (#1124, spec #807): version 4 frozen commands
//! only for a server that advertises them, the online route's `vehicleUse`, and
//! saved version 4 commands waiting while a server does not list the version.
use crate::clock::WorkLocationType;
use crate::clock_command::{execute_companion, ActionEvidence, ClockCommand, ClockCommandOutcome};
use crate::command_store::{CommandState, FailureClass};
use crate::frozen_command::{BreakVehicleUse, ClockVehicleUse, ClosingAttribution};
use crate::support::{self, Device, BREAK_KINDS, TOKEN};
use crate::test_http;
use chrono::Utc;

const OFFLINE: &str = "http://127.0.0.1:9";
const VEHICLE: &str = "0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5";
const WITH_VEHICLES: &[u32] = &[2, 3, 4];

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap()
}

fn vehicle_use(text: &str) -> ClockVehicleUse {
    serde_json::from_str(text).unwrap()
}

fn clock_in_with_vehicle() -> ClockCommand {
    ClockCommand::ClockIn(
        WorkLocationType::Office,
        Some(vehicle_use(&format!(
            r#"{{"vehicle":{{"kind":"organization","vehicleId":"{VEHICLE}"}},"startKm":12000}}"#
        ))),
    )
}

fn stored_version(device: &Device) -> i64 {
    rusqlite::Connection::open(device.dir.path().join("offline_queue.db"))
        .unwrap()
        .query_row("SELECT command_version FROM clock_command", [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[tokio::test]
async fn a_clock_in_with_vehicle_use_is_saved_as_version_4_when_the_server_advertised_it() {
    let device = Device::new();
    device.negotiated_versions(OFFLINE, "org-1", false, BREAK_KINDS, WITH_VEHICLES);

    let outcome = device.act(OFFLINE, clock_in_with_vehicle()).await.unwrap();

    assert!(matches!(outcome, ClockCommandOutcome::SavedOnDevice { .. }));
    let command = json(&device.saved()[0].command);
    assert_eq!(command["version"], 4);
    assert_eq!(
        command["vehicleUse"],
        serde_json::json!({
            "vehicle": { "kind": "organization", "vehicleId": VEHICLE },
            "startKm": 12000,
        })
    );
    assert_eq!(stored_version(&device), 4);
}

#[tokio::test]
async fn an_older_server_gets_the_version_2_command_without_vehicle_use() {
    let device = Device::new();
    device.negotiated_versions(OFFLINE, "org-1", false, BREAK_KINDS, &[2]);

    device.act(OFFLINE, clock_in_with_vehicle()).await.unwrap();

    let command = json(&device.saved()[0].command);
    assert_eq!(command["version"], 2);
    assert!(command.get("vehicleUse").is_none());
    assert_eq!(stored_version(&device), 2);
}

#[tokio::test]
async fn a_clock_out_carries_the_end_reading_and_an_idle_break_its_one_reading() {
    let device = Device::new();
    device.negotiated_versions(OFFLINE, "org-1", true, BREAK_KINDS, WITH_VEHICLES);

    device
        .act(
            OFFLINE,
            ClockCommand::Break {
                evidence: support::confirmed_break(
                    Utc::now() - chrono::Duration::minutes(40),
                    Some("Europe/Berlin"),
                    Some("Europe/Berlin"),
                ),
                location: WorkLocationType::Office,
                vehicle_use: Some(BreakVehicleUse { reading_km: 12_040 }),
            },
        )
        .await
        .unwrap();
    device
        .act(
            OFFLINE,
            ClockCommand::AttributedClose {
                attribution: ClosingAttribution::default(),
                manual_break: false,
                vehicle_use: Some(vehicle_use(r#"{"endKm":12085}"#)),
            },
        )
        .await
        .unwrap();

    let saved = device.saved();
    let taken_break = json(&saved[0].command);
    assert_eq!(taken_break["version"], 4);
    assert_eq!(
        taken_break["vehicleUse"],
        serde_json::json!({ "readingKm": 12040 })
    );
    let clock_out = json(&saved[1].command);
    assert_eq!(clock_out["version"], 4);
    assert_eq!(
        clock_out["vehicleUse"],
        serde_json::json!({ "endKm": 12085 })
    );
}

#[tokio::test]
async fn a_saved_version_4_command_waits_while_the_server_does_not_list_it() {
    let device = Device::new();
    let endpoint = test_http::free_endpoint();
    device.negotiated_versions(&endpoint, "org-1", false, BREAK_KINDS, WITH_VEHICLES);
    device
        .act(&endpoint, clock_in_with_vehicle())
        .await
        .unwrap();
    let attempts = device.saved()[0].attempts;
    let operation_id = device.saved()[0].operation_id.clone();

    // The server rolled back to version 2: the earlier attempt is looked up,
    // but the command is not resent, and nothing is rewritten.
    let requests = test_http::serve_on(&endpoint, 1, move |_, _| {
        Some((
            200,
            serde_json::json!({ "outcome": "not_committed", "operationId": operation_id })
                .to_string(),
        ))
    });
    crate::command_sync::drain(
        &device.service,
        &device.store,
        &endpoint,
        TOKEN,
        &crate::command_transport::Capabilities::parse(&support::capabilities_versions(
            "org-1",
            "available",
            BREAK_KINDS,
            &[2],
        ))
        .unwrap(),
        crate::command_sync::Pacing::Now,
        || Utc::now().timestamp_millis(),
    )
    .await
    .unwrap();
    let requests = requests.join().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("GET /api/time-entries/commands/"));

    let saved = &device.saved()[0];
    assert_eq!(saved.state, CommandState::Pending);
    assert_eq!(saved.attempts, attempts);
    let failure = saved.failure.as_ref().unwrap();
    assert_eq!(failure.class, FailureClass::Paused);
    assert_eq!(failure.code, "submit_unavailable");
    assert_eq!(json(&saved.command)["version"], 4);
}

fn entry(kind: &str) -> String {
    serde_json::json!({"entry":{"id":"online-entry","employeeId":support::EMPLOYEE,"type":kind,"timestamp":"2026-10-09T08:00:00Z"}}).to_string()
}

/// Before adoption the desktop clocks online through `POST /api/time-entries`.
async fn online_clock_in_body(versions: &[u32]) -> serde_json::Value {
    let device = Device::new();
    let (endpoint, requests) = test_http::server(vec![
        Some((
            200,
            support::capabilities_versions("org-1", "unavailable", BREAK_KINDS, versions),
        )),
        Some((200, support::status(false))),
        Some((200, entry("clock_in"))),
        Some((200, support::status(true))),
    ]);
    let outcome = execute_companion(
        &device.at(&endpoint, TOKEN),
        clock_in_with_vehicle(),
        ActionEvidence {
            occurred_at: Utc::now(),
            timezone: Some("Europe/Berlin".into()),
        },
        "org-1",
    )
    .await
    .unwrap();
    assert!(matches!(outcome, ClockCommandOutcome::Committed { .. }));
    let requests = requests.join().unwrap();
    assert!(requests[2].starts_with("POST /api/time-entries "));
    json(test_http::request_body(&requests[2]))
}

#[tokio::test]
async fn online_clocking_sends_vehicle_use_only_to_a_server_that_records_it() {
    assert_eq!(
        online_clock_in_body(WITH_VEHICLES).await["vehicleUse"],
        serde_json::json!({
            "vehicle": { "kind": "organization", "vehicleId": VEHICLE },
            "startKm": 12000,
        })
    );
    assert!(online_clock_in_body(&[2]).await.get("vehicleUse").is_none());
}

#[tokio::test]
async fn an_online_manual_break_sends_its_reading_as_the_end_reading() {
    let device = Device::new();
    let (endpoint, requests) = test_http::server(vec![
        Some((
            200,
            support::capabilities_versions("org-1", "unavailable", BREAK_KINDS, WITH_VEHICLES),
        )),
        Some((200, support::status(true))),
        Some((200, entry("clock_out"))),
        Some((200, support::status(false))),
    ]);
    execute_companion(
        &device.at(&endpoint, TOKEN),
        ClockCommand::AttributedClose {
            attribution: ClosingAttribution::default(),
            manual_break: true,
            vehicle_use: Some(vehicle_use(r#"{"endKm":12040}"#)),
        },
        ActionEvidence {
            occurred_at: Utc::now(),
            timezone: Some("Europe/Berlin".into()),
        },
        "org-1",
    )
    .await
    .unwrap();
    let requests = requests.join().unwrap();
    let body = json(test_http::request_body(&requests[2]));
    assert_eq!(body["type"], "clock_out");
    assert_eq!(body["vehicleUse"], serde_json::json!({ "endKm": 12040 }));
}
