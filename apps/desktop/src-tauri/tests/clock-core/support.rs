//! A real device store (SQLite files in a temporary directory) and the server
//! shapes of the #275 routes.
use crate::clock::ClockService;
use crate::clock_command::{
    execute, ActionEvidence, ClockCommand, ClockCommandError, ClockCommandOutcome, ClockSession,
};
use crate::command_store::{token_fingerprint, CommandStore, StoredCommand};
use crate::command_transport::Capabilities;
use crate::offline::OfflineQueue;
use chrono::Utc;
use parking_lot::Mutex;

pub const SERVER: &str = "https://app.z8.test";
pub const EMPLOYEE: &str = "7d1f3f0e-8a4c-4a7e-9f39-0b8f1a2c3d4e";
pub const PERIOD: &str = "5c0b1a8e-2f4d-4e6a-9b3c-7d8e9f0a1b2c";
pub const TOKEN: &str = "session-a";

pub fn capabilities(organization_id: &str, submit: &str) -> String {
    serde_json::json!({
        "commandVersions": [2],
        "kinds": ["clock_in", "clock_out"],
        "submit": submit,
        "lookup": "available",
        "admission": {
            "immediate": { "pastSeconds": 300, "futureSeconds": 300 },
            "delayed": { "pastSeconds": 604800, "futureSeconds": 300 },
        },
        "context": {
            "userId": "user-1",
            "organizationId": organization_id,
            "employeeId": EMPLOYEE,
            "server": SERVER,
        },
    })
    .to_string()
}

pub fn status(clocked_in: bool) -> String {
    serde_json::json!({
        "hasEmployee": true,
        "employeeId": EMPLOYEE,
        "isClockedIn": clocked_in,
        "activeWorkPeriod": clocked_in.then(|| serde_json::json!({
            "id": PERIOD,
            "startTime": "2026-09-20T08:00:00.000Z",
        })),
    })
    .to_string()
}

/// A committed receipt as `POST /api/time-entries/commands` returns it.
pub fn receipt(disposition: &str, request: &str) -> String {
    let command: serde_json::Value =
        serde_json::from_str(crate::test_http::request_body(request)).unwrap();
    serde_json::json!({
        "outcome": disposition,
        "operationId": command["operationId"],
        "receipt": { "kind": "start_live_work", "result": { "workPeriodId": PERIOD } },
    })
    .to_string()
}

pub fn rejection(operation_id: &str, code: &str) -> String {
    serde_json::json!({ "outcome": "rejected", "operationId": operation_id, "code": code })
        .to_string()
}

pub struct Device {
    pub dir: tempfile::TempDir,
    pub service: ClockService,
    pub queue: Mutex<OfflineQueue>,
    pub store: Mutex<CommandStore>,
}

impl Device {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        Self::open(dir)
    }

    /// Reopens the same files, as after an application restart.
    pub fn open(dir: tempfile::TempDir) -> Self {
        Self {
            queue: Mutex::new(OfflineQueue::new(dir.path()).unwrap()),
            store: Mutex::new(CommandStore::open(dir.path()).unwrap()),
            service: ClockService::new(),
            dir,
        }
    }

    pub fn restart(self) -> Self {
        let Self { dir, .. } = self;
        Self::open(dir)
    }

    pub fn at<'a>(&'a self, endpoint: &'a str, token: &'a str) -> ClockSession<'a> {
        ClockSession {
            service: &self.service,
            queue: &self.queue,
            store: &self.store,
            endpoint,
            token,
        }
    }

    /// What an earlier online session left in the context cache.
    pub fn negotiated(&self, endpoint: &str, organization_id: &str, clocked_in: bool) {
        let mut store = self.store.lock();
        let session = token_fingerprint(TOKEN);
        store
            .save_capabilities(
                endpoint,
                &session,
                &capabilities(organization_id, "available"),
                1,
            )
            .unwrap();
        assert!(store
            .save_status(endpoint, &session, &status(clocked_in), 1)
            .unwrap());
    }

    pub async fn act(
        &self,
        endpoint: &str,
        command: ClockCommand,
    ) -> Result<ClockCommandOutcome, ClockCommandError> {
        execute(
            &self.at(endpoint, TOKEN),
            command,
            ActionEvidence {
                occurred_at: Utc::now(),
                timezone: Some("Europe/Berlin".into()),
            },
        )
        .await
    }

    pub fn saved(&self) -> Vec<StoredCommand> {
        let active = self.store.lock().active().unwrap();
        let mut all: Vec<StoredCommand> = active;
        let conn = rusqlite::Connection::open(self.dir.path().join("offline_queue.db")).unwrap();
        let mut statement = conn
            .prepare(
                "SELECT operation_id FROM clock_command WHERE state IN ('committed', 'archived')",
            )
            .unwrap();
        let resolved: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for operation_id in resolved {
            all.push(self.store.lock().get(&operation_id).unwrap().unwrap());
        }
        all.sort_by_key(|command| command.recovery_id);
        all
    }

    pub async fn sync(&self, endpoint: &str, organization_id: &str, submit: &str) {
        crate::command_sync::drain(
            &self.service,
            &self.store,
            endpoint,
            TOKEN,
            &Capabilities::parse(&capabilities(organization_id, submit)).unwrap(),
            crate::command_sync::Pacing::Now,
            || Utc::now().timestamp_millis(),
        )
        .await
        .unwrap();
    }
}
