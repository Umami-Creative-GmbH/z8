use crate::{
    clock_command::{sync, ClockCommand, ClockCommandOutcome},
    command_sync::Pacing,
    support::{Device, TOKEN},
};
#[tokio::test]
async fn offline_manual_break_survives_restart_and_resume_clears_it() {
    let endpoint = "http://127.0.0.1:9";
    let device = Device::new();
    device.negotiated(endpoint, "org-1", true);
    let outcome = device
        .act(endpoint, ClockCommand::StartBreak)
        .await
        .unwrap();
    assert!(matches!(outcome, ClockCommandOutcome::SavedOnDevice { .. }));
    let device = device.restart();
    let journal = sync(&device.at(endpoint, TOKEN), Pacing::Now)
        .await
        .unwrap();
    assert!(journal.on_break);
    assert!(!journal.projection.unwrap().is_clocked_in);
    device
        .act(
            endpoint,
            ClockCommand::ClockIn(crate::clock::WorkLocationType::Home),
        )
        .await
        .unwrap();
    let device = device.restart();
    assert!(
        !sync(&device.at(endpoint, TOKEN), Pacing::Now)
            .await
            .unwrap()
            .on_break
    );
}
