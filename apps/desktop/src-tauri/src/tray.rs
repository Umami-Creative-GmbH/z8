use anyhow::Result;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager,
};

/// Sets up the system tray icon and menu
pub fn setup_tray(app: &App) -> Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &settings, &quit])?;

    let tray = TrayIconBuilder::new()
        .icon(Image::from_path("icons/tray-gray.png").unwrap_or_else(|_| {
            // Fallback to default icon if custom one doesn't exist
            app.default_window_icon().cloned().unwrap()
        }))
        .menu(&menu)
        .menu_on_left_click(false)
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

    log::info!("System tray initialized");
    Ok(())
}

/// Updates the tray icon based on clock status
pub fn update_tray_icon(app_handle: &AppHandle, is_clocked_in: bool) -> Result<()> {
    let icon_path = if is_clocked_in {
        "icons/tray-green.png"
    } else {
        "icons/tray-gray.png"
    };

    // Try to load the icon, falling back to default if not found
    let icon = match Image::from_path(icon_path) {
        Ok(img) => img,
        Err(_) => {
            log::warn!("Tray icon not found: {}, using default", icon_path);
            return Ok(()); // Skip icon update if file not found
        }
    };

    // Get the tray icon from app state
    if let Some(tray) = app_handle.try_state::<tauri::tray::TrayIcon>() {
        tray.set_icon(Some(icon))?;
        log::debug!("Tray icon updated: clocked_in={}", is_clocked_in);
    }

    Ok(())
}
