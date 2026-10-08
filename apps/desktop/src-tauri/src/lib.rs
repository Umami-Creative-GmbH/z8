mod auth;
mod auth_flow;
mod break_evidence;
mod clock;
mod clock_command;
mod clock_journal;
mod command_store;
mod command_sync;
mod command_transport;
mod commands;
mod credentials;
mod desktop_api;
mod frozen_command;
mod idle;
mod offline;
mod settings;
mod startup;
mod state;
mod tray;
mod updates;

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Handle deep link URLs passed from second instance
            log::info!("Another instance requested focus");

            // Focus the main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Check args for z8:// URLs
            for arg in args {
                if arg.starts_with("z8://") {
                    if let Ok(url) = Url::parse(&arg) {
                        if url.scheme() == "z8" {
                            let handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = auth::handle_deep_link_callback(&handle, &url).await
                                {
                                    log::error!("OAuth callback error: {}", e);
                                }
                            });
                        }
                    }
                }
            }
        }))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    log::error!("Could not hide the clock window: {error}");
                }
            }
        })
        .setup(|app| {
            // Initialize application state
            let state = AppState::new(app.handle().clone())?;
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.set_always_on_top(state.settings.read().always_on_top) {
                    state.runtime_errors.write().push(format!(
                        "Always-on-top preference could not be restored: {error}"
                    ));
                }
            }
            let startup_enabled = state.settings.read().auto_startup;
            let startup_result = if startup_enabled {
                std::env::current_exe()
                    .map_err(anyhow::Error::from)
                    .and_then(|exe| {
                        startup::enable_auto_startup(
                            &exe.to_string_lossy(),
                            &startup::registry_key(app.handle()),
                        )
                    })
            } else {
                startup::disable_auto_startup(&startup::registry_key(app.handle()))
            };
            if let Err(error) = startup_result {
                state.runtime_errors.write().push(format!(
                    "Windows startup preference could not be restored: {error}"
                ));
            }
            app.manage(Arc::new(state));
            app.manage(updates::Updates::default());

            // Setup system tray
            tray::setup_tray(app)?;

            // Register deep link protocol (required for Windows/Linux dev mode)
            #[cfg(any(windows, target_os = "linux"))]
            if app.config().identifier == "com.z8.timer" {
                app.deep_link().register("z8")?;
            }

            // Register deep link handler for OAuth callback
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                for url in urls {
                    if url.scheme() == "z8" {
                        let handle_clone = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) =
                                auth::handle_deep_link_callback(&handle_clone, &url).await
                            {
                                log::error!("OAuth callback error: {}", e);
                            }
                        });
                    }
                }
            });

            // Start idle monitoring
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                idle::start_idle_monitor(app_handle);
            });

            // Legacy queue records lack ownership and replay evidence. Keep them
            // for review; never submit them using whichever session is current.

            // Native polling continues when the WebView is hidden or its timers
            // are throttled. It shares the same command lock and saved evidence.
            let background = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    let state = background.state::<Arc<AppState>>();
                    if state.get_session_token().is_none()
                        || state.clock_command_lock.try_lock().is_err()
                    {
                        continue;
                    }
                    let _ = commands::sync_clock_commands(background.clone(), false).await;
                    if state.get_session_token().is_some() {
                        let _ = commands::get_clock_status(background.clone()).await;
                    }
                }
            });
            log::info!("z8 Timer setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            updates::check_for_updates,
            updates::install_update,
            desktop_api::get_desktop_context,
            desktop_api::open_webapp,
            desktop_api::get_organizations,
            desktop_api::switch_organization,
            commands::get_clock_status,
            commands::clock_in,
            commands::clock_out,
            commands::start_manual_break,
            commands::end_manual_break,
            commands::clock_out_with_break,
            commands::dismiss_idle_break,
            commands::initiate_oauth,
            commands::logout,
            commands::get_session,
            commands::get_settings,
            commands::save_settings,
            commands::get_pending_queue_count,
            commands::get_queue_recovery_summary,
            commands::sync_clock_commands,
            commands::retry_clock_command,
            commands::archive_clock_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
