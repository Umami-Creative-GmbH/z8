use anyhow::Result;
use parking_lot::{Mutex, RwLock};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::break_evidence::IdleBreak;
use crate::command_store::CommandStore;
use crate::offline::OfflineQueue;
use crate::settings::Settings;

pub struct AppState {
    pub app_handle: AppHandle,
    pub session_token: RwLock<Option<String>>,
    pub pending_app_auth_verifier: RwLock<Option<String>>,
    pub settings: RwLock<Settings>,
    pub offline_queue: Mutex<OfflineQueue>, // Mutex for SQLite thread safety
    /// Frozen clock commands. An unusable store pauses clock actions; it never
    /// prevents the application from starting.
    pub command_store: Result<Mutex<CommandStore>, String>,
    pub clock_command_lock: tokio::sync::Mutex<()>,
    pub is_clocked_in: RwLock<bool>,
    /// The latest idle span awaiting the employee's answer (#281).
    pending_break: Mutex<Option<IdleBreak>>,
    app_data_dir: PathBuf,
}

const TOKEN_FILE: &str = "session_token.txt";

impl AppState {
    pub fn new(app_handle: AppHandle) -> Result<Self> {
        // Get app data directory
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));

        // Ensure directory exists
        std::fs::create_dir_all(&app_data_dir)?;

        // Load settings from file
        let settings = Settings::load(&app_data_dir)?;

        // Initialize offline queue
        let queue = OfflineQueue::new(&app_data_dir)?;
        let command_store = CommandStore::open(&app_data_dir)
            .and_then(|mut store| {
                // Committed receipts leave after 30 days; unresolved evidence never does.
                let cutoff = chrono::Utc::now().timestamp_millis() - 30 * 24 * 60 * 60 * 1000;
                store.prune_committed(cutoff)?;
                Ok(Mutex::new(store))
            })
            .map_err(|error| {
                log::error!("Clock command storage unavailable: {error}");
                error.to_string()
            });

        // Load persisted session token
        let token_path = app_data_dir.join(TOKEN_FILE);
        let session_token = if token_path.exists() {
            fs::read_to_string(&token_path).ok()
        } else {
            None
        };

        Ok(Self {
            app_handle,
            session_token: RwLock::new(session_token),
            pending_app_auth_verifier: RwLock::new(None),
            settings: RwLock::new(settings),
            offline_queue: Mutex::new(queue),
            command_store,
            clock_command_lock: tokio::sync::Mutex::new(()),
            is_clocked_in: RwLock::new(false),
            pending_break: Mutex::new(None),
            app_data_dir,
        })
    }

    pub fn set_session_token(&self, token: Option<String>) {
        *self.session_token.write() = token.clone();

        // Persist to file
        let token_path = self.app_data_dir.join(TOKEN_FILE);
        if let Some(t) = token {
            let _ = fs::write(&token_path, t);
        } else {
            let _ = fs::remove_file(&token_path);
        }
    }

    pub fn get_session_token(&self) -> Option<String> {
        self.session_token.read().clone()
    }

    pub fn set_pending_app_auth_verifier(&self, verifier: Option<String>) {
        *self.pending_app_auth_verifier.write() = verifier;
    }

    pub fn take_pending_app_auth_verifier(&self) -> Option<String> {
        self.pending_app_auth_verifier.write().take()
    }

    pub fn get_webapp_url(&self) -> String {
        self.settings.read().webapp_url.clone()
    }

    pub fn set_clocked_in(&self, clocked_in: bool) {
        *self.is_clocked_in.write() = clocked_in;
    }

    pub fn is_clocked_in(&self) -> bool {
        *self.is_clocked_in.read()
    }

    pub fn set_pending_break(&self, idle: Option<IdleBreak>) {
        *self.pending_break.lock() = idle;
    }

    /// The idle span the dialog shows, if it is still the latest one.
    pub fn pending_break(&self, id: &str) -> Option<IdleBreak> {
        self.pending_break
            .lock()
            .as_ref()
            .filter(|idle| idle.id == id)
            .cloned()
    }

    /// Forgets the idle span once it was answered.
    pub fn clear_pending_break(&self, id: &str) {
        let mut pending = self.pending_break.lock();
        if pending.as_ref().is_some_and(|idle| idle.id == id) {
            *pending = None;
        }
    }
}
