use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{params, types::ValueRef, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ActionType {
    ClockIn,
    ClockOut,
    ClockOutWithBreak,
}

/// Preserve SQLite storage classes and bytes, including invalid UTF-8 TEXT.
/// This evidence is deliberately not exposed by the cross-tenant IPC surface.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "storageType", content = "value", rename_all = "camelCase")]
pub enum StoredValue {
    Null,
    Integer(i64),
    Real(f64),
    Text(Vec<u8>),
    Blob(Vec<u8>),
}

impl StoredValue {
    fn from_sql(value: ValueRef<'_>) -> Self {
        match value {
            ValueRef::Null => Self::Null,
            ValueRef::Integer(value) => Self::Integer(value),
            ValueRef::Real(value) => Self::Real(value),
            ValueRef::Text(value) => Self::Text(value.to_vec()),
            ValueRef::Blob(value) => Self::Blob(value.to_vec()),
        }
    }

    fn text(&self) -> Option<&str> {
        match self {
            Self::Text(bytes) => std::str::from_utf8(bytes).ok(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewReason {
    MalformedRecord,
    RetriesExhausted,
    LegacyContextMissing,
    BreakMayBePartiallyCommitted,
    /// The retained break's close was acknowledged by the server, so it committed;
    /// its resume is still unknown. Nothing ever proves that a close did not commit.
    BreakCloseAcknowledged,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedAction {
    /// Existing durable local identity; never a server operation identity.
    pub id: i64,
    pub action_type: StoredValue,
    pub timestamp: StoredValue,
    pub payload: StoredValue,
    pub retry_count: StoredValue,
    pub created_at: StoredValue,
    pub reasons: Vec<ReviewReason>,
}

impl QueuedAction {
    fn classify(&mut self) {
        self.reasons.push(ReviewReason::LegacyContextMissing);
        let action = self
            .action_type
            .text()
            .and_then(|value| serde_json::from_str::<ActionType>(value).ok());
        let valid_payload = match action {
            Some(ActionType::ClockIn) => self
                .payload
                .text()
                .is_some_and(|value| matches!(value, "office" | "home" | "remote" | "other")),
            Some(ActionType::ClockOut) => matches!(self.payload, StoredValue::Null),
            Some(ActionType::ClockOutWithBreak) => {
                self.reasons
                    .push(ReviewReason::BreakMayBePartiallyCommitted);
                let close_acknowledged = self
                    .payload
                    .text()
                    .and_then(|payload| serde_json::from_str::<serde_json::Value>(payload).ok())
                    .is_some_and(|value| value["observedFailure"]["closeAcknowledged"] == true);
                if close_acknowledged {
                    self.reasons.push(ReviewReason::BreakCloseAcknowledged);
                }
                self.payload.text().is_some_and(|payload| {
                    // Recognize bare timestamps without inventing a default location.
                    DateTime::parse_from_rfc3339(payload).is_ok()
                        || serde_json::from_str::<serde_json::Value>(payload)
                            .ok()
                            .is_some_and(|value| {
                                value["breakStartTime"]
                                    .as_str()
                                    .is_some_and(|time| DateTime::parse_from_rfc3339(time).is_ok())
                                    && value["workLocationType"].as_str().is_some_and(|location| {
                                        matches!(location, "office" | "home" | "remote" | "other")
                                    })
                            })
                })
            }
            None => false,
        };
        let valid_timestamp = matches!(self.timestamp, StoredValue::Integer(value) if DateTime::from_timestamp(value, 0).is_some());
        let valid_created_at = matches!(self.created_at, StoredValue::Integer(value) if DateTime::from_timestamp(value, 0).is_some());
        if !valid_payload
            || !valid_timestamp
            || !valid_created_at
            || !matches!(self.retry_count, StoredValue::Integer(value) if value >= 0)
        {
            self.reasons.push(ReviewReason::MalformedRecord);
        }
        if matches!(self.retry_count, StoredValue::Integer(value) if value >= 5) {
            self.reasons.push(ReviewReason::RetriesExhausted);
        }
    }
}

pub struct OfflineQueue {
    conn: Connection,
}

/// Device-storage diagnostics only. No event values or presumed tenant owner.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySummary {
    pub total: usize,
    pub malformed: usize,
    pub exhausted: usize,
    /// Two-request breaks whose close or resume may have committed. They are
    /// never replayed as close then resume, nor assumed uncommitted (#281).
    pub possible_partial_breaks: usize,
    /// Of those, breaks whose close the server acknowledged before the failure.
    pub breaks_with_acknowledged_close: usize,
}

impl OfflineQueue {
    pub fn new(app_data_dir: &Path) -> Result<Self> {
        let conn = Connection::open(app_data_dir.join("offline_queue.db"))?;
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

    pub fn enqueue(
        &mut self,
        action_type: ActionType,
        timestamp: i64,
        payload: Option<String>,
    ) -> Result<i64> {
        let transaction = self.conn.transaction()?;
        let changed = transaction.execute(
            "INSERT INTO queue (action_type, timestamp, payload, created_at) VALUES (?, ?, ?, ?)",
            params![
                serde_json::to_string(&action_type)?,
                timestamp,
                payload,
                Utc::now().timestamp()
            ],
        )?;
        anyhow::ensure!(changed == 1, "Recovery record was not saved");
        let id = transaction.last_insert_rowid();
        // Acceptance includes the actual commit, not only a successful INSERT.
        transaction.commit()?;
        Ok(id)
    }

    pub fn get_pending(&self) -> Result<Vec<QueuedAction>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, action_type, timestamp, payload, retry_count, created_at
             FROM queue ORDER BY created_at ASC, id ASC",
        )?;
        let mut rows = stmt.query([])?;
        let mut actions = Vec::new();
        while let Some(row) = rows.next()? {
            let mut action = QueuedAction {
                id: row.get(0)?,
                action_type: StoredValue::from_sql(row.get_ref(1)?),
                timestamp: StoredValue::from_sql(row.get_ref(2)?),
                payload: StoredValue::from_sql(row.get_ref(3)?),
                retry_count: StoredValue::from_sql(row.get_ref(4)?),
                created_at: StoredValue::from_sql(row.get_ref(5)?),
                reasons: Vec::new(),
            };
            action.classify();
            actions.push(action);
        }
        Ok(actions)
    }

    pub fn count(&self) -> Result<i64> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM queue", [], |row| row.get(0))?)
    }

    pub fn recovery_summary(&self) -> Result<RecoverySummary> {
        let records = self.get_pending()?;
        Ok(RecoverySummary {
            total: records.len(),
            malformed: records
                .iter()
                .filter(|record| record.reasons.contains(&ReviewReason::MalformedRecord))
                .count(),
            exhausted: records
                .iter()
                .filter(|record| record.reasons.contains(&ReviewReason::RetriesExhausted))
                .count(),
            possible_partial_breaks: records
                .iter()
                .filter(|record| {
                    record
                        .reasons
                        .contains(&ReviewReason::BreakMayBePartiallyCommitted)
                })
                .count(),
            breaks_with_acknowledged_close: records
                .iter()
                .filter(|record| {
                    record
                        .reasons
                        .contains(&ReviewReason::BreakCloseAcknowledged)
                })
                .count(),
        })
    }
}
