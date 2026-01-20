use parking_lot::Mutex;
use rdev::{listen, Event, EventType};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

const IDLE_THRESHOLD_SECS: u64 = 5 * 60; // 5 minutes
const CHECK_INTERVAL_SECS: u64 = 10; // Check every 10 seconds

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleEvent {
    pub idle_start_time: String,
    pub idle_duration_ms: u64,
}

/// Starts the idle monitor in a background thread
pub fn start_idle_monitor(app_handle: AppHandle) {
    log::info!("Starting idle monitor (threshold: {}s)", IDLE_THRESHOLD_SECS);

    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let last_activity_clone = last_activity.clone();
    let app_handle_clone = app_handle.clone();

    // Spawn input listener thread
    std::thread::spawn(move || {
        let callback = move |event: Event| {
            match event.event_type {
                EventType::KeyPress(_)
                | EventType::KeyRelease(_)
                | EventType::ButtonPress(_)
                | EventType::ButtonRelease(_)
                | EventType::MouseMove { .. }
                | EventType::Wheel { .. } => {
                    *last_activity_clone.lock() = Instant::now();
                }
            }
        };

        if let Err(e) = listen(callback) {
            log::error!("Failed to start input listener: {:?}", e);
        }
    });

    // Spawn idle checker thread
    std::thread::spawn(move || {
        let mut was_idle = false;
        let mut idle_start: Option<Instant> = None;

        loop {
            std::thread::sleep(Duration::from_secs(CHECK_INTERVAL_SECS));

            let last_activity_time = *last_activity.lock();
            let idle_duration = last_activity_time.elapsed();
            let is_idle = idle_duration >= Duration::from_secs(IDLE_THRESHOLD_SECS);

            // Check if user is clocked in
            let state = app_handle.state::<Arc<AppState>>();
            let is_clocked_in = state.is_clocked_in();

            if is_idle && !was_idle && is_clocked_in {
                // User just became idle while clocked in
                idle_start = Some(last_activity_time);
                was_idle = true;
                log::info!("User idle detected (clocked in)");
            } else if !is_idle && was_idle && is_clocked_in {
                // User returned from being idle while still clocked in
                if let Some(start) = idle_start {
                    let idle_ms = start.elapsed().as_millis() as u64;
                    let idle_start_time = chrono::Utc::now()
                        - chrono::Duration::milliseconds(idle_ms as i64);

                    let event = IdleEvent {
                        idle_start_time: idle_start_time.to_rfc3339(),
                        idle_duration_ms: idle_ms,
                    };

                    log::info!(
                        "User returned from idle (duration: {}ms)",
                        idle_ms
                    );

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

                was_idle = false;
                idle_start = None;
            } else if !is_clocked_in {
                // Reset idle tracking if not clocked in
                was_idle = false;
                idle_start = None;
            }
        }
    });
}
