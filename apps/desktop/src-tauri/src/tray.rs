use anyhow::Result;
use tauri::{
    include_image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager,
};

struct TrayLabels {
    show: MenuItem<tauri::Wry>,
    settings: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
    locale: parking_lot::RwLock<String>,
}

/// Apply the saved explicit preference, or the employee locale learned from Z8.
pub fn update_language(app: &AppHandle) -> Result<()> {
    let Some(labels) = app.try_state::<TrayLabels>() else {
        return Ok(());
    };
    let state = app.state::<std::sync::Arc<crate::state::AppState>>();
    let preference = state.settings.read().language.clone();
    let german =
        preference == "de" || (preference == "auto" && labels.locale.read().starts_with("de"));
    labels.show.set_text(if german {
        "Fenster anzeigen"
    } else {
        "Show Window"
    })?;
    labels
        .settings
        .set_text(if german { "Einstellungen" } else { "Settings" })?;
    labels
        .quit
        .set_text(if german { "Beenden" } else { "Quit" })?;
    Ok(())
}

pub fn set_employee_locale(app: &AppHandle, locale: &str) -> Result<()> {
    if let Some(labels) = app.try_state::<TrayLabels>() {
        *labels.locale.write() = locale.to_owned();
    }
    update_language(app)
}

/// Sets up the system tray icon and menu
pub fn setup_tray(app: &App) -> Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &settings, &quit])?;

    let tray = TrayIconBuilder::new()
        .icon(include_image!("icons/tray-gray.png"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                // Show main window on left click
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                // Emit settings event to frontend
                let _ = app.emit("open_settings", ());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    // Store tray in state for later updates
    app.manage(tray);
    app.manage(TrayLabels {
        show,
        settings,
        quit,
        locale: parking_lot::RwLock::new(String::new()),
    });
    update_language(app.handle())?;

    log::info!("System tray initialized");
    Ok(())
}

/// Updates the tray icon based on clock status
pub fn update_tray_icon(app_handle: &AppHandle, is_clocked_in: bool) -> Result<()> {
    // Use compile-time embedded icons
    let icon = if is_clocked_in {
        include_image!("icons/tray-green.png")
    } else {
        include_image!("icons/tray-gray.png")
    };

    // Get the tray icon from app state
    if let Some(tray) = app_handle.try_state::<tauri::tray::TrayIcon>() {
        tray.set_icon(Some(icon))?;
        log::debug!("Tray icon updated: clocked_in={}", is_clocked_in);
    }

    Ok(())
}
