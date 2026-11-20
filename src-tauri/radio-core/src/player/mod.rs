//! Plays one station or tape at a time. Each play runs a session on its own
//! thread: the stream is fetched, decoded by symphonia into PCM, and queued on
//! a rodio player that the default output device drains. While a station
//! plays, its stream's bytes can be copied to a tape, and while subtitles are
//! on, the decoded audio is also transcribed, seconds ahead of the output.

pub(crate) mod frames;
mod hls;
mod meter;
mod segment;
mod source;

use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::num::NonZero;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};
use std::sync::mpsc::{SyncSender, sync_channel};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use chrono::{DateTime, Utc};

use rodio::buffer::SamplesBuffer;
use serde::Serialize;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as DecodeError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, ReadOnlySource};
use symphonia::core::meta::MetadataOptions;

use crate::error::{Error, Result};
use crate::speech::{Burst, Emotion, Sound, Sounding, Speech, Subtitle, Subtitler, Writing};
use crate::station::Station;
use crate::tapes::{Recorder, Tape, Tapes};
use meter::{Levels, Metered};
use source::Source;

pub use segment::Codec;

/// Decoded audio goes to the output in chunks of about this many per second.
const CHUNKS_PER_SECOND: usize = 10;
/// Audio, in chunks, held back before playing starts or resumes.
const START_CHUNKS: usize = 2 * CHUNKS_PER_SECOND;
/// Held back instead while subtitles are on, so a stretch of speech is
/// transcribed before it plays.
const SUBTITLED_START_CHUNKS: usize = 6 * CHUNKS_PER_SECOND;
/// Decoded chunks waiting for the subtitler at most; past this it has fallen
/// behind, and chunks are skipped.
const SUBTITLER_QUEUE: usize = 30 * CHUNKS_PER_SECOND;
/// A subtitle that comes late still shows for at least this long, in seconds.
const MIN_SUBTITLE_SECONDS: f64 = 1.0;
/// Audio, in chunks, decoded ahead at most.
const MAX_CHUNKS: usize = 10 * CHUNKS_PER_SECOND;
/// How long to wait before each try at reaching a station that dropped, in
/// seconds, about a minute in all; then it is given up.
const RECONNECT_SECONDS: [u64; 6] = [1, 2, 4, 8, 15, 30];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlayerEvent {
    Connecting,
    Playing,
    /// The stream fell behind; playing resumes on its own.
    Buffering,
    /// The station names what it is playing.
    NowPlaying {
        title: String,
    },
    /// How loud each channel peaked lately, from 0 to 1; about 20 times a second while playing.
    Level {
        left: f32,
        right: f32,
    },
    /// What is said from now on, as the output plays it.
    Subtitle {
        text: String,
        /// How long it takes to say, in seconds.
        duration: f32,
        /// When each character of `text` is said, in seconds from now.
        said: Vec<f32>,
        /// How each character of `text` is read, in pinyin or zhuyin; empty when not.
        readings: Vec<String>,
        /// How the voice sounds, and how sure the model is of it, from 0 to 1.
        emotion: Emotion,
        #[serde(rename = "emotionSure")]
        emotion_sure: f32,
        /// A laugh, applause, crying or a cough heard with the words.
        burst: Option<Burst>,
    },
    /// What plays from now on, while subtitles are on: talk, singing, music or quiet.
    Sound {
        sound: Sound,
    },
    /// The station dropped after playing; it is tried again, the `attempt`th time, until it answers or is given up.
    Reconnecting {
        attempt: u32,
    },
    /// The stream ended.
    Stopped,
    Error {
        message: String,
    },
}

type Events = Arc<dyn Fn(PlayerEvent) + Send + Sync>;
type OnTitle = Box<dyn FnMut(String) + Send>;
/// Opens what a session plays, once its output is ready.
type Open = Box<dyn FnOnce(&Arc<AtomicBool>, OnTitle) -> Result<Source> + Send>;
/// Opens it again each time it is called; `None` when there is nothing more to open (a tape plays once).
type Opens = Box<dyn FnMut() -> Option<Open> + Send>;
type Recording = Arc<Mutex<Option<Recorder>>>;
/// The subtitle models, while subtitles are on.
type SpeechSlot = Arc<Mutex<Option<Arc<Speech>>>>;
type WritingSlot = Arc<Mutex<Writing>>;
/// Decoded chunks for the subtitler, each with where it starts in the session, in seconds.
type SubtitlerQueue = SyncSender<(f64, Decoded)>;

/// What the subtitler has heard that the output has yet to play, each in order.
#[derive(Default)]
struct Due {
    subtitles: VecDeque<Subtitle>,
    sounds: VecDeque<Sounding>,
}

pub struct Player {
    agent: ureq::Agent,
    /// The volume, 0 to 1, as `f32` bits.
    volume: Arc<AtomicU32>,
    session: Mutex<Option<Session>>,
    speech: SpeechSlot,
    writing: WritingSlot,
}

struct Session {
    stop: Arc<AtomicBool>,
    output: Arc<Mutex<Option<Arc<rodio::Player>>>>,
    /// The station on air; `None` for a tape.
    station: Option<Station>,
    /// What the stream is in, once known, when it can be recorded.
    codec: Arc<Mutex<Option<Codec>>>,
    recording: Recording,
}

impl Session {
    fn stop(self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(output) = lock(&self.output).take() {
            output.stop();
        }
        finish(&self.recording);
    }
}

impl Player {
    pub fn new(user_agent: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .user_agent(user_agent)
            .timeout_connect(Some(Duration::from_secs(15)))
            .timeout_recv_response(Some(Duration::from_secs(15)))
            // A live stream never ends, but one that goes quiet this long is gone.
            .timeout_per_read(Some(Duration::from_secs(20)))
            .build()
            .into();
        Self {
            agent,
            volume: Arc::new(AtomicU32::new(1.0_f32.to_bits())),
            session: Mutex::new(None),
            speech: Arc::new(Mutex::new(None)),
            writing: Arc::new(Mutex::new(Writing::default())),
        }
    }

    /// Turns subtitles on with `speech`'s models, or off with `None`, from
    /// the next chunk of whatever plays.
    pub fn set_speech(&self, speech: Option<Arc<Speech>>) {
        *lock(&self.speech) = speech;
    }

    /// Writes subtitles transcribed from now on as `writing` asks.
    pub fn set_writing(&self, writing: Writing) {
        *lock(&self.writing) = writing;
    }

    /// Stops whatever is playing and starts `station`, reporting through
    /// `events` until the next play or stop.
    pub fn play(
        &self,
        station: &Station,
        volume: f32,
        events: impl Fn(PlayerEvent) + Send + Sync + 'static,
    ) -> Result<()> {
        let agent = self.agent.clone();
        let url = station.stream_url.clone();
        let encoding = station.country_code.legacy_encoding();
        let opens: Opens = Box::new(move || {
            let (agent, url) = (agent.clone(), url.clone());
            Some(Box::new(move |stop: &Arc<AtomicBool>, on_title| {
                source::open(&agent, stop, &url, encoding, on_title)
            }))
        });
        self.start(Some(station.clone()), volume, events, opens)
    }

    /// Stops whatever is playing and plays the tape in `path` from `from`
    /// seconds, returning where it really starts: the start of the frame
    /// playing then.
    pub fn play_tape(
        &self,
        path: &Path,
        codec: Codec,
        from: f64,
        volume: f32,
        events: impl Fn(PlayerEvent) + Send + Sync + 'static,
    ) -> Result<f64> {
        let frame = frames::at(BufReader::new(File::open(path)?), codec, from)?
            .ok_or_else(|| Error::Refused("The tape is empty".to_owned()))?;
        let mut file = File::open(path)?;
        file.seek(SeekFrom::Start(frame.offset))?;
        let open: Open = Box::new(move |_, _| {
            Ok(Source {
                reader: Box::new(BufReader::new(file)),
                extension: Some(codec.extension()),
            })
        });
        let mut once = Some(open);
        self.start(None, volume, events, Box::new(move || once.take()))?;
        Ok(frame.start)
    }

    fn start(
        &self,
        station: Option<Station>,
        volume: f32,
        events: impl Fn(PlayerEvent) + Send + Sync + 'static,
        opens: Opens,
    ) -> Result<()> {
        self.set_volume(volume);
        let session = Session {
            stop: Arc::new(AtomicBool::new(false)),
            output: Arc::new(Mutex::new(None)),
            station,
            codec: Arc::new(Mutex::new(None)),
            recording: Arc::new(Mutex::new(None)),
        };
        let stop = Arc::clone(&session.stop);
        let events: Events = Arc::new(move |event| {
            if !stop.load(Ordering::Relaxed) {
                events(event);
            }
        });
        let run = {
            let session = SessionHandles {
                stop: Arc::clone(&session.stop),
                output: Arc::clone(&session.output),
                codec: Arc::clone(&session.codec),
                recording: Arc::clone(&session.recording),
                speech: Arc::clone(&self.speech),
                writing: Arc::clone(&self.writing),
            };
            let volume = Arc::clone(&self.volume);
            move || run(opens, &session, &volume, &events)
        };
        if let Some(previous) = lock(&self.session).replace(session) {
            previous.stop();
        }
        thread::Builder::new()
            .name("stream".to_owned())
            .spawn(run)
            .map_err(|error| Error::Stream(error.to_string()))?;
        Ok(())
    }

    /// Starts copying the station on air to a new tape in `tapes`.
    pub fn start_recording(&self, tapes: &Tapes, now: DateTime<Utc>) -> Result<()> {
        let session = lock(&self.session);
        let Some(Session {
            station: Some(station),
            codec,
            recording,
            ..
        }) = session.as_ref()
        else {
            return Err(Error::Refused(
                "Only a station on air can be recorded".to_owned(),
            ));
        };
        let Some(codec) = *lock(codec) else {
            return Err(Error::Refused(
                "This station can be recorded once it plays, and only if it sends MP3 or AAC"
                    .to_owned(),
            ));
        };
        let mut recording = lock(recording);
        if recording.is_none() {
            *recording = Some(tapes.record(station, codec, now)?);
        }
        Ok(())
    }

    /// Ends the tape being recorded, if any; the station plays on. `None`
    /// when nothing was recorded.
    pub fn stop_recording(&self) -> Result<Option<Tape>> {
        let recorder = lock(&self.session)
            .as_ref()
            .and_then(|session| lock(&session.recording).take());
        recorder.map_or(Ok(None), Recorder::finish)
    }

    pub fn stop(&self) {
        if let Some(session) = lock(&self.session).take() {
            session.stop();
        }
    }

    pub fn set_volume(&self, volume: f32) {
        let volume = volume.clamp(0.0, 1.0);
        self.volume.store(volume.to_bits(), Ordering::Relaxed);
        if let Some(session) = lock(&self.session).as_ref()
            && let Some(output) = lock(&session.output).as_ref()
        {
            output.set_volume(volume);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What the session's thread shares with [`Session`].
struct SessionHandles {
    stop: Arc<AtomicBool>,
    output: Arc<Mutex<Option<Arc<rodio::Player>>>>,
    codec: Arc<Mutex<Option<Codec>>>,
    recording: Recording,
    speech: SpeechSlot,
    writing: WritingSlot,
}

fn run(mut opens: Opens, session: &SessionHandles, volume: &AtomicU32, events: &Events) {
    events(PlayerEvent::Connecting);
    let result = keep_playing(&mut opens, session, volume, events);
    finish(&session.recording);
    match result {
        Ok(()) => events(PlayerEvent::Stopped),
        Err(error) => {
            log::warn!("{error}");
            events(PlayerEvent::Error {
                message: error.to_string(),
            });
        }
    }
}

/// Plays what `opens` opens, opening it again when it drops after playing,
/// a little later each time, until it plays again or is given up. A recording
/// carries on across.
fn keep_playing(
    opens: &mut Opens,
    session: &SessionHandles,
    volume: &AtomicU32,
    events: &Events,
) -> Result<()> {
    let mut open = opens();
    let mut played_once = false;
    let mut attempt = 0;
    loop {
        let Some(this) = open.take() else {
            return Ok(());
        };
        let mut played = false;
        let result = stream(this, session, volume, events, &mut played);
        played_once |= played;
        if played {
            attempt = 0;
        }
        if session.stop.load(Ordering::Relaxed) || !played_once {
            return result;
        }
        open = opens();
        if open.is_none() {
            return result;
        }
        let Some(&wait) = RECONNECT_SECONDS.get(attempt) else {
            return Err(result
                .err()
                .unwrap_or_else(|| Error::Stream("the station stopped sending".to_owned())));
        };
        if let Err(error) = &result {
            log::warn!("{error}; trying again");
        }
        attempt += 1;
        events(PlayerEvent::Reconnecting {
            attempt: attempt as u32,
        });
        if !wait_unless_stopped(Duration::from_secs(wait), &session.stop) {
            return Ok(());
        }
    }
}

/// Waits `time`, unless `stop` is set first; whether it waited it out.
fn wait_unless_stopped(time: Duration, stop: &AtomicBool) -> bool {
    let step = Duration::from_millis(100);
    let mut waited = Duration::ZERO;
    while waited < time {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        thread::sleep(step);
        waited += step;
    }
    !stop.load(Ordering::Relaxed)
}

/// Ends the tape being recorded, if any, keeping it.
fn finish(recording: &Recording) {
    let recorder = lock(recording).take();
    if let Some(Err(error)) = recorder.map(Recorder::finish) {
        log::error!("Could not finish a tape: {error}");
    }
}

/// Plays what `open` opens until it ends or `stop` is set; `played` is set once it has played.
fn stream(
    open: Open,
    session: &SessionHandles,
    volume: &AtomicU32,
    events: &Events,
    played: &mut bool,
) -> Result<()> {
    let SessionHandles {
        stop,
        output,
        codec,
        recording,
        speech,
        writing,
    } = session;
    // The device's stream cannot move between threads, so each session opens its own.
    let mut device =
        rodio::DeviceSinkBuilder::open_default_sink().map_err(|e| Error::Output(e.to_string()))?;
    device.log_on_drop(false);
    let player = Arc::new(rodio::Player::connect_new(device.mixer()));
    player.pause();
    player.set_volume(f32::from_bits(volume.load(Ordering::Relaxed)));
    *lock(output) = Some(Arc::clone(&player));
    if stop.load(Ordering::Relaxed) {
        player.stop();
        return Ok(());
    }

    let on_title = {
        let events = Arc::clone(events);
        move |title| events(PlayerEvent::NowPlaying { title })
    };
    let on_title = {
        let recording = Arc::clone(recording);
        move |title: String| {
            if let Some(recorder) = lock(&recording).as_mut() {
                recorder.note(&title);
            }
            on_title(title);
        }
    };
    let source = open(stop, Box::new(on_title))?;
    *lock(codec) = source.extension.and_then(Codec::from_extension);
    let reader = Taped {
        inner: source.reader,
        recording: Arc::clone(recording),
    };
    let stream = MediaSourceStream::new(
        Box::new(ReadOnlySource::new(SyncReader::new(Box::new(reader)))),
        Default::default(),
    );
    let mut hint = Hint::new();
    if let Some(extension) = source.extension {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|error| Error::Stream(format!("unrecognised audio ({error})")))?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| Error::Stream("the stream has no audio".to_owned()))?;
    let track_id = track.id;
    let parameters = track
        .codec_params
        .as_ref()
        .and_then(|parameters| parameters.audio())
        .ok_or_else(|| Error::Stream("the stream has no audio".to_owned()))?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(parameters, &AudioDecoderOptions::default())
        .map_err(|error| Error::Stream(format!("unsupported codec ({error})")))?;

    let state = Arc::new(AtomicU8::new(STARTING));
    let levels = Arc::new(Levels::default());
    let mut captions = Captions::new(Arc::clone(speech), Arc::clone(writing), Arc::clone(stop));
    let start_chunks = if lock(speech).is_some() {
        SUBTITLED_START_CHUNKS
    } else {
        START_CHUNKS
    };
    let watcher = watch(&player, stop, &state, &levels, &captions.due, events);
    let mut chunk = Chunk::default();
    // Where the next chunk starts, in seconds of the session's audio.
    let mut timeline = 0.0;
    let result = loop {
        if stop.load(Ordering::Relaxed) {
            break Ok(());
        }
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break Ok(()),
            Err(DecodeError::IoError(_)) if stop.load(Ordering::Relaxed) => break Ok(()),
            // The ADTS reader ends a file this way rather than with `None`.
            Err(DecodeError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break Ok(());
            }
            Err(error) => break Err(Error::Stream(error.to_string())),
        };
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(DecodeError::DecodeError(error)) => {
                log::debug!("Skipping a damaged packet: {error}");
                continue;
            }
            Err(error) => break Err(Error::Stream(error.to_string())),
        };
        let spec = decoded.spec();
        let (Some(rate), Some(channels)) = (
            NonZero::new(spec.rate()),
            u16::try_from(spec.channels().count())
                .ok()
                .and_then(NonZero::new),
        ) else {
            continue;
        };
        if let Some(full) = chunk.add(channels, rate, |samples| {
            decoded.copy_to_vec_interleaved(samples);
        }) {
            captions.feed(timeline, &full);
            timeline += full.seconds();
            player.append(Metered::new(full.into_buffer(), Arc::clone(&levels)));
            pace(&player, stop, &state, start_chunks, events);
            *played |= state.load(Ordering::Relaxed) == PLAYING;
        }
    };
    if let Some(rest) = chunk.take() {
        captions.feed(timeline, &rest);
        player.append(Metered::new(rest.into_buffer(), levels));
    }
    if result.is_ok() {
        // Play out what is queued, unless stopped.
        if state.load(Ordering::Relaxed) != PLAYING {
            player.play();
        }
        while !player.empty() && !stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(100));
        }
    }
    state.store(DONE, Ordering::Relaxed);
    let _ = watcher.join();
    player.stop();
    result
}

const STARTING: u8 = 0;
const PLAYING: u8 = 1;
const BUFFERING: u8 = 2;
const DONE: u8 = 3;

/// Starts playing once `start_chunks` are queued, and waits while too much is.
fn pace(
    player: &rodio::Player,
    stop: &AtomicBool,
    state: &AtomicU8,
    start_chunks: usize,
    events: &Events,
) {
    if player.len() >= start_chunks
        && state
            .compare_exchange(STARTING, PLAYING, Ordering::Relaxed, Ordering::Relaxed)
            .or_else(|_| {
                state.compare_exchange(BUFFERING, PLAYING, Ordering::Relaxed, Ordering::Relaxed)
            })
            .is_ok()
    {
        player.play();
        events(PlayerEvent::Playing);
    }
    while player.len() >= MAX_CHUNKS && !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(50));
    }
}

/// Pauses the output when it runs dry, so it resumes with a buffer, and
/// reports the levels, and subtitles as their speech plays, while playing.
/// Runs apart from decoding, which may be stuck waiting for the network.
fn watch(
    player: &Arc<rodio::Player>,
    stop: &Arc<AtomicBool>,
    state: &Arc<AtomicU8>,
    levels: &Arc<Levels>,
    due: &Arc<Mutex<Due>>,
    events: &Events,
) -> thread::JoinHandle<()> {
    let (player, stop, state, levels, due, events) = (
        Arc::clone(player),
        Arc::clone(stop),
        Arc::clone(state),
        Arc::clone(levels),
        Arc::clone(due),
        Arc::clone(events),
    );
    thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) && state.load(Ordering::Relaxed) != DONE {
            if player.empty()
                && state
                    .compare_exchange(PLAYING, BUFFERING, Ordering::Relaxed, Ordering::Relaxed)
                    .is_ok()
            {
                player.pause();
                events(PlayerEvent::Buffering);
            }
            let (left, right) = levels.take();
            if state.load(Ordering::Relaxed) == PLAYING {
                events(PlayerEvent::Level { left, right });
                for event in release(&mut lock(&due), levels.played()) {
                    events(event);
                }
            }
            thread::sleep(Duration::from_millis(50));
        }
    })
}

/// Copies what it reads to the tape being recorded, if any.
struct Taped {
    inner: Box<dyn Read + Send>,
    recording: Recording,
}

impl Read for Taped {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let read = self.inner.read(buf)?;
        let mut recording = lock(&self.recording);
        if let Some(recorder) = recording.as_mut()
            && let Err(error) = recorder.write(&buf[..read])
        {
            log::error!("Recording stopped: {error}");
            if let Some(Err(error)) = recording.take().map(Recorder::finish) {
                log::error!("Could not finish a tape: {error}");
            }
        }
        Ok(read)
    }
}

/// What has started playing by `played` seconds, taken off `due`: the
/// latest change in what plays, then subtitles whose speech has started.
fn release(due: &mut Due, played: f64) -> Vec<PlayerEvent> {
    let mut released = Vec::new();
    let mut sound = None;
    while due
        .sounds
        .front()
        .is_some_and(|sounding| sounding.at <= played)
    {
        sound = due.sounds.pop_front().map(|sounding| sounding.sound);
    }
    released.extend(sound.map(|sound| PlayerEvent::Sound { sound }));
    while due
        .subtitles
        .front()
        .is_some_and(|subtitle| subtitle.start <= played)
    {
        let Some(subtitle) = due.subtitles.pop_front() else {
            break;
        };
        let left = (subtitle.end - played.max(subtitle.start)).max(MIN_SUBTITLE_SECONDS);
        released.push(PlayerEvent::Subtitle {
            text: subtitle.text,
            duration: left as f32,
            said: subtitle
                .said
                .iter()
                .map(|at| (at - played).max(0.0) as f32)
                .collect(),
            readings: subtitle.readings,
            emotion: subtitle.emotion,
            emotion_sure: subtitle.emotion_sure,
            burst: subtitle.burst,
        });
    }
    released
}

/// Hands decoded audio to a subtitler on its own thread while subtitles are
/// on, and holds what it writes until the output plays it.
struct Captions {
    speech: SpeechSlot,
    writing: WritingSlot,
    stop: Arc<AtomicBool>,
    /// The models the running subtitler uses, and its queue.
    worker: Option<(Arc<Speech>, SubtitlerQueue)>,
    due: Arc<Mutex<Due>>,
}

impl Captions {
    fn new(speech: SpeechSlot, writing: WritingSlot, stop: Arc<AtomicBool>) -> Self {
        Self {
            speech,
            writing,
            stop,
            worker: None,
            due: Arc::new(Mutex::new(Due::default())),
        }
    }

    /// Passes on the chunk starting `at` seconds into the session, starting
    /// or stopping the subtitler as subtitles were turned on or off.
    fn feed(&mut self, at: f64, chunk: &Decoded) {
        let speech = lock(&self.speech).clone();
        let current = self.worker.as_ref().map(|(models, _)| models);
        match (speech, current) {
            (None, Some(_)) => {
                // Dropping the queue ends the subtitler.
                self.worker = None;
                *lock(&self.due) = Due::default();
            }
            (Some(speech), current)
                if !current.is_some_and(|models| Arc::ptr_eq(models, &speech)) =>
            {
                self.worker = Some((Arc::clone(&speech), self.spawn(speech)));
            }
            _ => {}
        }
        if let Some((_, queue)) = &self.worker
            && queue.try_send((at, chunk.clone())).is_err()
        {
            log::debug!("Subtitles fell behind; skipping a chunk");
        }
    }

    fn spawn(&self, speech: Arc<Speech>) -> SubtitlerQueue {
        let (queue, chunks) = sync_channel::<(f64, Decoded)>(SUBTITLER_QUEUE);
        let (due, writing, stop) = (
            Arc::clone(&self.due),
            Arc::clone(&self.writing),
            Arc::clone(&self.stop),
        );
        let spawned = thread::Builder::new()
            .name("subtitles".to_owned())
            .spawn(move || {
                let mut subtitler = Subtitler::new(speech);
                for (at, chunk) in chunks {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let heard =
                        subtitler.push(at, &chunk.samples, chunk.channels.get(), chunk.rate.get());
                    let writing = *lock(&writing);
                    let mut due = lock(&due);
                    due.subtitles.extend(
                        heard
                            .subtitles
                            .into_iter()
                            .map(|subtitle| subtitle.written_in(writing)),
                    );
                    due.sounds.extend(heard.sounds);
                }
            });
        if let Err(error) = spawned {
            log::error!("Could not start subtitles: {error}");
        }
        queue
    }
}

/// A chunk of decoded audio, interleaved.
#[derive(Clone)]
struct Decoded {
    channels: NonZero<u16>,
    rate: NonZero<u32>,
    samples: Vec<f32>,
}

impl Decoded {
    fn seconds(&self) -> f64 {
        self.samples.len() as f64 / f64::from(self.channels.get()) / f64::from(self.rate.get())
    }

    fn into_buffer(self) -> SamplesBuffer {
        SamplesBuffer::new(self.channels, self.rate, self.samples)
    }
}

/// Decoded packets gathered into one buffer of about a tenth of a second.
#[derive(Default)]
struct Chunk {
    format: Option<(NonZero<u16>, NonZero<u32>)>,
    samples: Vec<f32>,
    packet: Vec<f32>,
}

impl Chunk {
    /// Adds the packet `fill` writes, returning a full chunk when there is one.
    fn add(
        &mut self,
        channels: NonZero<u16>,
        rate: NonZero<u32>,
        fill: impl FnOnce(&mut Vec<f32>),
    ) -> Option<Decoded> {
        let mut finished = None;
        if self.format.is_some_and(|format| format != (channels, rate)) {
            finished = self.take();
        }
        self.format = Some((channels, rate));
        fill(&mut self.packet);
        self.samples.extend_from_slice(&self.packet);
        let per_chunk = rate.get() as usize * usize::from(channels.get()) / CHUNKS_PER_SECOND;
        if finished.is_none() && self.samples.len() >= per_chunk {
            finished = self.take();
        }
        finished
    }

    fn take(&mut self) -> Option<Decoded> {
        let (channels, rate) = self.format?;
        if self.samples.is_empty() {
            return None;
        }
        Some(Decoded {
            channels,
            rate,
            samples: std::mem::take(&mut self.samples),
        })
    }
}

/// Gives a reader the `Sync` that symphonia asks of a source; it is only ever
/// read through `&mut`.
struct SyncReader(Mutex<Box<dyn std::io::Read + Send>>);

impl SyncReader {
    fn new(reader: Box<dyn std::io::Read + Send>) -> Self {
        Self(Mutex::new(reader))
    }
}

impl std::io::Read for SyncReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.0
            .get_mut()
            .unwrap_or_else(PoisonError::into_inner)
            .read(buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_events_with_the_frontend_field_names() {
        let json = |event| serde_json::to_value(event).unwrap();
        assert_eq!(
            json(PlayerEvent::NowPlaying {
                title: "晴天".to_owned()
            }),
            serde_json::json!({ "kind": "nowPlaying", "title": "晴天" })
        );
        assert_eq!(
            json(PlayerEvent::Connecting),
            serde_json::json!({ "kind": "connecting" })
        );
        assert_eq!(
            json(PlayerEvent::Reconnecting { attempt: 2 }),
            serde_json::json!({ "kind": "reconnecting", "attempt": 2 })
        );
        assert_eq!(
            json(PlayerEvent::Subtitle {
                text: "早晨".to_owned(),
                duration: 2.5,
                said: vec![0.0, 1.5],
                readings: vec!["zǎo".to_owned(), "chen".to_owned()],
                emotion: Emotion::Happy,
                emotion_sure: 0.5,
                burst: Some(Burst::Laughter),
            }),
            serde_json::json!({
                "kind": "subtitle", "text": "早晨", "duration": 2.5, "said": [0.0, 1.5],
                "readings": ["zǎo", "chen"],
                "emotion": "happy", "emotionSure": 0.5, "burst": "laughter"
            })
        );
        assert_eq!(
            json(PlayerEvent::Sound {
                sound: Sound::TalkOverMusic
            }),
            serde_json::json!({ "kind": "sound", "sound": "talkOverMusic" })
        );
    }

    #[test]
    fn gathers_packets_into_tenth_second_chunks() {
        let mono = NonZero::new(1).unwrap();
        let rate = NonZero::new(1000).unwrap();
        let mut chunk = Chunk::default();
        let packet = |samples: &mut Vec<f32>| {
            samples.clear();
            samples.resize(40, 0.5);
        };
        assert!(chunk.add(mono, rate, packet).is_none());
        assert!(chunk.add(mono, rate, packet).is_none());
        let full = chunk.add(mono, rate, packet).unwrap();
        assert_eq!(full.samples.len(), 120);
        assert!((full.seconds() - 0.12).abs() < 1e-9);

        chunk.add(mono, rate, packet);
        let stereo = NonZero::new(2).unwrap();
        let flushed = chunk.add(stereo, rate, packet).unwrap();
        assert_eq!(flushed.channels, mono);
        assert_eq!(chunk.take().unwrap().channels, stereo);
    }

    fn subtitle(start: f64, end: f64, text: &str) -> Subtitle {
        Subtitle {
            start,
            end,
            text: text.to_owned(),
            said: vec![start + 0.5],
            readings: Vec::new(),
            emotion: Emotion::Neutral,
            emotion_sure: 0.9,
            burst: None,
        }
    }

    fn said(text: &str, duration: f32) -> PlayerEvent {
        PlayerEvent::Subtitle {
            text: text.to_owned(),
            duration,
            said: vec![0.0],
            readings: Vec::new(),
            emotion: Emotion::Neutral,
            emotion_sure: 0.9,
            burst: None,
        }
    }

    #[test]
    fn releases_subtitles_as_their_speech_plays() {
        let mut due = Due {
            subtitles: VecDeque::from([subtitle(1.0, 3.0, "早"), subtitle(4.0, 9.0, "晚")]),
            ..Due::default()
        };
        assert!(release(&mut due, 0.9).is_empty());
        assert_eq!(release(&mut due, 1.5), [said("早", 1.5)]);
        // One that is late shows for what is left of its speech, or a second at least.
        assert_eq!(release(&mut due, 8.5), [said("晚", 1.0)]);
        assert!(due.subtitles.is_empty());
    }

    #[test]
    fn tells_only_the_latest_of_what_plays() {
        let sounding = |at, sound| Sounding { at, sound };
        let mut due = Due {
            sounds: VecDeque::from([
                sounding(0.0, Sound::Music),
                sounding(2.0, Sound::Talk),
                sounding(5.0, Sound::Quiet),
            ]),
            ..Due::default()
        };
        assert_eq!(
            release(&mut due, 3.0),
            [PlayerEvent::Sound { sound: Sound::Talk }]
        );
        assert!(release(&mut due, 4.0).is_empty());
        assert_eq!(due.sounds.len(), 1);
    }
}
