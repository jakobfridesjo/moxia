//! What kind of sound plays: FireRedVAD's audio event detector says, frame by
//! frame, how sure it is of speech, singing and music. Each of its layers
//! looks 20 frames ahead, so streamed it answers 160 frames (1.6 s) behind,
//! well inside the audio held back before it plays.

use std::collections::VecDeque;
use std::path::Path;

use anyhow::Result;
use serde::Serialize;
use tract_onnx::prelude::tract_ndarray::{Array2, Axis, concatenate, s};

use super::dfsmn::{Block, Dfsmn, LOOKAHEAD, MEMORY};
use super::fbank::Frame;

/// What plays, as the figures in the painting take it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Sound {
    Quiet,
    Talk,
    TalkOverMusic,
    Singing,
    Music,
}

/// The detector's outputs, in its order.
const SPEECH: usize = 0;
const SINGING: usize = 1;
const MUSIC: usize = 2;
/// FireRedVAD's own thresholds and smoothing for each output.
const THRESHOLDS: [f32; 3] = [0.4, 0.5, 0.5];
const SMOOTHING: usize = 5;
/// Frames a new sound must hold before it is taken: a second, or two for
/// quiet, so a pause in talk is not taken for its end.
const HOLD: usize = 100;
const QUIET_HOLD: usize = 200;

pub struct SoundModel(Dfsmn);

impl SoundModel {
    /// Reads `aed.pth.tar` and `cmvn.ark` from `dir`.
    pub fn load(dir: &Path) -> Result<Self> {
        Dfsmn::load(&dir.join("aed.pth.tar"), &dir.join("cmvn.ark"), true).map(Self)
    }
}

/// One block's frames not yet answered for, kept until the frames after them arrive.
struct Layer {
    /// The last `MEMORY - 1` projections answered for, oldest first.
    history: Array2<f32>,
    /// Projections waiting on the frames after them.
    projected: Array2<f32>,
    /// What came into the block for each waiting projection, added back after its memory.
    inputs: Array2<f32>,
}

impl Layer {
    fn new(channels: usize) -> Self {
        Self {
            history: Array2::zeros((MEMORY - 1, channels)),
            projected: Array2::zeros((0, channels)),
            inputs: Array2::zeros((0, channels)),
        }
    }

    /// The block's output for every frame whose lookahead has now arrived,
    /// given what comes into it next and its projections; `skip` adds the
    /// input back, as every block but the first does.
    fn advance(
        &mut self,
        block: &Block,
        input: Array2<f32>,
        projected: Array2<f32>,
        skip: bool,
    ) -> Array2<f32> {
        // Each pair shares its columns, so joining them cannot fail.
        self.projected =
            concatenate(Axis(0), &[self.projected.view(), projected.view()]).unwrap_or_default();
        if skip {
            self.inputs =
                concatenate(Axis(0), &[self.inputs.view(), input.view()]).unwrap_or_default();
        }
        let ready = self.projected.nrows().saturating_sub(LOOKAHEAD);
        if ready == 0 {
            return Array2::zeros((0, self.projected.ncols()));
        }
        let all =
            concatenate(Axis(0), &[self.history.view(), self.projected.view()]).unwrap_or_default();
        let mut out = self.projected.slice(s![..ready, ..]).to_owned();
        for (k, weights) in block.back.outer_iter().enumerate() {
            out += &(&all.slice(s![k..k + ready, ..]) * &weights);
        }
        if let Some(ahead) = &block.ahead {
            for (k, weights) in ahead.outer_iter().enumerate() {
                out += &(&self.projected.slice(s![1 + k..1 + k + ready, ..]) * &weights);
            }
        }
        if skip {
            out += &self.inputs.slice(s![..ready, ..]);
            self.inputs = self.inputs.slice(s![ready.., ..]).to_owned();
        }
        self.history = all.slice(s![ready..ready + MEMORY - 1, ..]).to_owned();
        self.projected = self.projected.slice(s![ready.., ..]).to_owned();
        out
    }
}

/// The detector run over a stream, and what it settles on.
pub struct SoundStream {
    layers: Vec<Layer>,
    judge: Judge,
}

impl SoundStream {
    pub fn new(model: &SoundModel) -> Self {
        let channels = model.0.channels();
        Self {
            layers: (0..=model.0.blocks.len())
                .map(|_| Layer::new(channels))
                .collect(),
            judge: Judge::default(),
        }
    }

    /// Changes in what plays that `frames`, following those before, settle:
    /// each with the frame it began on, counting from the stream's first.
    pub fn push(&mut self, model: &SoundModel, frames: &[Frame]) -> Vec<(usize, Sound)> {
        if frames.is_empty() {
            return Vec::new();
        }
        let probabilities = self.probabilities(&model.0, frames);
        probabilities
            .outer_iter()
            .filter_map(|row| self.judge.push([row[SPEECH], row[SINGING], row[MUSIC]]))
            .collect()
    }

    /// Speech, singing and music, frames by outputs, for every frame now answered for.
    fn probabilities(&mut self, model: &Dfsmn, frames: &[Frame]) -> Array2<f32> {
        let x = model.normalized(frames);
        let projected = model.first.project(&x);
        let (first, rest) = self.layers.split_at_mut(1);
        let mut memory = first[0].advance(&model.first, x, projected, false);
        for (block, layer) in model.blocks.iter().zip(rest) {
            let projected = block.project(&memory);
            memory = layer.advance(block, memory, projected, true);
        }
        model.probabilities(&memory)
    }
}

/// Smooths the detector's outputs as FireRedVAD does, and takes a new sound
/// once it has held.
#[derive(Default)]
struct Judge {
    window: VecDeque<[f32; 3]>,
    frame: usize,
    heard: Option<Sound>,
    /// A sound other than the one heard, and the frame it began on.
    coming: Option<(Sound, usize)>,
}

impl Judge {
    fn push(&mut self, probabilities: [f32; 3]) -> Option<(usize, Sound)> {
        let frame = self.frame;
        self.frame += 1;
        if self.window.len() == SMOOTHING {
            self.window.pop_front();
        }
        self.window.push_back(probabilities);
        let on = |output: usize| {
            let sum: f32 = self.window.iter().map(|p| p[output]).sum();
            sum / self.window.len() as f32 >= THRESHOLDS[output]
        };
        let now = match (on(SPEECH), on(SINGING), on(MUSIC)) {
            (_, true, _) => Sound::Singing,
            (true, _, true) => Sound::TalkOverMusic,
            (true, _, false) => Sound::Talk,
            (false, _, true) => Sound::Music,
            (false, _, false) => Sound::Quiet,
        };
        if self.heard == Some(now) {
            self.coming = None;
            return None;
        }
        let since = match self.coming {
            Some((coming, since)) if coming == now => since,
            _ => {
                self.coming = Some((now, frame));
                frame
            }
        };
        let hold = if now == Sound::Quiet {
            QUIET_HOLD
        } else {
            HOLD
        };
        if frame + 1 - since < hold {
            return None;
        }
        self.heard = Some(now);
        self.coming = None;
        Some((since, now))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::speech::dfsmn::tests::made_up;
    use crate::speech::fbank::MELS;

    /// The detector over all of `x` at once, as FireRedVAD runs it: frames
    /// past either end count as zero.
    fn whole(model: &Dfsmn, x: &Array2<f32>) -> Array2<f32> {
        let memory_of = |block: &Block, projected: &Array2<f32>| {
            let frames = projected.nrows() as isize;
            let at = |t: isize| {
                (0..frames)
                    .contains(&t)
                    .then(|| projected.row(t as usize).to_owned())
            };
            let mut out = projected.clone();
            for t in 0..frames {
                let mut row = out.row_mut(t as usize);
                for (k, weights) in block.back.outer_iter().enumerate() {
                    if let Some(before) = at(t - (MEMORY as isize - 1) + k as isize) {
                        row += &(&before * &weights);
                    }
                }
                if let Some(ahead) = &block.ahead {
                    for (k, weights) in ahead.outer_iter().enumerate() {
                        if let Some(after) = at(t + 1 + k as isize) {
                            row += &(&after * &weights);
                        }
                    }
                }
            }
            out
        };
        let mut memory = memory_of(&model.first, &model.first.project(x));
        for block in &model.blocks {
            memory = memory_of(block, &block.project(&memory)) + &memory;
        }
        model.probabilities(&memory)
    }

    #[test]
    fn streams_what_the_whole_recording_gives_a_lookahead_behind() {
        let model = made_up(8, 3, true);
        let frames: Vec<Frame> = (0..400)
            .map(|t| std::array::from_fn(|bin| ((t * 7 + bin * 3) % 11) as f32 / 11.0 - 0.5))
            .collect();
        let expected = whole(&model, &model.normalized(&frames));

        let mut stream = SoundStream {
            layers: (0..=model.blocks.len()).map(|_| Layer::new(8)).collect(),
            judge: Judge::default(),
        };
        let mut streamed = Vec::new();
        for chunk in frames.chunks(37) {
            let answered = stream.probabilities(&model, chunk);
            streamed.extend(answered.outer_iter().map(|row| row.to_vec()));
        }
        let behind = LOOKAHEAD * (model.blocks.len() + 1);
        assert_eq!(streamed.len(), frames.len() - behind);
        for (t, row) in streamed.iter().enumerate() {
            for (output, value) in row.iter().enumerate() {
                let want = expected[[t, output]];
                assert!((value - want).abs() < 1e-4, "frame {t}: {value} ≠ {want}");
            }
        }
        assert_eq!(MELS, frames[0].len());
    }

    fn judged(pattern: &[([f32; 3], usize)]) -> Vec<(usize, Sound)> {
        let mut judge = Judge::default();
        pattern
            .iter()
            .flat_map(|&(p, count)| std::iter::repeat_n(p, count))
            .filter_map(|p| judge.push(p))
            .collect()
    }

    const TALK: [f32; 3] = [0.9, 0.0, 0.1];
    const MUSIC_ONLY: [f32; 3] = [0.1, 0.1, 0.9];
    const SONG: [f32; 3] = [0.8, 0.9, 0.9];
    const NOTHING: [f32; 3] = [0.0, 0.0, 0.0];

    #[test]
    fn takes_a_sound_once_it_holds_dated_back_to_its_start() {
        assert_eq!(
            judged(&[(MUSIC_ONLY, 150), (SONG, 300), (TALK, 50)]),
            // Smoothing over five frames moves each edge by a couple of frames.
            [(0, Sound::Music), (152, Sound::Singing)]
        );
    }

    #[test]
    fn rides_over_pauses_in_talk() {
        assert_eq!(
            judged(&[(TALK, 200), (NOTHING, 150), (TALK, 200), (NOTHING, 250)]),
            [(0, Sound::Talk), (552, Sound::Quiet)]
        );
    }

    #[test]
    fn tells_talk_over_music() {
        assert_eq!(
            judged(&[([0.9, 0.1, 0.8], 120)]),
            [(0, Sound::TalkOverMusic)]
        );
    }
}
