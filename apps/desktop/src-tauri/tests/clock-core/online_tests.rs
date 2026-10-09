use crate::{
    clock::WorkLocationType,
    clock_command::{execute_companion, ActionEvidence, ClockCommand, ClockCommandOutcome},
    frozen_command::ClosingAttribution,
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
fn entry(kind: &str) -> String {
    serde_json::json!({"entry":{"id":"online-entry", "employeeId":support::EMPLOYEE,"type":kind,"timestamp":"2026-10-09T08:00:00Z"}}).to_string()
}
#[tokio::test]
async fn online_clock_in_works_before_organization_adoption() {
    let device = Device::new();
    let (endpoint, requests) = test_http::server(vec![
        Some((
            200,
            support::capabilities_with("org-1", "unavailable", BREAK_KINDS),
        )),
        Some((200, support::status(false))),
        Some((200, entry("clock_in"))),
        Some((200, support::status(true))),
    ]);
    let outcome = execute_companion(
        &device.at(&endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Home),
        evidence(),
        "org-1",
    )
    .await
    .unwrap();
    assert!(matches!(outcome, ClockCommandOutcome::Committed { .. }));
    assert!(device.saved().is_empty());
    let requests = requests.join().unwrap();
    assert!(requests[2].starts_with("POST /api/time-entries "));
    let body: serde_json::Value =
        serde_json::from_str(test_http::request_body(&requests[2])).unwrap();
    assert_eq!(body["browserTimezone"], "Europe/Berlin");
    assert_eq!(body["desktopContext"]["organizationId"], "org-1");
    assert!(body["timestamp"].is_string());
}
#[tokio::test]
async fn online_clock_out_preserves_attribution_and_manual_break_survives_restart() {
    let device = Device::new();
    let (endpoint, requests) = test_http::server(vec![
        Some((
            200,
            support::capabilities_with("org-1", "unavailable", BREAK_KINDS),
        )),
        Some((200, support::status(true))),
        Some((200, entry("clock_out"))),
        Some((200, support::status(false))),
    ]);
    let outcome = execute_companion(
        &device.at(&endpoint, TOKEN),
        ClockCommand::AttributedClose {
            attribution: ClosingAttribution::default(),
            manual_break: true,
        },
        evidence(),
        "org-1",
    )
    .await
    .unwrap();
    assert!(matches!(outcome, ClockCommandOutcome::Committed { .. }));
    let requests = requests.join().unwrap();
    let body: serde_json::Value =
        serde_json::from_str(test_http::request_body(&requests[2])).unwrap();
    assert!(body.get("projectId").is_none());
    assert!(body.get("workCategoryId").is_none());
    let context = crate::command_transport::Capabilities::parse(&support::capabilities_with(
        "org-1",
        "unavailable",
        BREAK_KINDS,
    ))
    .unwrap()
    .command_context()
    .unwrap();
    assert!(device.store.lock().on_break(&endpoint, &context).unwrap());
    let device = device.restart();
    assert!(device.store.lock().on_break(&endpoint, &context).unwrap());
    device.store.lock().end_break(&endpoint, &context).unwrap();
    assert!(!device.store.lock().on_break(&endpoint, &context).unwrap());
}
#[tokio::test]
async fn online_clocking_refuses_a_changed_organization_without_a_write() {
    let device = Device::new();
    let (endpoint, requests) = test_http::server(vec![Some((
        200,
        support::capabilities_with("other-org", "unavailable", BREAK_KINDS),
    ))]);
    assert!(execute_companion(
        &device.at(&endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Home),
        evidence(),
        "org-1"
    )
    .await
    .is_err());
    assert_eq!(requests.join().unwrap().len(), 1);
    assert!(device.saved().is_empty());
}
#[tokio::test]
async fn online_clocking_never_queues_a_fresh_offline_action() {
    let device = Device::new();
    let endpoint = "http://127.0.0.1:9";
    device
        .store
        .lock()
        .save_capabilities(
            endpoint,
            &crate::command_store::token_fingerprint(TOKEN),
            &support::capabilities_with("org-1", "unavailable", BREAK_KINDS),
            1,
        )
        .unwrap();
    assert!(execute_companion(
        &device.at(endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Home),
        evidence(),
        "org-1"
    )
    .await
    .is_err());
    assert!(device.saved().is_empty());
    assert_eq!(device.queue.lock().count().unwrap(), 0);
}
#[tokio::test]
async fn online_lost_response_is_retained_for_review_and_never_replayed() {
    let device = Device::new();
    let (endpoint, requests) = test_http::server(vec![
        Some((
            200,
            support::capabilities_with("org-1", "unavailable", BREAK_KINDS),
        )),
        Some((200, support::status(false))),
        None,
    ]);
    let outcome = execute_companion(
        &device.at(&endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Office),
        evidence(),
        "org-1",
    )
    .await
    .unwrap();
    assert!(matches!(
        outcome,
        ClockCommandOutcome::RetainedForReview { .. }
    ));
    assert_eq!(requests.join().unwrap().len(), 3);
    assert_eq!(device.queue.lock().count().unwrap(), 1);
    assert_eq!(device.queue.lock().recovery_summary().unwrap().malformed, 0);
    assert!(device.saved().is_empty());
}

#[tokio::test]
async fn definite_online_refusal_does_not_poison_recovery() {
    let device = Device::new();
    let (endpoint, requests) = test_http::server(vec![
        Some((
            200,
            support::capabilities_with("org-1", "unavailable", BREAK_KINDS),
        )),
        Some((200, support::status(false))),
        Some((409, "{\"error\":\"Already clocked in\"}".into())),
    ]);
    let error = execute_companion(
        &device.at(&endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Office),
        evidence(),
        "org-1",
    )
    .await
    .unwrap_err();
    assert_eq!(error.message, "Already clocked in");
    assert_eq!(requests.join().unwrap().len(), 3);
    assert_eq!(device.queue.lock().count().unwrap(), 0);
}
#[tokio::test]
async fn adopted_organization_keeps_frozen_transport_without_atomic_break_requirement() {
    let device = Device::new();
    let endpoint = "http://127.0.0.1:9";
    device.negotiated(endpoint, "org-1", false);
    let outcome = execute_companion(
        &device.at(endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Office),
        evidence(),
        "org-1",
    )
    .await
    .unwrap();
    assert!(matches!(outcome, ClockCommandOutcome::SavedOnDevice { .. }));
    assert_eq!(device.saved().len(), 1);
    assert_eq!(device.queue.lock().count().unwrap(), 0);
}

#[tokio::test]
async fn online_preflight_failure_or_changed_status_records_nothing() {
    for status in [None, Some((200, support::status(true)))] {
        let device = Device::new();
        let (endpoint, requests) = test_http::server(vec![
            Some((
                200,
                support::capabilities_with("org-1", "unavailable", BREAK_KINDS),
            )),
            status,
        ]);
        assert!(execute_companion(
            &device.at(&endpoint, TOKEN),
            ClockCommand::ClockIn(WorkLocationType::Home),
            evidence(),
            "org-1"
        )
        .await
        .is_err());
        assert_eq!(requests.join().unwrap().len(), 2);
        assert_eq!(device.queue.lock().count().unwrap(), 0);
        assert!(device.saved().is_empty());
    }
}
#[tokio::test]
async fn online_close_sends_explicit_attribution_intent() {
    let device = Device::new();
    let (endpoint, requests) = test_http::server(vec![
        Some((
            200,
            support::capabilities_with("org-1", "unavailable", BREAK_KINDS),
        )),
        Some((200, support::status(true))),
        Some((200, entry("clock_out"))),
        Some((200, support::status(false))),
    ]);
    let outcome = execute_companion(
        &device.at(&endpoint, TOKEN),
        ClockCommand::AttributedClose {
            attribution: ClosingAttribution {
                project: crate::frozen_command::AttributionIntent::Clear,
                work_category: crate::frozen_command::AttributionIntent::Replace {
                    id: "category-1".into(),
                },
                task: None,
            },
            manual_break: false,
        },
        evidence(),
        "org-1",
    )
    .await
    .unwrap();
    assert!(matches!(outcome, ClockCommandOutcome::Committed { .. }));
    let requests = requests.join().unwrap();
    let body: serde_json::Value =
        serde_json::from_str(test_http::request_body(&requests[2])).unwrap();
    assert_eq!(body["projectId"], serde_json::Value::Null);
    assert_eq!(body["workCategoryId"], "category-1");
}

#[tokio::test]
async fn older_server_without_online_context_validation_receives_no_write() {
    let device = Device::new();
    let mut caps: serde_json::Value = serde_json::from_str(&support::capabilities_with(
        "org-1",
        "unavailable",
        BREAK_KINDS,
    ))
    .unwrap();
    caps.as_object_mut().unwrap().remove("onlineSubmit");
    let (endpoint, requests) = test_http::server(vec![
        Some((200, caps.to_string())),
        Some((200, caps.to_string())),
    ]);
    let journal = crate::clock_command::sync(
        &device.at(&endpoint, TOKEN),
        crate::command_sync::Pacing::AfterBackoff,
    )
    .await
    .unwrap();
    assert!(journal.server_update_required);
    assert!(!journal.online_clocking_enabled);
    let error = execute_companion(
        &device.at(&endpoint, TOKEN),
        ClockCommand::ClockIn(WorkLocationType::Home),
        evidence(),
        "org-1",
    )
    .await
    .unwrap_err();
    assert!(error.message.contains("updated Z8 server"));
    assert_eq!(requests.join().unwrap().len(), 2);
    assert_eq!(device.queue.lock().count().unwrap(), 0);
    assert!(device.saved().is_empty());
}
