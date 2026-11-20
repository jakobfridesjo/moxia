//! The system's media controls: what plays, shown on the lock screen, in the
//! notification shade or the desktop's media menu, and its buttons and the
//! keyboard's media keys handed to the frontend, which knows what "next" means.
//! On desktops this is souvlaki; on Android, `MediaSessionPlugin.kt` in the
//! app's Android project, whose service also keeps the radio playing with the
//! screen off.

use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// A button pressed on the system's media controls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaAction {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
    Stop,
}

/// What the system's media controls show.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaNow {
    /// The station, or nothing when the radio shows none.
    pub title: Option<String>,
    /// What the station says is on air.
    pub artist: Option<String>,
    pub playing: bool,
}

#[derive(Default)]
pub struct Media {
    /// Where pressed buttons go: the frontend's channel.
    listener: std::sync::Arc<Mutex<Option<Channel<MediaAction>>>>,
    #[cfg(desktop)]
    controls: Mutex<Option<souvlaki::MediaControls>>,
    #[cfg(target_os = "android")]
    plugin: std::sync::OnceLock<tauri::plugin::PluginHandle<tauri::Wry>>,
}

/// The Kotlin plugin's arguments.
#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Watch {
    on_action: Channel<MediaAction>,
}

impl Media {
    /// Starts listening to the system's media controls for the window `window`.
    #[cfg(desktop)]
    pub fn attach(&self, window: &tauri::WebviewWindow) {
        use souvlaki::{MediaControlEvent, MediaControls, PlatformConfig};

        #[cfg(target_os = "windows")]
        let hwnd = window.hwnd().ok().map(|hwnd| hwnd.0);
        #[cfg(not(target_os = "windows"))]
        let hwnd = {
            let _ = window;
            None
        };
        let config = PlatformConfig {
            display_name: "Moxia",
            dbus_name: "moxia",
            hwnd,
        };
        let mut controls = match MediaControls::new(config) {
            Ok(controls) => controls,
            Err(error) => {
                log::warn!("No system media controls: {error:?}");
                return;
            }
        };
        let listener = std::sync::Arc::clone(&self.listener);
        let attached = controls.attach(move |event| {
            let action = match event {
                MediaControlEvent::Play => MediaAction::Play,
                MediaControlEvent::Pause => MediaAction::Pause,
                MediaControlEvent::Toggle => MediaAction::Toggle,
                MediaControlEvent::Next => MediaAction::Next,
                MediaControlEvent::Previous => MediaAction::Previous,
                MediaControlEvent::Stop => MediaAction::Stop,
                _ => return,
            };
            if let Some(channel) = lock(&listener).as_ref()
                && let Err(error) = channel.send(action)
            {
                log::warn!("Could not pass on a media button: {error}");
            }
        });
        if let Err(error) = attached {
            log::warn!("Could not listen to the system media controls: {error:?}");
            return;
        }
        *lock(&self.controls) = Some(controls);
    }

    /// Hands media sessions to the app's Kotlin plugin.
    #[cfg(target_os = "android")]
    pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
        use tauri::Manager;
        tauri::plugin::Builder::new("media-session")
            .setup(|app, api| {
                let handle = api.register_android_plugin(
                    "io.github.jakobfridesjo.moxia",
                    "MediaSessionPlugin",
                )?;
                let _ = app
                    .state::<crate::commands::AppState>()
                    .media
                    .plugin
                    .set(handle);
                Ok(())
            })
            .build()
    }

    /// Sends the buttons pressed from now on to `channel`.
    pub fn watch(&self, channel: Channel<MediaAction>) {
        #[cfg(target_os = "android")]
        if let Some(plugin) = self.plugin.get()
            && let Err(error) = plugin.run_mobile_plugin::<()>(
                "watch",
                Watch {
                    on_action: channel.clone(),
                },
            )
        {
            log::warn!("Could not watch the media session: {error}");
        }
        *lock(&self.listener) = Some(channel);
    }

    /// Shows `now` on the lock screen and in the notification, playing in a foreground service.
    #[cfg(target_os = "android")]
    pub fn show(&self, now: &MediaNow) {
        if let Some(plugin) = self.plugin.get()
            && let Err(error) = plugin.run_mobile_plugin::<()>("show", now)
        {
            log::warn!("Could not update the media session: {error}");
        }
    }

    /// Shows `now` on the system's media controls.
    #[cfg(desktop)]
    pub fn show(&self, now: &MediaNow) {
        use souvlaki::{MediaMetadata, MediaPlayback};

        let mut controls = lock(&self.controls);
        let Some(controls) = controls.as_mut() else {
            return;
        };
        let playback = match (&now.title, now.playing) {
            (None, _) => MediaPlayback::Stopped,
            (Some(_), true) => MediaPlayback::Playing { progress: None },
            (Some(_), false) => MediaPlayback::Paused { progress: None },
        };
        let metadata = MediaMetadata {
            title: now.title.as_deref(),
            artist: now.artist.as_deref(),
            album: Some("Moxia"),
            ..MediaMetadata::default()
        };
        if let Err(error) = controls
            .set_metadata(metadata)
            .and_then(|()| controls.set_playback(playback))
        {
            log::warn!("Could not update the system media controls: {error:?}");
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
