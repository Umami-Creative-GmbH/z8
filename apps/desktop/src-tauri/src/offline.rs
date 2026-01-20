use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::clock::ClockService;
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

        let actions = stmt
            .query_map([], |row| {
                let action_str: String = row.get(1)?;
                let action_type: ActionType = serde_json::from_str(&action_str).unwrap();
                Ok(QueuedAction {
                    id: row.get(0)?,
                    action_type,
                    timestamp: row.get(2)?,
                    payload: row.get(3)?,
                    retry_count: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

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
                    clock_service.clock_in(&webapp_url, &token).await.map(|_| ())
                }
                ActionType::ClockOut => {
                    clock_service.clock_out(&webapp_url, &token).await.map(|_| ())
                }
                ActionType::ClockOutWithBreak => {
                    if let Some(payload) = &action.payload {
                        if let Ok(break_time) = DateTime::parse_from_rfc3339(payload) {
                            clock_service
                                .clock_out_with_break(&webapp_url, &token, break_time.with_timezone(&Utc))
                                .await
                        } else {
                            Err(anyhow::anyhow!("Invalid break time payload"))
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
