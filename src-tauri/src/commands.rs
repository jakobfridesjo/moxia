use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use chrono::Utc;
use radio_core::catalog::Catalog;
use radio_core::favicon::Favicons;
use radio_core::models::{DownloadProgress, Model, ModelStatus, Models};
use radio_core::player::{Player, PlayerEvent};
use radio_core::radio_browser::RadioBrowser;
use radio_core::sky::{LocalWeather, Skies};
use radio_core::speech::{Reading, Script, Speech, Writing};
use radio_core::station::Station;
use radio_core::store::{Preset, Store};
use radio_core::tapes::{Tape, Tapes};
use radio_core::together::{InviteCode, RoomEvent, Together};
use radio_core::translation::Translator;
use serde::{Serialize, Serializer};
use tauri::ipc::Channel;

use crate::media::{Media, MediaAction, MediaNow};
use tauri::{AppHandle, Manager, State};

/// Reaches the frontend as the rejected `invoke` promise's message.
#[derive(Debug)]
pub struct CommandError(String);

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl From<radio_core::error::Error> for CommandError {
    fn from(error: radio_core::error::Error) -> Self {
        Self(error.to_string())
    }
}

type CommandResult<T> = Result<T, CommandError>;

pub struct AppState {
    store: Mutex<Store>,
    directory: Arc<RadioBrowser>,
    catalog: Catalog,
    pub favicons: Favicons,
    skies: Skies,
    player: Player,
    tapes: Tapes,
    models: Models,
    /// Set to cancel the download of its model.
    downloads: Mutex<HashMap<Model, Arc<AtomicBool>>>,
    /// The subtitle models while subtitles are on; held while they load.
    speech: Mutex<Option<Arc<Speech>>>,
    /// Loaded on the first translation; a failure is not kept, so a download can follow it.
    translator: Mutex<Option<Arc<Translator>>>,
    together: Together,
    pub media: Media,
}

impl AppState {
    pub fn new(
        store: Store,
        directory: RadioBrowser,
        catalog: Catalog,
        favicons: Favicons,
        player: Player,
        tapes: Tapes,
        models: Models,
    ) -> Self {
        Self {
            store: Mutex::new(store),
            directory: Arc::new(directory),
            catalog,
            favicons,
            skies: Skies::new(crate::USER_AGENT),
            player,
            tapes,
            models,
            downloads: Mutex::new(HashMap::new()),
            speech: Mutex::new(None),
            translator: Mutex::new(None),
            together: Together::default(),
            media: Media::default(),
        }
    }

    /// Drops downloads of model revisions no longer used.
    pub fn tidy_models(&self) -> radio_core::error::Result<()> {
        self.models.tidy()
    }

    fn downloads(&self) -> MutexGuard<'_, HashMap<Model, Arc<AtomicBool>>> {
        self.downloads
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn speech(&self) -> MutexGuard<'_, Option<Arc<Speech>>> {
        self.speech.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn translator(&self) -> CommandResult<Arc<Translator>> {
        let mut translator = self
            .translator
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some(loaded) = translator.as_ref() {
            return Ok(Arc::clone(loaded));
        }
        if !self.models.is_downloaded(Model::Translator) {
            return Err(CommandError(
                "The translator is not downloaded; download it in Settings".into(),
            ));
        }
        let loaded = Arc::new(Translator::load(&self.models.dir(Model::Translator))?);
        *translator = Some(Arc::clone(&loaded));
        Ok(loaded)
    }

    fn store(&self) -> CommandResult<MutexGuard<'_, Store>> {
        self.store.lock().map_err(|_| {
            CommandError("The database is unavailable after an earlier failure".into())
        })
    }
}

/// Runs `work` on a thread meant for blocking, keeping network and database
/// work off the async runtime that serves every command.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&AppState) -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<AppState>()))
        .await
        .map_err(|error| CommandError(error.to_string()))?
}

#[tauri::command]
pub async fn list_stations(app: AppHandle, refresh: bool) -> CommandResult<Arc<Vec<Station>>> {
    blocking(app, move |state| {
        Ok(state
            .catalog
            .stations(&state.directory, refresh, Utc::now())?)
    })
    .await
}

#[tauri::command]
pub async fn list_favourites(app: AppHandle) -> CommandResult<Vec<Station>> {
    blocking(app, |state| {
        let favourites = state.store()?.favourites()?;
        Ok(state.catalog.latest(favourites))
    })
    .await
}

#[tauri::command]
pub async fn set_favourite(app: AppHandle, station: Station, favourite: bool) -> CommandResult<()> {
    blocking(app, move |state| {
        Ok(state
            .store()?
            .set_favourite(&station, favourite, Utc::now())?)
    })
    .await
}

/// By key; keys with nothing stored are left out.
#[tauri::command]
pub async fn list_presets(app: AppHandle) -> CommandResult<Vec<Preset>> {
    blocking(app, |state| {
        let presets = state.store()?.presets()?;
        let (keys, stations): (Vec<u8>, Vec<Station>) = presets
            .into_iter()
            .map(|preset| (preset.key, preset.station))
            .unzip();
        Ok(keys
            .into_iter()
            .zip(state.catalog.latest(stations))
            .map(|(key, station)| Preset { key, station })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn set_preset(app: AppHandle, station: Station, key: u8) -> CommandResult<()> {
    blocking(app, move |state| {
        Ok(state.store()?.set_preset(&station, key, Utc::now())?)
    })
    .await
}

#[tauri::command]
pub async fn list_recent(app: AppHandle) -> CommandResult<Vec<Station>> {
    blocking(app, |state| {
        let recent = state.store()?.recent()?;
        Ok(state.catalog.latest(recent))
    })
    .await
}

/// The favicon as a `data:` URL; `None` for one that cannot be shown.
#[tauri::command]
pub async fn get_favicon(app: AppHandle, url: String) -> CommandResult<Option<String>> {
    blocking(app, move |state| Ok(state.favicons.data_url(&url)?)).await
}

/// Starts `station` and returns; how it goes arrives through `on_event`.
#[tauri::command]
pub async fn play(
    app: AppHandle,
    station: Station,
    volume: f32,
    on_event: Channel<PlayerEvent>,
) -> CommandResult<()> {
    blocking(app, move |state| {
        state.player.play(&station, volume, move |event| {
            let _ = on_event.send(event);
        })?;
        state.store()?.record_play(&station, Utc::now())?;
        let directory = Arc::clone(&state.directory);
        std::thread::spawn(move || {
            if let Err(error) = directory.count_click(&station.id) {
                log::info!("Could not count the play: {error}");
            }
        });
        Ok(())
    })
    .await
}

/// Sends the buttons pressed on the system's media controls, and media keys, to `on_action`.
#[tauri::command]
pub fn watch_media(state: State<'_, AppState>, on_action: Channel<MediaAction>) {
    state.media.watch(on_action);
}

/// Shows what plays on the system's media controls.
#[tauri::command]
pub fn show_media(state: State<'_, AppState>, now: MediaNow) {
    #[cfg(any(desktop, target_os = "android"))]
    state.media.show(&now);
    #[cfg(target_os = "ios")]
    let _ = now;
}

/// The weather now at a station's place, as its painting shows it.
#[tauri::command]
pub async fn local_weather(
    app: AppHandle,
    latitude: f64,
    longitude: f64,
) -> CommandResult<LocalWeather> {
    blocking(app, move |state| {
        Ok(state.skies.weather(latitude, longitude)?)
    })
    .await
}

#[tauri::command]
pub fn stop(state: State<'_, AppState>) {
    state.player.stop();
}

#[tauri::command]
pub fn set_volume(state: State<'_, AppState>, volume: f32) {
    state.player.set_volume(volume);
}

/// Copies the station on air to a new tape until `stop_recording`, a stop or another play.
#[tauri::command]
pub async fn start_recording(app: AppHandle) -> CommandResult<()> {
    blocking(app, |state| {
        Ok(state.player.start_recording(&state.tapes, Utc::now())?)
    })
    .await
}

/// The finished tape; `None` when nothing was recorded.
#[tauri::command]
pub async fn stop_recording(app: AppHandle) -> CommandResult<Option<Tape>> {
    blocking(app, |state| Ok(state.player.stop_recording()?)).await
}

/// Newest first.
#[tauri::command]
pub async fn list_tapes(app: AppHandle) -> CommandResult<Vec<Tape>> {
    blocking(app, |state| Ok(state.tapes.list()?)).await
}

#[tauri::command]
pub async fn delete_tape(app: AppHandle, id: String) -> CommandResult<()> {
    blocking(app, move |state| Ok(state.tapes.delete(&id)?)).await
}

/// Plays tape `id` from `from` seconds, returning where it really starts;
/// how it goes arrives through `on_event`.
#[tauri::command]
pub async fn play_tape(
    app: AppHandle,
    id: String,
    from: f64,
    volume: f32,
    on_event: Channel<PlayerEvent>,
) -> CommandResult<f64> {
    blocking(app, move |state| {
        let tape = state.tapes.get(&id)?;
        Ok(state.player.play_tape(
            &state.tapes.audio_path(&tape),
            tape.codec,
            from,
            volume,
            move |event| {
                let _ = on_event.send(event);
            },
        )?)
    })
    .await
}

#[tauri::command]
pub async fn list_models(app: AppHandle) -> CommandResult<Vec<ModelStatus>> {
    blocking(app, |state| Ok(state.models.statuses())).await
}

/// Downloads what `model` still lacks, reporting progress. Resolves to false
/// when `cancel_model_download` stopped it.
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model: Model,
    on_progress: Channel<DownloadProgress>,
) -> CommandResult<bool> {
    blocking(app, move |state| {
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut downloads = state.downloads();
            if downloads.contains_key(&model) {
                return Err(CommandError("This model is already downloading".into()));
            }
            downloads.insert(model, Arc::clone(&cancelled));
        }
        let result = state.models.download(model, &cancelled, |progress| {
            let _ = on_progress.send(progress);
        });
        state.downloads().remove(&model);
        Ok(result?)
    })
    .await
}

#[tauri::command]
pub fn cancel_model_download(state: State<'_, AppState>, model: Model) {
    if let Some(cancelled) = state.downloads().get(&model) {
        cancelled.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub async fn delete_model(app: AppHandle, model: Model) -> CommandResult<()> {
    blocking(app, move |state| {
        if state.downloads().contains_key(&model) {
            return Err(CommandError("This model is still downloading".into()));
        }
        match model {
            Model::Subtitles => {
                *state.speech() = None;
                state.player.set_speech(None);
            }
            Model::Translator => {
                *state
                    .translator
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner) = None;
            }
        }
        Ok(state.models.delete(model)?)
    })
    .await
}

/// Turns live subtitles on, loading their models the first time, which takes
/// several seconds, or off, freeing them, and writes them in `script`. Either
/// applies from the next moment of whatever plays; with subtitles on, a play
/// holds back more audio before it starts, so speech is transcribed before it
/// is heard.
#[tauri::command]
pub async fn set_subtitles(
    app: AppHandle,
    enabled: bool,
    script: Script,
    reading: Reading,
) -> CommandResult<()> {
    blocking(app, move |state| {
        state.player.set_writing(Writing { script, reading });
        let mut speech = state.speech();
        if enabled && speech.is_none() {
            if !state.models.is_downloaded(Model::Subtitles) {
                return Err(CommandError(
                    "Subtitles are not downloaded; download them in Settings".into(),
                ));
            }
            let loaded = Speech::load(&state.models.dir(Model::Subtitles)).map_err(|error| {
                CommandError(format!("Could not load the subtitle models: {error:#}"))
            })?;
            *speech = Some(Arc::new(loaded));
        } else if !enabled {
            *speech = None;
        }
        state.player.set_speech(speech.clone());
        Ok(())
    })
    .await
}

/// Chinese text, a sentence or a few, in English. The translator loads on the first call.
#[tauri::command]
pub async fn translate(app: AppHandle, text: String) -> CommandResult<String> {
    blocking(app, move |state| {
        Ok(state.translator()?.translate(&text)?)
    })
    .await
}

/// Opens a room to listen together in as `name`, leaving any other; what happens in it arrives
/// through `on_event`. Returns the invite.
#[tauri::command]
pub async fn open_room(
    state: State<'_, AppState>,
    name: String,
    on_event: Channel<RoomEvent>,
) -> CommandResult<InviteCode> {
    Ok(state
        .together
        .open(&name, move |event| {
            let _ = on_event.send(event);
        })
        .await?)
}

/// Joins the room `invite` leads to as `name`, leaving any other; what happens in it arrives
/// through `on_event`. Returns an invite to pass on.
#[tauri::command]
pub async fn join_room(
    state: State<'_, AppState>,
    invite: String,
    name: String,
    on_event: Channel<RoomEvent>,
) -> CommandResult<InviteCode> {
    Ok(state
        .together
        .join(&invite, &name, move |event| {
            let _ = on_event.send(event);
        })
        .await?)
}

#[tauri::command]
pub async fn say_to_room(state: State<'_, AppState>, text: String) -> CommandResult<()> {
    Ok(state.together.say(&text).await?)
}

/// Tells the room this listener changed to `station`, so everyone follows.
#[tauri::command]
pub async fn tune_room(state: State<'_, AppState>, station: Station) -> CommandResult<()> {
    Ok(state.together.tune(station).await?)
}

#[tauri::command]
pub async fn leave_room(state: State<'_, AppState>) -> CommandResult<()> {
    state.together.leave().await;
    Ok(())
}
