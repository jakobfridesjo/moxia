//! Log-mel filterbanks as Kaldi computes them, which is what all three speech
//! models were trained on: 25 ms frames every 10 ms at 16 kHz, 80 mel bins,
//! whole frames only (`snip_edges`), no dither.

use std::sync::Arc;

use realfft::num_complex::Complex32;
use realfft::{RealFftPlanner, RealToComplex};

pub const RATE: usize = 16_000;
pub const FRAME: usize = 400;
pub const SHIFT: usize = 160;
pub const MELS: usize = 80;
const FFT: usize = 512;
const PREEMPHASIS: f32 = 0.97;
const LOW_HZ: f32 = 20.0;

#[derive(Debug, Clone, Copy)]
pub enum Window {
    /// Kaldi's default, which FireRedVAD keeps.
    Povey,
    /// What SenseVoice asks for.
    Hamming,
}

pub type Frame = [f32; MELS];

pub struct Fbank {
    window: [f32; FRAME],
    /// Each mel bin's first FFT bin and its weights from there.
    bins: Vec<(usize, Vec<f32>)>,
    fft: Arc<dyn RealToComplex<f32>>,
}

fn mel(hz: f32) -> f32 {
    1127.0 * (1.0 + hz / 700.0).ln()
}

impl Fbank {
    pub fn new(window: Window) -> Self {
        let step = 2.0 * std::f32::consts::PI / (FRAME - 1) as f32;
        let window = std::array::from_fn(|i| {
            let cosine = (step * i as f32).cos();
            match window {
                Window::Povey => (0.5 - 0.5 * cosine).powf(0.85),
                Window::Hamming => 0.54 - 0.46 * cosine,
            }
        });
        let (low, high) = (mel(LOW_HZ), mel(RATE as f32 / 2.0));
        let width = (high - low) / (MELS + 1) as f32;
        let bins = (0..MELS)
            .map(|bin| {
                let left = low + bin as f32 * width;
                let (center, right) = (left + width, left + 2.0 * width);
                let weights: Vec<(usize, f32)> = (0..FFT / 2)
                    .filter_map(|k| {
                        let at = mel(k as f32 * RATE as f32 / FFT as f32);
                        let weight = if at <= left || at >= right {
                            0.0
                        } else if at <= center {
                            (at - left) / (center - left)
                        } else {
                            (right - at) / (right - center)
                        };
                        (weight > 0.0).then_some((k, weight))
                    })
                    .collect();
                let first = weights.first().map_or(0, |&(k, _)| k);
                (first, weights.into_iter().map(|(_, w)| w).collect())
            })
            .collect();
        Self {
            window,
            bins,
            fft: RealFftPlanner::new().plan_fft_forward(FFT),
        }
    }

    /// The frames in `samples`, which are scaled as 16-bit integers.
    pub fn frames(&self, samples: &[f32]) -> Vec<Frame> {
        let count = frame_count(samples.len());
        let mut scratch = Scratch::new(self);
        (0..count)
            .map(|index| self.frame(&samples[index * SHIFT..index * SHIFT + FRAME], &mut scratch))
            .collect()
    }

    pub fn frame(&self, samples: &[f32], scratch: &mut Scratch) -> Frame {
        let mean = samples.iter().sum::<f32>() / FRAME as f32;
        let input = &mut scratch.input;
        input.fill(0.0);
        for i in (0..FRAME).rev() {
            let previous = samples[i.saturating_sub(1)] - mean;
            input[i] = (samples[i] - mean - PREEMPHASIS * previous) * self.window[i];
        }
        // The buffers come from this planner, so their sizes always fit.
        let _ = self.fft.process(input, &mut scratch.spectrum);
        let power = &scratch.spectrum;
        std::array::from_fn(|bin| {
            let (first, weights) = &self.bins[bin];
            let energy: f32 = weights
                .iter()
                .zip(&power[*first..])
                .map(|(weight, value)| weight * value.norm_sqr())
                .sum();
            energy.max(f32::EPSILON).ln()
        })
    }
}

/// Buffers for one frame at a time.
pub struct Scratch {
    input: Vec<f32>,
    spectrum: Vec<Complex32>,
}

impl Scratch {
    pub fn new(fbank: &Fbank) -> Self {
        Self {
            input: fbank.fft.make_input_vec(),
            spectrum: fbank.fft.make_output_vec(),
        }
    }
}

/// How many whole frames `samples` samples hold.
pub fn frame_count(samples: usize) -> usize {
    if samples < FRAME {
        0
    } else {
        1 + (samples - FRAME) / SHIFT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(hz: f32, seconds: f32) -> Vec<f32> {
        let count = (RATE as f32 * seconds) as usize;
        (0..count)
            .map(|i| 10_000.0 * (2.0 * std::f32::consts::PI * hz * i as f32 / RATE as f32).sin())
            .collect()
    }

    #[test]
    fn counts_only_whole_frames() {
        assert_eq!(frame_count(399), 0);
        assert_eq!(frame_count(400), 1);
        assert_eq!(frame_count(559), 1);
        assert_eq!(frame_count(560), 2);
        assert_eq!(
            Fbank::new(Window::Povey).frames(&tone(440.0, 1.0)).len(),
            98
        );
    }

    #[test]
    fn puts_a_tone_in_the_bin_around_its_pitch() {
        let fbank = Fbank::new(Window::Hamming);
        let loudest = |hz| {
            let frame = fbank.frames(&tone(hz, 0.1))[0];
            (0..MELS)
                .max_by(|&a, &b| frame[a].total_cmp(&frame[b]))
                .unwrap()
        };
        let (low, high) = (loudest(300.0), loudest(3000.0));
        assert!(low < high);
        // 300 Hz is about 400 mel of 4000 across 81 widths: the eighth bin or so.
        assert!((6..=10).contains(&low), "{low}");
    }
}
