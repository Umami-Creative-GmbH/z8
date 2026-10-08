#[cfg(target_os = "windows")]
use anyhow::Result;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

pub fn registry_key(app: &tauri::AppHandle) -> String {
    if app.config().identifier == "com.z8.timer" {
        "Z8Timer".into()
    } else {
        format!("Z8Timer-{}", app.config().identifier)
    }
}

/// Enables auto-startup on Windows by adding a registry entry
#[cfg(target_os = "windows")]
pub fn enable_auto_startup(app_path: &str, registry_key: &str) -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_SET_VALUE,
    )?;

    run_key.set_value(registry_key, &format!("\"{}\"", app_path))?;
    log::info!("Auto-startup enabled: {}", app_path);
    Ok(())
}

/// Disables auto-startup on Windows by removing the registry entry
#[cfg(target_os = "windows")]
pub fn disable_auto_startup(registry_key: &str) -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_SET_VALUE,
    )?;

    match run_key.delete_value(registry_key) {
        Ok(_) => log::info!("Auto-startup disabled"),
        Err(e) => {
            // Ignore if the key doesn't exist
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(e.into());
            }
        }
    }
    Ok(())
}

// Non-Windows stubs
#[cfg(not(target_os = "windows"))]
pub fn enable_auto_startup(_app_path: &str, _registry_key: &str) -> anyhow::Result<()> {
    log::warn!("Auto-startup is only supported on Windows");
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn disable_auto_startup(_registry_key: &str) -> anyhow::Result<()> {
    log::warn!("Auto-startup is only supported on Windows");
    Ok(())
}
