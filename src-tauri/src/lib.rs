mod commands;
mod media;

use radio_core::catalog::Catalog;
use radio_core::favicon::Favicons;
use radio_core::models::Models;
use radio_core::player::Player;
use radio_core::radio_browser::RadioBrowser;
use radio_core::store::Store;
use radio_core::tapes::Tapes;
use tauri::Manager;

use crate::commands::AppState;

/// How the app introduces itself to radio-browser and to stations, as radio-browser asks.
pub(crate) const USER_AGENT: &str = concat!("Moxia/", env!("CARGO_PKG_VERSION"));

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let log_level = if cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Warn
            };
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log_level)
                    // Debug builds of wgpu hook EGL for the whole process, so WebKitGTK's
                    // failing eglSwapInterval calls would be logged every frame.
                    .level_for("wgpu_hal::gles::egl", log::LevelFilter::Off)
                    .build(),
            )?;

            #[cfg(mobile)]
            app.handle().plugin(tauri_plugin_barcode_scanner::init())?;

            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store = Store::open(&data_dir.join("radio.sqlite3"))?;
            app.manage(AppState::new(
                store,
                RadioBrowser::new(USER_AGENT),
                Catalog::new(cache_dir.join("stations.json")),
                Favicons::new(cache_dir.join("favicons"), USER_AGENT),
                Player::new(USER_AGENT),
                Tapes::new(data_dir.join("tapes")),
                Models::new(data_dir.join("models")),
            ));

            #[cfg(target_os = "android")]
            app.handle().plugin(media::Media::plugin())?;
            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                app.state::<AppState>().media.attach(&window);
            }

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<AppState>();
                if let Err(error) = state.favicons.tidy() {
                    log::error!("{error:?}");
                }
                if let Err(error) = state.tidy_models() {
                    log::error!("{error:?}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_stations,
            commands::list_favourites,
            commands::set_favourite,
            commands::list_presets,
            commands::set_preset,
            commands::list_recent,
            commands::get_favicon,
            commands::local_weather,
            commands::watch_media,
            commands::show_media,
            commands::play,
            commands::stop,
            commands::set_volume,
            commands::start_recording,
            commands::stop_recording,
            commands::list_tapes,
            commands::delete_tape,
            commands::play_tape,
            commands::list_models,
            commands::download_model,
            commands::cancel_model_download,
            commands::delete_model,
            commands::set_subtitles,
            commands::translate,
            commands::open_room,
            commands::join_room,
            commands::say_to_room,
            commands::tune_room,
            commands::leave_room,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
