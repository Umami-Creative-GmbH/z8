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
