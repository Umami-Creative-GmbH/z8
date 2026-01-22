mod auth;
mod clock;
mod commands;
mod idle;
mod offline;
mod settings;
mod startup;
mod state;
mod tray;

use state::AppState;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Starting z8 Timer application");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Handle deep link URLs passed from second instance
            log::info!("Single instance callback triggered with args: {:?}", args);

            // Focus the main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Check args for z8:// URLs
            for arg in args {
                if arg.starts_with("z8://") {
                    if let Ok(url) = Url::parse(&arg) {
                        log::info!("Deep link from single-instance: {}", url);
                        if url.scheme() == "z8" {
                            if let Some(token) = url.query_pairs().find(|(k, _)| k == "token") {
                                let token_value = token.1.to_string();
                                let handle = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    if let Err(e) = auth::handle_oauth_callback(&handle, token_value).await {
                                        log::error!("OAuth callback error: {}", e);
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }))
        .setup(|app| {
            // Initialize application state
            let state = AppState::new(app.handle().clone())?;
            app.manage(Arc::new(state));

            // Setup system tray
            tray::setup_tray(app)?;

            // Register deep link protocol (required for Windows/Linux dev mode)
            #[cfg(any(windows, target_os = "linux"))]
            app.deep_link().register("z8")?;

            // Register deep link handler for OAuth callback
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                for url in urls {
                    log::info!("Deep link received: {}", url);
                    if url.scheme() == "z8" {
                        if let Some(token) = url.query_pairs().find(|(k, _)| k == "token") {
                            let token_value = token.1.to_string();
                            let handle_clone = handle.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = auth::handle_oauth_callback(&handle_clone, token_value).await {
                                    log::error!("OAuth callback error: {}", e);
                                }
                            });
                        }
                    }
                }
            });

            // Start idle monitoring
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                idle::start_idle_monitor(app_handle);
            });

            // Start offline queue processor
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                offline::start_queue_processor(app_handle).await;
            });

            log::info!("z8 Timer setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_clock_status,
            commands::clock_in,
            commands::clock_out,
            commands::clock_out_with_break,
            commands::initiate_oauth,
            commands::logout,
            commands::get_session,
            commands::get_settings,
            commands::save_settings,
            commands::set_always_on_top,
            commands::set_auto_startup,
            commands::get_pending_queue_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
