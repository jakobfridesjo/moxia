//! FireRedVAD's streaming voice activity detector, run frame by frame, and
//! its rules for where speech starts and ends.

use std::path::Path;

use anyhow::Result;
use tract_onnx::prelude::tract_ndarray::{Array2, Axis, concatenate, s};

use super::dfsmn::{BLOCKS, Block, Dfsmn, MEMORY};
use super::fbank::Frame;

pub struct VadModel(Dfsmn);

impl VadModel {
    /// Reads `model.pth.tar` and `cmvn.ark` from `dir`.
    pub fn load(dir: &Path) -> Result<Self> {
        Dfsmn::load(&dir.join("model.pth.tar"), &dir.join("cmvn.ark"), false).map(Self)
    }
}

/// How sure the model is that each frame is speech, a frame at a time.
pub struct VadStream {
    /// Each block's last `MEMORY - 1` projections, oldest first.
    history: Vec<Array2<f32>>,
}

impl VadStream {
    pub fn new(model: &VadModel) -> Self {
        Self {
            history: vec![Array2::zeros((MEMORY - 1, model.0.channels())); BLOCKS + 1],
        }
    }

    /// The speech probability of each of `frames`, which follow those before.
    pub fn push(&mut self, model: &VadModel, frames: &[Frame]) -> Vec<f32> {
        if frames.is_empty() {
            return Vec::new();
        }
        let model = &model.0;
        let x = model.normalized(frames);
        let mut memory = remember(&model.first, &mut self.history[0], model.first.project(&x));
        for (block, history) in model.blocks.iter().zip(&mut self.history[1..]) {
            let projected = block.project(&memory);
            memory = remember(block, history, projected) + &memory;
        }
        model.probabilities(&memory).column(0).to_vec()
    }
}

/// `projected` plus what the block's memory makes of it and the frames before.
fn remember(block: &Block, history: &mut Array2<f32>, projected: Array2<f32>) -> Array2<f32> {
    let frames = projected.nrows();
    // The views share one shape, so joining them cannot fail.
    let all = concatenate(Axis(0), &[history.view(), projected.view()]).unwrap_or_default();
    let mut out = projected;
    for (k, weights) in block.back.outer_iter().enumerate() {
        out += &(&all.slice(s![k..k + frames, ..]) * &weights);
    }
    *history = all.slice(s![frames.., ..]).to_owned();
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Silence,
    MaybeSpeech,
    Speech,
    MaybeSilence,
}

/// Frames, from 0, that a stretch of speech runs over, both ends included.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Speech {
    pub first: usize,
    pub last: usize,
}

/// FireRedVAD's rules for turning probabilities into stretches of speech:
/// smoothed over 5 frames, speech from 0.5 once it holds for 8 frames (with 5
/// frames before it kept), until 20 frames fall under, or cut at `max_frames`.
pub struct Segmenter {
    max_frames: usize,
    window: std::collections::VecDeque<f32>,
    frame: usize,
    state: State,
    speech_count: usize,
    silence_count: usize,
    started: Option<usize>,
    last_end: Option<usize>,
}

const SMOOTHING: usize = 5;
const THRESHOLD: f32 = 0.5;
const PAD_START: usize = 5;
const MIN_SPEECH: usize = 8;
const MIN_SILENCE: usize = 20;

impl Segmenter {
    pub fn new(max_frames: usize) -> Self {
        Self {
            max_frames,
            window: std::collections::VecDeque::with_capacity(SMOOTHING),
            frame: 0,
            state: State::Silence,
            speech_count: 0,
            silence_count: 0,
            started: None,
            last_end: None,
        }
    }

    /// Where the speech under way began, if any.
    pub fn started(&self) -> Option<usize> {
        self.started
    }

    /// The next frame's probability; a stretch of speech when it ends there.
    pub fn push(&mut self, probability: f32) -> Option<Speech> {
        let frame = self.frame;
        self.frame += 1;
        if self.window.len() == SMOOTHING {
            self.window.pop_front();
        }
        self.window.push_back(probability);
        let smoothed = self.window.iter().sum::<f32>() / self.window.len() as f32;
        let speech = smoothed >= THRESHOLD;
        if self.started.is_none() && matches!(self.state, State::Speech | State::MaybeSilence) {
            // The last stretch was cut at its longest; the next starts here.
            self.started = Some(frame);
        }
        match self.state {
            State::Silence if speech => {
                self.state = State::MaybeSpeech;
                self.speech_count = 1;
            }
            State::Silence => self.speech_count = 0,
            State::MaybeSpeech if speech => {
                self.speech_count += 1;
                if self.speech_count >= MIN_SPEECH {
                    self.state = State::Speech;
                    let start = (frame + 1).saturating_sub(self.speech_count + PAD_START);
                    let after_last = self.last_end.map_or(0, |end| end + 1);
                    self.started = Some(start.max(after_last));
                    self.silence_count = 0;
                }
            }
            State::MaybeSpeech => {
                self.state = State::Silence;
                self.speech_count = 0;
            }
            State::Speech | State::MaybeSilence => {
                self.speech_count += 1;
                if speech {
                    self.state = State::Speech;
                    self.silence_count = 0;
                    if self.speech_count >= self.max_frames {
                        self.speech_count = 0;
                        return self.end(frame);
                    }
                } else {
                    self.state = State::MaybeSilence;
                    self.silence_count += 1;
                    if self.silence_count >= MIN_SILENCE {
                        self.state = State::Silence;
                        self.speech_count = 0;
                        return self.end(frame);
                    }
                }
            }
        }
        None
    }

    fn end(&mut self, frame: usize) -> Option<Speech> {
        self.last_end = Some(frame);
        self.started
            .take()
            .map(|first| Speech { first, last: frame })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stretches(probabilities: impl IntoIterator<Item = f32>, max_frames: usize) -> Vec<Speech> {
        let mut segmenter = Segmenter::new(max_frames);
        probabilities
            .into_iter()
            .filter_map(|p| segmenter.push(p))
            .collect()
    }

    fn run(pattern: &[(f32, usize)]) -> Vec<f32> {
        pattern
            .iter()
            .flat_map(|&(p, count)| std::iter::repeat_n(p, count))
            .collect()
    }

    #[test]
    fn finds_speech_between_silences_with_its_lead_in() {
        let found = stretches(run(&[(0.0, 50), (1.0, 100), (0.0, 50)]), 1000);
        // Smoothing over five frames moves both edges by a couple of frames.
        assert_eq!(found.len(), 1);
        let Speech { first, last } = found[0];
        assert!((45..=48).contains(&first), "{first}");
        assert!((170..=172).contains(&last), "{last}");
    }

    #[test]
    fn ignores_clicks_and_bridges_short_pauses() {
        let found = stretches(
            run(&[
                (0.0, 50),
                (1.0, 4),
                (0.0, 50),
                (1.0, 60),
                (0.0, 10),
                (1.0, 60),
                (0.0, 50),
            ]),
            1000,
        );
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn cuts_long_speech_and_carries_on() {
        let found = stretches(run(&[(0.0, 20), (1.0, 250), (0.0, 40)]), 100);
        assert_eq!(found.len(), 3, "{found:?}");
        assert_eq!(found[1].first, found[0].last + 1);
        assert_eq!(found[2].first, found[1].last + 1);
    }
}
