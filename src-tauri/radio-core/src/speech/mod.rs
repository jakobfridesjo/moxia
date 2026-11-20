//! Live subtitles: decoded audio, brought to 16 kHz mono, goes through
//! FireRedVAD to find where speech starts and ends; each stretch of speech is
//! transcribed by SenseVoice, which also tags how it sounds. FireRedVAD's
//! event detector says meanwhile whether talk, singing or music plays.

mod dfsmn;
mod fbank;
mod recognizer;
mod resample;
mod script;
mod sound;
mod torch;
mod vad;

use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::{Sender, channel, sync_channel};
use std::thread;

use anyhow::{Context, Result};

use fbank::{Fbank, Frame, RATE, SHIFT, Scratch, Window};
pub use recognizer::{Burst, Emotion};
use recognizer::{Recognizer, Transcript};
use resample::Resampler;
pub use script::Script;
pub use sound::Sound;
use sound::{SoundModel, SoundStream};
use vad::{Segmenter, VadModel, VadStream};

/// Speech is cut into subtitles at most this many 10 ms frames long, so each
/// is transcribed while the audio before it still plays.
const MAX_SPEECH_FRAMES: usize = 600;
/// Audio kept from before the speech under way, in frames: enough for the
/// lead-in the segmenter dates speech back by.
const KEPT_FRAMES: usize = 50;
/// How far a chunk may start from where the last one ended, in seconds,
/// before it is taken for a jump (a stall, or subtitles switched on again).
const GAP_SECONDS: f64 = 0.05;

/// The models subtitles need, loaded once. tract's GPU runtime gives
/// wrong answers when a graph runs on any thread but the one that prepared
/// it, so SenseVoice lives on a thread of its own, which every
/// transcription goes through, until this is dropped.
pub struct Speech {
    vad: VadModel,
    sound: SoundModel,
    jobs: Sender<Job>,
}

type Job = Box<dyn FnOnce(&Recognizer) + Send>;

impl Speech {
    /// Loads the models from `dir`, where `Model::Subtitles` downloads them.
    pub fn load(dir: &Path) -> Result<Self> {
        let started = std::time::Instant::now();
        let vad = VadModel::load(dir)?;
        let sound = SoundModel::load(dir)?;
        log::debug!("the VAD and AED: loaded in {:.2?}", started.elapsed());
        let (jobs, queue) = channel::<Job>();
        let (ready, loaded) = sync_channel(1);
        let dir = dir.to_owned();
        thread::Builder::new()
            .name("speech".to_owned())
            .spawn(move || match Recognizer::load(&dir) {
                Ok(recognizer) => {
                    let _ = ready.send(Ok(()));
                    for job in queue {
                        job(&recognizer);
                    }
                }
                Err(error) => {
                    let _ = ready.send(Err(error));
                }
            })?;
        loaded
            .recv()
            .context("the speech models' thread stopped")??;
        Ok(Self { vad, sound, jobs })
    }

    /// Transcribes `samples`.
    fn hear(&self, samples: Vec<f32>) -> Result<Transcript> {
        let (answer, answered) = sync_channel(1);
        let job: Job = Box::new(move |recognizer| {
            let _ = answer.send(recognizer.transcribe(&samples));
        });
        self.jobs
            .send(job)
            .ok()
            .context("the speech models' thread stopped")?;
        answered
            .recv()
            .context("the speech models' thread stopped")?
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Subtitle {
    /// Seconds into the session's audio, as the chunks given were timed.
    pub start: f64,
    pub end: f64,
    pub text: String,
    /// When each character of `text` is said, in seconds into the session.
    pub said: Vec<f64>,
    pub emotion: Emotion,
    /// How sure SenseVoice is of `emotion`, from 0 to 1.
    pub emotion_sure: f32,
    /// A laugh, applause, crying or a cough heard with the words.
    pub burst: Option<Burst>,
}

/// What plays from `at` seconds into the session on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sounding {
    pub at: f64,
    pub sound: Sound,
}

/// What a chunk of audio settles: subtitles that end in it, and changes in
/// what plays, each in the order they happen.
#[derive(Debug, Default)]
pub struct Heard {
    pub subtitles: Vec<Subtitle>,
    pub sounds: Vec<Sounding>,
}

impl Subtitle {
    /// This subtitle in `script`. Should converting change how many characters
    /// there are, each takes the time of the one at its place in the original.
    pub fn written_in(self, script: Script) -> Self {
        let text = script.write(self.text);
        let length = text.chars().count();
        let said = if length == self.said.len() {
            self.said
        } else {
            (0..length)
                .filter_map(|index| self.said.get(index * self.said.len() / length).copied())
                .collect()
        };
        Self { text, said, ..self }
    }
}

/// Turns one session's decoded audio into subtitles.
pub struct Subtitler {
    speech: Arc<Speech>,
    fbank: Fbank,
    scratch: Scratch,
    run: Option<Run>,
}

/// Unbroken audio since the first chunk or the last jump.
struct Run {
    /// Seconds into the session where its first sample falls.
    origin: f64,
    /// Seconds into the session where the next chunk should start.
    next: f64,
    resampler: Resampler,
    vad: VadStream,
    sound: SoundStream,
    segmenter: Segmenter,
    /// 16 kHz samples, `audio[0]` being sample `audio_start` of the run.
    audio: Vec<f32>,
    audio_start: usize,
    /// The next 10 ms frame the detector takes.
    frame: usize,
}

impl Subtitler {
    pub fn new(speech: Arc<Speech>) -> Self {
        let fbank = Fbank::new(Window::Povey);
        let scratch = Scratch::new(&fbank);
        Self {
            speech,
            fbank,
            scratch,
            run: None,
        }
    }

    /// Takes the decoded chunk at `at` seconds into the session, returning
    /// what it settles.
    pub fn push(&mut self, at: f64, interleaved: &[f32], channels: u16, rate: u32) -> Heard {
        let channels = usize::from(channels.max(1));
        let seconds = interleaved.len() as f64 / channels as f64 / f64::from(rate);
        let joins = self.run.as_ref().is_some_and(|run| {
            run.resampler.rate() == rate && (run.next - at).abs() <= GAP_SECONDS
        });
        if !joins {
            self.run = Some(Run {
                origin: at,
                next: at,
                resampler: Resampler::new(rate),
                vad: VadStream::new(&self.speech.vad),
                sound: SoundStream::new(&self.speech.sound),
                segmenter: Segmenter::new(MAX_SPEECH_FRAMES),
                audio: Vec::new(),
                audio_start: 0,
                frame: 0,
            });
        }
        let Some(run) = self.run.as_mut() else {
            return Heard::default();
        };
        run.next = at + seconds;
        run.resampler.push(interleaved, channels, &mut run.audio);

        let end = run.audio_start + run.audio.len();
        let mut frames: Vec<Frame> = Vec::new();
        while run.frame * SHIFT + fbank::FRAME <= end {
            let from = run.frame * SHIFT - run.audio_start;
            frames.push(
                self.fbank
                    .frame(&run.audio[from..from + fbank::FRAME], &mut self.scratch),
            );
            run.frame += 1;
        }
        let sounds = run
            .sound
            .push(&self.speech.sound, &frames)
            .into_iter()
            .map(|(frame, sound)| Sounding {
                at: run.origin + (frame * SHIFT) as f64 / RATE as f64,
                sound,
            })
            .collect();
        let probabilities = run.vad.push(&self.speech.vad, &frames);
        let stretches: Vec<_> = probabilities
            .into_iter()
            .filter_map(|probability| run.segmenter.push(probability))
            .collect();

        let mut subtitles = Vec::new();
        for speech in stretches {
            let first = speech.first * SHIFT;
            let last = speech.last * SHIFT + fbank::FRAME;
            let from = first.saturating_sub(run.audio_start);
            let to = last.saturating_sub(run.audio_start).min(run.audio.len());
            match self.speech.hear(run.audio[from..to].to_vec()) {
                Ok(transcript) if transcript.is_speech() => {
                    let start = run.origin + first as f64 / RATE as f64;
                    subtitles.push(Subtitle {
                        start,
                        end: run.origin + last as f64 / RATE as f64,
                        text: transcript.text,
                        said: transcript.said.iter().map(|at| start + at).collect(),
                        emotion: transcript.emotion,
                        emotion_sure: transcript.emotion_sure,
                        burst: Burst::of(&transcript.event),
                    });
                }
                Ok(_) => {}
                Err(error) => log::warn!("Could not transcribe speech: {error:#}"),
            }
        }

        let keep_frame = run
            .segmenter
            .started()
            .unwrap_or_else(|| run.frame.saturating_sub(KEPT_FRAMES));
        let drop = (keep_frame * SHIFT)
            .saturating_sub(run.audio_start)
            .min(run.audio.len());
        run.audio.drain(..drop);
        run.audio_start += drop;
        Heard { subtitles, sounds }
    }
}
