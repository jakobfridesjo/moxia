//! Measures how loud the audio is, and how much of it has played, as the
//! output plays it, not as it is decoded, which runs seconds ahead.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use rodio::{ChannelCount, SampleRate, Source};

/// The loudest sample per channel since the last [`Levels::take`], and how
/// long the output has played.
#[derive(Default)]
pub struct Levels {
    left: AtomicU32,
    right: AtomicU32,
    played_micros: AtomicU64,
}

impl Levels {
    /// The peaks, from 0 to 1, starting again from silence.
    pub fn take(&self) -> (f32, f32) {
        let take = |peak: &AtomicU32| f32::from_bits(peak.swap(0, Ordering::Relaxed)).min(1.0);
        (take(&self.left), take(&self.right))
    }

    /// Seconds of audio played, about every 256 samples.
    pub fn played(&self) -> f64 {
        self.played_micros.load(Ordering::Relaxed) as f64 / 1e6
    }

    fn raise(&self, left: f32, right: f32) {
        // Non-negative floats order the same as their bits.
        self.left.fetch_max(left.to_bits(), Ordering::Relaxed);
        self.right.fetch_max(right.to_bits(), Ordering::Relaxed);
    }
}

/// How many samples go by between updates of [`Levels`].
const SAMPLES_PER_UPDATE: usize = 256;

/// Passes `inner` through, keeping its peaks in `levels`.
pub struct Metered<S> {
    inner: S,
    levels: Arc<Levels>,
    channel: usize,
    peaks: [f32; 2],
    counted: usize,
}

impl<S: Source> Metered<S> {
    pub fn new(inner: S, levels: Arc<Levels>) -> Self {
        Self {
            inner,
            levels,
            channel: 0,
            peaks: [0.0; 2],
            counted: 0,
        }
    }

    fn flush(&mut self) {
        let [left, right] = self.peaks;
        let right = if self.inner.channels().get() == 1 {
            left
        } else {
            right
        };
        self.levels.raise(left, right);
        let per_second =
            u64::from(self.inner.sample_rate().get()) * u64::from(self.inner.channels().get());
        self.levels.played_micros.fetch_add(
            self.counted as u64 * 1_000_000 / per_second,
            Ordering::Relaxed,
        );
        self.peaks = [0.0; 2];
        self.counted = 0;
    }
}

impl<S: Source> Iterator for Metered<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let Some(sample) = self.inner.next() else {
            self.flush();
            return None;
        };
        let peak = &mut self.peaks[self.channel.min(1)];
        *peak = peak.max(sample.abs());
        self.channel = (self.channel + 1) % usize::from(self.inner.channels().get());
        self.counted += 1;
        if self.counted >= SAMPLES_PER_UPDATE {
            self.flush();
        }
        Some(sample)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<S: Source> Source for Metered<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }

    fn channels(&self) -> ChannelCount {
        self.inner.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;
    use std::num::NonZero;

    #[test]
    fn keeps_each_channels_peak_until_taken() {
        let levels = Arc::new(Levels::default());
        let stereo = SamplesBuffer::new(
            NonZero::new(2).unwrap(),
            NonZero::new(1000).unwrap(),
            vec![0.1, -0.8, 0.5, 0.2],
        );
        let played: Vec<f32> = Metered::new(stereo, Arc::clone(&levels)).collect();
        assert_eq!(played, [0.1, -0.8, 0.5, 0.2]);
        assert_eq!(levels.take(), (0.5, 0.8));
        assert_eq!(levels.take(), (0.0, 0.0));

        let mono = SamplesBuffer::new(
            NonZero::new(1).unwrap(),
            NonZero::new(1000).unwrap(),
            vec![0.3],
        );
        Metered::new(mono, Arc::clone(&levels)).for_each(drop);
        assert_eq!(levels.take(), (0.3, 0.3));
    }

    #[test]
    fn counts_the_time_played() {
        let levels = Arc::new(Levels::default());
        let tenth = SamplesBuffer::new(
            NonZero::new(2).unwrap(),
            NonZero::new(1000).unwrap(),
            vec![0.0; 200],
        );
        Metered::new(tenth.clone(), Arc::clone(&levels)).for_each(drop);
        Metered::new(tenth, Arc::clone(&levels)).for_each(drop);
        assert!((levels.played() - 0.2).abs() < 1e-9, "{}", levels.played());
    }
}
