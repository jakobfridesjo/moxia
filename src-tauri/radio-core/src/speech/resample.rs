//! Brings decoded audio, at whatever rate and channels, to 16 kHz mono scaled
//! as 16-bit integers, as the speech models take it.

use super::fbank::RATE;

/// Low-pass taps: enough to keep what folds back past 8 kHz from muddying speech.
const TAPS: usize = 63;
/// Where the low-pass starts to cut, under half of 16 kHz.
const CUTOFF_HZ: f64 = 7_400.0;

pub struct Resampler {
    rate: u32,
    filter: Vec<f32>,
    /// The last `TAPS` mono samples, for the filter to run on over chunks.
    history: Vec<f32>,
    /// Where the next output sample falls, in filtered samples from the last one of the chunk before.
    position: f64,
}

impl Resampler {
    pub fn new(rate: u32) -> Self {
        Self {
            rate,
            filter: low_pass(rate),
            history: vec![0.0; TAPS],
            position: 0.0,
        }
    }

    pub fn rate(&self) -> u32 {
        self.rate
    }

    /// Appends `interleaved`'s audio, at 16 kHz, to `out`.
    pub fn push(&mut self, interleaved: &[f32], channels: usize, out: &mut Vec<f32>) {
        let scale = 32_768.0 / channels as f32;
        let mut filtered = std::mem::take(&mut self.history);
        let kept = filtered.len();
        filtered.extend(
            interleaved
                .chunks_exact(channels)
                .map(|frame| frame.iter().sum::<f32>() * scale),
        );
        let smooth: Vec<f32> = filtered
            .windows(TAPS)
            .map(|window| window.iter().zip(&self.filter).map(|(x, h)| x * h).sum())
            .collect();
        let step = f64::from(self.rate) / RATE as f64;
        while self.position + 1.0 < smooth.len() as f64 {
            let index = self.position as usize;
            let fraction = (self.position - index as f64) as f32;
            out.push(smooth[index] * (1.0 - fraction) + smooth[index + 1] * fraction);
            self.position += step;
        }
        self.position -= (filtered.len() - kept) as f64;
        self.history = filtered.split_off(filtered.len() - TAPS);
    }
}

/// A windowed-sinc low-pass at `rate` that keeps speech and drops what 16 kHz cannot hold.
fn low_pass(rate: u32) -> Vec<f32> {
    let cutoff = CUTOFF_HZ.min(f64::from(rate) / 2.0) / f64::from(rate);
    let middle = (TAPS - 1) as f64 / 2.0;
    let taps: Vec<f64> = (0..TAPS)
        .map(|i| {
            let x = i as f64 - middle;
            let sinc = if x == 0.0 {
                2.0 * cutoff
            } else {
                (2.0 * std::f64::consts::PI * cutoff * x).sin() / (std::f64::consts::PI * x)
            };
            let phase = 2.0 * std::f64::consts::PI * i as f64 / (TAPS - 1) as f64;
            let blackman = 0.42 - 0.5 * phase.cos() + 0.08 * (2.0 * phase).cos();
            sinc * blackman
        })
        .collect();
    let sum: f64 = taps.iter().sum();
    taps.into_iter().map(|tap| (tap / sum) as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resampled(rate: u32, channels: usize, seconds: f32, chunks: usize) -> Vec<f32> {
        let frames = (rate as f32 * seconds) as usize;
        let audio = vec![0.25; frames * channels];
        let mut resampler = Resampler::new(rate);
        let mut out = Vec::new();
        for chunk in audio.chunks(audio.len() / chunks) {
            resampler.push(chunk, channels, &mut out);
        }
        out
    }

    #[test]
    fn makes_16_khz_from_any_rate() {
        for rate in [16_000, 22_050, 44_100, 48_000] {
            let out = resampled(rate, 2, 1.0, 10);
            assert!(out.len().abs_diff(RATE) < 70, "{rate}: {}", out.len());
        }
    }

    #[test]
    fn keeps_the_level_across_chunks_and_channels() {
        let out = resampled(44_100, 2, 1.0, 7);
        // Past the filter's start-up, a constant 0.25 per channel is 0.25 of full scale.
        for sample in &out[100..] {
            assert!((sample - 8_192.0).abs() < 10.0, "{sample}");
        }
    }
}
