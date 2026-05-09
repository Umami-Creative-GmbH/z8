use anyhow::Result;
use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::clock::{ClockService, WorkLocationType};
use crate::state::AppState;
use crate::tray;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ActionType {
    ClockIn,
    ClockOut,
    ClockOutWithBreak,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedAction {
    pub id: i64,
    pub action_type: ActionType,
    pub timestamp: i64,
    pub payload: Option<String>,
    pub retry_count: i32,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClockOutWithBreakPayload {
    break_start_time: String,
    work_location_type: String,
}

fn parse_clock_out_with_break_payload(payload: &str) -> Result<(DateTime<Utc>, WorkLocationType)> {
    if let Ok(parsed_payload) = serde_json::from_str::<ClockOutWithBreakPayload>(payload) {
        let break_time = DateTime::parse_from_rfc3339(&parsed_payload.break_start_time)
            .map(|time| time.with_timezone(&Utc))?;
        let work_location_type = WorkLocationType::from_str(&parsed_payload.work_location_type)
            .ok_or_else(|| anyhow::anyhow!("Invalid work location type payload"))?;

        return Ok((break_time, work_location_type));
    }

    let break_time = DateTime::parse_from_rfc3339(payload).map(|time| time.with_timezone(&Utc))?;
    Ok((break_time, WorkLocationType::Office))
}

fn queued_timestamp_to_rfc3339(timestamp: i64) -> Result<String> {
    Utc.timestamp_opt(timestamp, 0)
        .single()
        .map(|time| time.to_rfc3339())
        .ok_or_else(|| anyhow::anyhow!("Invalid queued timestamp: {}", timestamp))
}

pub struct OfflineQueue {
    conn: Connection,
}

impl OfflineQueue {
    pub fn new(app_data_dir: &Path) -> Result<Self> {
        let db_path = app_data_dir.join("offline_queue.db");
        let conn = Connection::open(&db_path)?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                payload TEXT,
                retry_count INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_queue_created_at ON queue(created_at)",
            [],
        )?;

        Ok(Self { conn })
    }

    pub fn enqueue(&mut self, action_type: ActionType, timestamp: i64, payload: Option<String>) -> Result<i64> {
        let action_str = serde_json::to_string(&action_type)?;
        let now = Utc::now().timestamp();

        self.conn.execute(
            "INSERT INTO queue (action_type, timestamp, payload, created_at) VALUES (?, ?, ?, ?)",
            params![action_str, timestamp, payload, now],
        )?;

        let id = self.conn.last_insert_rowid();
        log::info!("Enqueued action: {:?} (id: {})", action_type, id);
        Ok(id)
    }

    pub fn get_pending(&self) -> Result<Vec<QueuedAction>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, action_type, timestamp, payload, retry_count, created_at
             FROM queue
             ORDER BY created_at ASC",
        )?;

        let mut rows = stmt.query([])?;
        let mut actions = Vec::new();

        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let action_str: String = row.get(1)?;
            let action_type = match serde_json::from_str(&action_str) {
                Ok(action_type) => action_type,
                Err(e) => {
                    log::warn!("Skipping malformed queued action {}: {}", id, e);
                    continue;
                }
            };

            actions.push(QueuedAction {
                id,
                action_type,
                timestamp: row.get(2)?,
                payload: row.get(3)?,
                retry_count: row.get(4)?,
                created_at: row.get(5)?,
            });
        }

        Ok(actions)
    }

    pub fn mark_completed(&mut self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM queue WHERE id = ?", params![id])?;
        log::info!("Removed completed action from queue (id: {})", id);
        Ok(())
    }

    pub fn increment_retry(&mut self, id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE queue SET retry_count = retry_count + 1 WHERE id = ?",
            params![id],
        )?;
        Ok(())
    }

    pub fn count(&self) -> Result<i64> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM queue", [], |row| row.get(0))?;
        Ok(count)
    }
}

/// Starts the background queue processor
pub async fn start_queue_processor(app_handle: AppHandle) {
    log::info!("Starting offline queue processor");

    let clock_service = ClockService::new();

    loop {
        tokio::time::sleep(Duration::from_secs(30)).await;

        let state = app_handle.state::<Arc<AppState>>();
        let token = match state.get_session_token() {
            Some(t) => t,
            None => continue, // Not logged in
        };

        let webapp_url = state.get_webapp_url();
        if webapp_url.is_empty() {
            continue;
        }

        // Get pending actions
        let pending = {
            let queue = state.offline_queue.lock();
            match queue.get_pending() {
                Ok(p) => p,
                Err(e) => {
                    log::error!("Failed to get pending queue: {}", e);
                    continue;
                }
            }
        };

        if pending.is_empty() {
            continue;
        }

        log::info!("Processing {} pending offline actions", pending.len());

        for action in pending {
            // Skip if too many retries
            if action.retry_count >= 5 {
                log::warn!(
                    "Skipping action {} after {} retries",
                    action.id,
                    action.retry_count
                );
                continue;
            }

            let result = match action.action_type {
                ActionType::ClockIn => {
                    let work_location_type = action
                        .payload
                        .as_deref()
                        .and_then(WorkLocationType::from_str)
                        .unwrap_or(WorkLocationType::Office);
                    match queued_timestamp_to_rfc3339(action.timestamp) {
                        Ok(timestamp) => {
                            clock_service
                                .clock_in(
                                    &webapp_url,
                                    &token,
                                    work_location_type,
                                    Some(&timestamp),
                                )
                                .await
                                .map(|_| ())
                        }
                        Err(e) => Err(e),
                    }
                }
                ActionType::ClockOut => {
                    clock_service.clock_out(&webapp_url, &token).await.map(|_| ())
                }
                ActionType::ClockOutWithBreak => {
                    if let Some(payload) = &action.payload {
                        match parse_clock_out_with_break_payload(payload) {
                            Ok((break_time, work_location_type)) => {
                                match queued_timestamp_to_rfc3339(action.timestamp) {
                                    Ok(resume_timestamp) => {
                                        clock_service
                                            .clock_out_with_break(
                                                &webapp_url,
                                                &token,
                                                break_time,
                                                work_location_type,
                                                Some(&resume_timestamp),
                                            )
                                            .await
                                    }
                                    Err(e) => Err(e),
                                }
                            }
                            Err(e) => Err(e),
                        }
                    } else {
                        Err(anyhow::anyhow!("Missing break time payload"))
                    }
                }
            };

            match result {
                Ok(_) => {
                    let mut queue = state.offline_queue.lock();
                    let _ = queue.mark_completed(action.id);
                }
                Err(e) => {
                    log::error!("Failed to process queued action {}: {}", action.id, e);
                    let mut queue = state.offline_queue.lock();
                    let _ = queue.increment_retry(action.id);
                }
            }
        }

        // Update clock status after processing queue
        if let Ok(status) = clock_service.get_status(&webapp_url, &token).await {
            state.set_clocked_in(status.is_clocked_in);
            let _ = tray::update_tray_icon(&app_handle, status.is_clocked_in);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_clock_out_with_break_payload, queued_timestamp_to_rfc3339, ActionType, OfflineQueue};
    use crate::clock::WorkLocationType;
    use rusqlite::params;
    use std::fs;

    #[test]
    fn parses_clock_out_with_break_payloads_with_legacy_default() {
        let legacy = "2026-05-09T10:15:30Z";
        let (break_time, work_location_type) = parse_clock_out_with_break_payload(legacy).unwrap();
        assert_eq!(break_time.to_rfc3339(), "2026-05-09T10:15:30+00:00");
        assert_eq!(work_location_type.as_str(), WorkLocationType::Office.as_str());

        let current = r#"{"breakStartTime":"2026-05-09T10:15:30Z","workLocationType":"remote"}"#;
        let (break_time, work_location_type) = parse_clock_out_with_break_payload(current).unwrap();
        assert_eq!(break_time.to_rfc3339(), "2026-05-09T10:15:30+00:00");
        assert_eq!(work_location_type.as_str(), WorkLocationType::Remote.as_str());
    }

    #[test]
    fn get_pending_skips_malformed_action_type_rows() {
        let dir = std::env::temp_dir().join(format!(
            "z8-offline-queue-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::create_dir_all(&dir).unwrap();
        let queue = OfflineQueue::new(&dir).unwrap();

        queue
            .conn
            .execute(
                "INSERT INTO queue (action_type, timestamp, created_at) VALUES (?, ?, ?)",
                params!["not-json", 1_i64, 1_i64],
            )
            .unwrap();
        queue
            .conn
            .execute(
                "INSERT INTO queue (action_type, timestamp, created_at) VALUES (?, ?, ?)",
                params![serde_json::to_string(&ActionType::ClockIn).unwrap(), 2_i64, 2_i64],
            )
            .unwrap();

        let actions = queue.get_pending().unwrap();

        assert_eq!(actions.len(), 1);
        assert!(matches!(actions[0].action_type, ActionType::ClockIn));
        assert_eq!(actions[0].timestamp, 2);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn converts_queued_timestamp_seconds_to_rfc3339() {
        assert_eq!(
            queued_timestamp_to_rfc3339(1_777_593_600).unwrap(),
            "2026-05-01T00:00:00+00:00"
        );
    }
}
