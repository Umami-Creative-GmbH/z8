use parking_lot::Mutex;
use rdev::{listen, Event, EventType};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::break_evidence::{BreakReview, IdleTracker, MonitorContinuity, Observation};
use crate::frozen_command::utc_instant;
use crate::state::AppState;

const IDLE_THRESHOLD_MS: u64 = 10 * 60 * 1000; // 10 minutes; employee-configurable
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
    pub start_timezone: Option<String>,
    pub return_timezone: Option<String>,
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
    let listener_app = app_handle.clone();

    // Spawn input listener thread. The first input after idleness is the return.
    std::thread::spawn(move || {
        let callback = move |event: Event| match event.event_type {
            EventType::KeyPress(_)
            | EventType::KeyRelease(_)
            | EventType::ButtonPress(_)
            | EventType::ButtonRelease(_)
            | EventType::MouseMove { .. }
            | EventType::Wheel { .. } => {
                let state = listener_app.state::<Arc<AppState>>();
                if !state.settings.read().idle_enabled || !state.is_clocked_in() {
                    return;
                }
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
    std::thread::spawn(move || {
        let mut configuration = (false, 10u64);
        let mut continuity = MonitorContinuity::new(Observation::now(), CHECK_INTERVAL_SECS * 3000);
        loop {
            std::thread::sleep(Duration::from_secs(CHECK_INTERVAL_SECS));

            let state = app_handle.state::<Arc<AppState>>();
            let next = {
                let settings = state.settings.read();
                (
                    settings.idle_enabled,
                    settings.idle_threshold_minutes.clamp(1, 240),
                )
            };
            if next != configuration {
                *tracker.lock() = IdleTracker::new(Observation::now(), next.1 * 60 * 1000);
                state.set_pending_break(None);
                configuration = next;
            }
            let observation = Observation::now();
            if !continuity.observe(observation) {
                *tracker.lock() = IdleTracker::new(observation, configuration.1 * 60 * 1000);
                state.set_pending_break(None);
                if configuration.0 {
                    let _ = app_handle.emit("idle_cancelled", ());
                }
                continue;
            }
            let is_clocked_in = state.is_clocked_in() && configuration.0;
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
                start_timezone: idle.idle_detected.timezone.clone(),
                return_timezone: idle.returned.timezone.clone(),
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
        }
    });
}
