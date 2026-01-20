use anyhow::Result;
use parking_lot::{Mutex, RwLock};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::offline::OfflineQueue;
use crate::settings::Settings;

pub struct AppState {
    pub app_handle: AppHandle,
    pub session_token: RwLock<Option<String>>,
    pub settings: RwLock<Settings>,
    pub offline_queue: Mutex<OfflineQueue>, // Mutex for SQLite thread safety
    pub is_clocked_in: RwLock<bool>,
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
            settings: RwLock::new(settings),
            offline_queue: Mutex::new(queue),
            is_clocked_in: RwLock::new(false),
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

    pub fn get_webapp_url(&self) -> String {
        self.settings.read().webapp_url.clone()
    }

    pub fn set_clocked_in(&self, clocked_in: bool) {
        *self.is_clocked_in.write() = clocked_in;
    }

    pub fn is_clocked_in(&self) -> bool {
        *self.is_clocked_in.read()
    }
}
