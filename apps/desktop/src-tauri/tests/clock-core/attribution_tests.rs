#[test]
fn clock_out_freezes_explicit_attribution_without_changing_default_preservation() {
    use crate::frozen_command::*;
    let frame = CommandFrame {
        operation_id: new_operation_id(),
        context: CommandContext {
            user_id: "user".into(),
            organization_id: "org".into(),
            employee_id: "employee".into(),
            server: "https://app.test".into(),
        },
        occurred_at: "2026-10-08T08:00:00Z".parse().unwrap(),
        timezone: "Europe/Berlin".into(),
        admission: Admission::Delayed,
        depends_on: None,
    };
    let command = freeze_attributed_clock_out(
        frame.clone(),
        ClockTarget::WorkPeriod("period".into()),
        &ClosingAttribution {
            project: AttributionIntent::Replace {
                id: "project".into(),
            },
            work_category: AttributionIntent::Clear,
            task: None,
        },
    );
    let body: serde_json::Value = serde_json::from_str(&command.body).unwrap();
    assert_eq!(
        body["project"],
        serde_json::json!({"kind": "replace", "id": "project"})
    );
    assert_eq!(body["workCategory"], serde_json::json!({"kind": "clear"}));
    let default: serde_json::Value = serde_json::from_str(
        &freeze_clock_out(frame, ClockTarget::WorkPeriod("period".into())).body,
    )
    .unwrap();
    assert_eq!(default["project"], serde_json::json!({"kind": "preserve"}));
}

fn frame() -> crate::frozen_command::CommandFrame {
    use crate::frozen_command::*;
    CommandFrame {
        operation_id: "9f2a6c1e-5d7b-4c3a-b1e8-2f0d4a6b8c9e".into(),
        context: CommandContext {
            user_id: "user".into(),
            organization_id: "org".into(),
            employee_id: "employee".into(),
            server: "https://app.test".into(),
        },
        occurred_at: "2026-10-08T08:00:00Z".parse().unwrap(),
        timezone: "Europe/Berlin".into(),
        admission: Admission::Delayed,
        depends_on: None,
    }
}

/// The attribution exactly as the webview sends it over IPC.
fn from_webview(json: &str) -> crate::frozen_command::ClosingAttribution {
    serde_json::from_str(json).unwrap()
}

#[test]
fn clock_out_freezes_a_chosen_task_with_its_project() {
    use crate::frozen_command::*;
    let attribution = from_webview(
        r#"{"project":{"kind":"replace","id":"11111111-1111-4111-8111-111111111111"},
            "workCategory":{"kind":"preserve"},
            "task":{"kind":"replace","id":"22222222-2222-4222-8222-222222222222"}}"#,
    );
    let command = freeze_attributed_clock_out(
        frame(),
        ClockTarget::WorkPeriod("period".into()),
        &attribution,
    );
    let body: serde_json::Value = serde_json::from_str(&command.body).unwrap();
    assert_eq!(
        body["task"],
        serde_json::json!({"kind": "replace", "id": "22222222-2222-4222-8222-222222222222"})
    );
    assert_eq!(
        body["project"],
        serde_json::json!({"kind": "replace", "id": "11111111-1111-4111-8111-111111111111"})
    );
}

#[test]
fn clock_out_can_clear_the_task() {
    use crate::frozen_command::*;
    let attribution = from_webview(
        r#"{"project":{"kind":"preserve"},"workCategory":{"kind":"preserve"},"task":{"kind":"clear"}}"#,
    );
    let command = freeze_attributed_clock_out(
        frame(),
        ClockTarget::WorkPeriod("period".into()),
        &attribution,
    );
    let body: serde_json::Value = serde_json::from_str(&command.body).unwrap();
    assert_eq!(body["task"], serde_json::json!({"kind": "clear"}));
}

/// Older servers refuse an unknown `task` key, and the server contract says a
/// command without a task is byte-for-byte what it was before tasks existed.
#[test]
fn clock_out_without_a_task_omits_the_key_and_keeps_its_bytes() {
    use crate::frozen_command::*;
    let attribution =
        from_webview(r#"{"project":{"kind":"preserve"},"workCategory":{"kind":"preserve"}}"#);
    let attributed = freeze_attributed_clock_out(
        frame(),
        ClockTarget::WorkPeriod("period".into()),
        &attribution,
    );
    let plain = freeze_clock_out(frame(), ClockTarget::WorkPeriod("period".into()));
    assert!(!attributed.body.contains("task"), "{}", attributed.body);
    assert_eq!(attributed.body, plain.body);
}

#[test]
fn the_webview_cannot_send_a_null_task() {
    let refused = serde_json::from_str::<crate::frozen_command::ClosingAttribution>(
        r#"{"project":{"kind":"preserve"},"workCategory":{"kind":"preserve"},"task":null}"#,
    );
    assert!(
        refused.is_err(),
        "A null task would freeze an invalid command"
    );
}
