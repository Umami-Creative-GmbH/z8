use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
pub const DEFAULT_WEBAPP_URL: &str = "https://ui.z8-time.app";
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub webapp_url: String,
    pub always_on_top: bool,
    pub auto_startup: bool,
    pub idle_enabled: bool,
    pub idle_threshold_minutes: u64,
    pub language: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            webapp_url: DEFAULT_WEBAPP_URL.into(),
            always_on_top: false,
            auto_startup: false,
            idle_enabled: false,
            idle_threshold_minutes: 10,
            language: "auto".into(),
        }
    }
}
impl Settings {
    pub fn load(directory: &Path) -> Result<Self> {
        let path = directory.join("settings.json");
        if path.exists() {
            Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
        } else {
            Ok(Self::default())
        }
    }
    pub fn save(&self, directory: &Path) -> Result<()> {
        ensure!(
            (1..=240).contains(&self.idle_threshold_minutes),
            "Idle reminders must be between 1 and 240 minutes."
        );
        ensure!(
            matches!(self.language.as_str(), "auto" | "de" | "en"),
            "Choose German, English or your Z8 preference."
        );
        let temporary = directory.join("settings.json.tmp");
        fs::write(&temporary, serde_json::to_string_pretty(self)?)?;
        fs::rename(temporary, directory.join("settings.json"))?;
        Ok(())
    }
}
