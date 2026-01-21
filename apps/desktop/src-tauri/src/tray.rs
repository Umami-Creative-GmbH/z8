use anyhow::Result;
use tauri::{
    include_image,
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
