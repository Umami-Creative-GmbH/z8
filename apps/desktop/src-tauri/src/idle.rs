use parking_lot::Mutex;
use rdev::{listen, Event, EventType};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::break_evidence::{BreakReview, IdleTracker, Observation};
use crate::frozen_command::utc_instant;
use crate::state::AppState;

const IDLE_THRESHOLD_MS: u64 = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL_SECS: u64 = 10; // Check every 10 seconds

/// What the idle dialog proposes. The observations themselves stay in native
/// state; the confirmation refers to them by `id`, so the webview cannot
/// change the interval it confirms (#281).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleEvent {
    pub id: String,
    /// The last input before idleness: the proposed break start.
    pub idle_start_time: String,
    /// The first input after idleness: the proposed resume, not the dialog answer.
    pub returned_at: String,
    pub idle_duration_ms: u64,
    /// Why the break cannot be recorded automatically, if it cannot.
    pub review: Option<BreakReview>,
}

fn device_zone() -> Option<String> {
    iana_time_zone::get_timezone().ok()
}

/// Starts the idle monitor in background threads
pub fn start_idle_monitor(app_handle: AppHandle) {
    log::info!("Starting idle monitor (threshold: {}ms)", IDLE_THRESHOLD_MS);

    let tracker = Arc::new(Mutex::new(IdleTracker::new(
        Observation::now(),
        IDLE_THRESHOLD_MS,
    )));
    let listener_tracker = tracker.clone();

    // Spawn input listener thread. The first input after idleness is the return.
    std::thread::spawn(move || {
        let callback = move |event: Event| match event.event_type {
            EventType::KeyPress(_)
            | EventType::KeyRelease(_)
            | EventType::ButtonPress(_)
            | EventType::ButtonRelease(_)
            | EventType::MouseMove { .. }
            | EventType::Wheel { .. } => {
                listener_tracker
                    .lock()
                    .activity(Observation::now(), device_zone);
            }
        };

        if let Err(e) = listen(callback) {
            log::error!("Failed to start input listener: {:?}", e);
        }
    });

    // Spawn idle checker thread
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(CHECK_INTERVAL_SECS));

        let state = app_handle.state::<Arc<AppState>>();
        let is_clocked_in = state.is_clocked_in();
        let Some(idle) = tracker
            .lock()
            .tick(Observation::now(), is_clocked_in, device_zone)
        else {
            continue;
        };

        let event = IdleEvent {
            id: idle.id.clone(),
            idle_start_time: utc_instant(idle.last_activity.utc),
            returned_at: utc_instant(idle.returned.at.utc),
            idle_duration_ms: idle.idle_ms(),
            review: idle.review(),
        };
        log::info!(
            "User returned from idle (duration: {}ms)",
            event.idle_duration_ms
        );
        state.set_pending_break(Some(idle));

        // Emit event to frontend
        if let Err(e) = app_handle.emit("idle_detected", event) {
            log::error!("Failed to emit idle event: {}", e);
        }

        // Flash the window to get attention
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}
