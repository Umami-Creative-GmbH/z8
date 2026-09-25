use crate::clock::WorkLocationType;
use crate::frozen_command::{
    freeze_clock_in, freeze_clock_out, new_operation_id, utc_instant, Admission, ClockTarget,
    CommandContext, CommandKind,
};
use chrono::{DateTime, TimeZone, Utc};

fn context() -> CommandContext {
    CommandContext {
        user_id: "user-1".into(),
        organization_id: "org-1".into(),
        employee_id: "7d1f3f0e-8a4c-4a7e-9f39-0b8f1a2c3d4e".into(),
        server: "https://app.z8.test".into(),
    }
}

fn instant() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 20, 8, 0, 5).unwrap() + chrono::Duration::microseconds(123_987)
}

const CLOCK_IN_OPERATION: &str = "3b241101-e2bb-4255-8caf-4136c566a962";
const CLOCK_OUT_OPERATION: &str = "9f2a6c1e-5d7b-4c3a-b1e8-2f0d4a6b8c9e";

#[test]
fn operation_ids_are_lowercase_random_uuids() {
    let pattern = regex_lite(&new_operation_id());
    assert!(
        pattern,
        "Must match the server's canonical UUID representation"
    );
    assert_ne!(new_operation_id(), new_operation_id());
}

fn regex_lite(value: &str) -> bool {
    let parts: Vec<&str> = value.split('-').collect();
    parts.iter().map(|part| part.len()).collect::<Vec<_>>() == [8, 4, 4, 4, 12]
        && value
            .chars()
            .all(|c| c == '-' || c.is_ascii_digit() || ('a'..='f').contains(&c))
        && parts[2].starts_with('4')
        && matches!(parts[3].chars().next(), Some('8' | '9' | 'a' | 'b'))
}

#[test]
fn instants_are_utc_with_millisecond_precision_not_rounded_up() {
    assert_eq!(utc_instant(instant()), "2026-09-20T08:00:05.123Z");
}

#[test]
fn clock_in_freezes_the_exact_v2_wire_command() {
    let frozen = freeze_clock_in(
        CLOCK_IN_OPERATION.into(),
        context(),
        instant(),
        "Europe/Berlin",
        Admission::Delayed,
        WorkLocationType::Remote,
        None,
    );
    assert_eq!(frozen.kind, CommandKind::ClockIn);
    assert_eq!(frozen.operation_id, CLOCK_IN_OPERATION);
    assert_eq!(frozen.depends_on, None);
    assert_eq!(
        frozen.body,
        include_str!("fixtures/desktop-v2-clock-in.json").trim_end()
    );
}

#[test]
fn clock_out_binds_a_queued_clock_in_and_preserves_attribution() {
    let frozen = freeze_clock_out(
        CLOCK_OUT_OPERATION.into(),
        context(),
        instant() + chrono::Duration::hours(8),
        "Europe/Berlin",
        Admission::Delayed,
        ClockTarget::ClockInOperation(CLOCK_IN_OPERATION.into()),
        Some(CLOCK_IN_OPERATION.into()),
    );
    assert_eq!(frozen.kind, CommandKind::ClockOut);
    assert_eq!(frozen.depends_on.as_deref(), Some(CLOCK_IN_OPERATION));
    assert_eq!(
        frozen.body,
        include_str!("fixtures/desktop-v2-clock-out.json").trim_end()
    );
}

#[test]
fn clock_out_can_bind_a_known_work_period() {
    let frozen = freeze_clock_out(
        CLOCK_OUT_OPERATION.into(),
        context(),
        instant(),
        "UTC",
        Admission::Immediate,
        ClockTarget::WorkPeriod("5c0b1a8e-2f4d-4e6a-9b3c-7d8e9f0a1b2c".into()),
        None,
    );
    let body: serde_json::Value = serde_json::from_str(&frozen.body).unwrap();
    assert_eq!(
        body["target"],
        serde_json::json!({ "workPeriodId": "5c0b1a8e-2f4d-4e6a-9b3c-7d8e9f0a1b2c" })
    );
    assert_eq!(body["admission"], "immediate");
    assert_eq!(body["timezone"], "UTC");
}
