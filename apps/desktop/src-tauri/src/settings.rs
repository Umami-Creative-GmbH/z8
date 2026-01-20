use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub webapp_url: String,
    pub always_on_top: bool,
    pub auto_startup: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            webapp_url: String::new(),
            always_on_top: true,
            auto_startup: false,
        }
    }
}

impl Settings {
    pub fn load(app_data_dir: &Path) -> Result<Self> {
        let settings_path = app_data_dir.join("settings.json");

        if settings_path.exists() {
            let contents = fs::read_to_string(&settings_path)?;
            let settings: Settings = serde_json::from_str(&contents)?;
            Ok(settings)
        } else {
            Ok(Settings::default())
        }
    }

    pub fn save(&self, app_data_dir: &Path) -> Result<()> {
        let settings_path = app_data_dir.join("settings.json");
        let contents = serde_json::to_string_pretty(self)?;
        fs::write(&settings_path, contents)?;
        Ok(())
    }
}
