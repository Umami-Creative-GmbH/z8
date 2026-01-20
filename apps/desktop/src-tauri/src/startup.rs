#[cfg(target_os = "windows")]
use anyhow::Result;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

const APP_NAME: &str = "Z8Timer";

/// Enables auto-startup on Windows by adding a registry entry
#[cfg(target_os = "windows")]
pub fn enable_auto_startup(app_path: &str) -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_SET_VALUE,
    )?;

    run_key.set_value(APP_NAME, &app_path)?;
    log::info!("Auto-startup enabled: {}", app_path);
    Ok(())
}

/// Disables auto-startup on Windows by removing the registry entry
#[cfg(target_os = "windows")]
pub fn disable_auto_startup() -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_SET_VALUE,
    )?;

    match run_key.delete_value(APP_NAME) {
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

/// Checks if auto-startup is currently enabled
#[cfg(target_os = "windows")]
pub fn is_auto_startup_enabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(run_key) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run") {
        run_key.get_value::<String, _>(APP_NAME).is_ok()
    } else {
        false
    }
}

// Non-Windows stubs
#[cfg(not(target_os = "windows"))]
pub fn enable_auto_startup(_app_path: &str) -> anyhow::Result<()> {
    log::warn!("Auto-startup is only supported on Windows");
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn disable_auto_startup() -> anyhow::Result<()> {
    log::warn!("Auto-startup is only supported on Windows");
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn is_auto_startup_enabled() -> bool {
    false
}
