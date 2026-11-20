//! Times live subtitles on a recording: how long the models take to load, and
//! how fast the audio is transcribed against how long it plays.
//!
//! cargo run --profile profiling -p radio-core --example subtitles -- <models dir> <tape>

use std::fs::File;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use radio_core::speech::{Speech, Subtitler};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// As the player hands the subtitler audio: about a tenth of a second at a time.
const CHUNK_SECONDS: f64 = 0.1;

struct Audio {
    samples: Vec<f32>,
    channels: u16,
    rate: u32,
}

/// Prints the core's own log, which times each step of loading the models.
struct Stderr;

impl log::Log for Stderr {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.target().starts_with("radio_core")
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            eprintln!("{:<5} {}", record.level(), record.args());
        }
    }

    fn flush(&self) {}
}

fn main() -> Result<()> {
    log::set_logger(&Stderr).map_err(|error| anyhow::anyhow!("{error}"))?;
    log::set_max_level(log::LevelFilter::Debug);
    let mut args = std::env::args().skip(1).map(PathBuf::from);
    let (Some(models), Some(tape)) = (args.next(), args.next()) else {
        bail!("usage: subtitles <models dir> <tape>");
    };

    let audio = decode(&tape)?;
    let seconds = audio.samples.len() as f64 / f64::from(audio.channels) / f64::from(audio.rate);

    let loading = Instant::now();
    let speech = Arc::new(Speech::load(&models)?);
    let load = loading.elapsed();

    let mut subtitler = Subtitler::new(speech);
    let chunk = (CHUNK_SECONDS * f64::from(audio.rate)) as usize * usize::from(audio.channels);
    let mut busy = Duration::ZERO;
    let mut slowest = Duration::ZERO;
    let mut subtitles = 0;
    for (index, samples) in audio.samples.chunks(chunk).enumerate() {
        let at = index as f64 * CHUNK_SECONDS;
        let pushing = Instant::now();
        let heard = subtitler.push(at, samples, audio.channels, audio.rate);
        let took = pushing.elapsed();
        busy += took;
        slowest = slowest.max(took);
        for sounding in heard.sounds {
            println!("{:>6.1}s          [{:?}]", sounding.at, sounding.sound);
        }
        for subtitle in heard.subtitles {
            subtitles += 1;
            let burst = subtitle
                .burst
                .map(|burst| format!(" +{burst:?}"))
                .unwrap_or_default();
            println!(
                "{:>6.1}s {:>6.1}s  {:?} {:.2}{burst}  {}",
                subtitle.start,
                subtitle.end,
                subtitle.emotion,
                subtitle.emotion_sure,
                subtitle.text
            );
        }
    }

    println!();
    println!("load            {:>8.2} s", load.as_secs_f64());
    println!("audio           {seconds:>8.2} s");
    println!("transcribing    {:>8.2} s", busy.as_secs_f64());
    println!("real-time factor{:>8.3}", busy.as_secs_f64() / seconds);
    println!("slowest chunk   {:>8.2} s", slowest.as_secs_f64());
    println!("subtitles       {subtitles:>8}");
    Ok(())
}

fn decode(path: &PathBuf) -> Result<Audio> {
    let stream = MediaSourceStream::new(Box::new(File::open(path)?), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe().probe(
        &hint,
        stream,
        FormatOptions::default(),
        MetadataOptions::default(),
    )?;
    let track = format
        .default_track(TrackType::Audio)
        .context("the file has no audio")?;
    let track_id = track.id;
    let parameters = track
        .codec_params
        .as_ref()
        .and_then(|parameters| parameters.audio())
        .context("the file has no audio")?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(parameters, &AudioDecoderOptions::default())?;

    let mut audio = Audio {
        samples: Vec::new(),
        channels: 0,
        rate: 0,
    };
    let mut packet_samples = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(symphonia::core::errors::Error::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(error) => return Err(error.into()),
        };
        if packet.track_id != track_id {
            continue;
        }
        let decoded = decoder.decode(&packet)?;
        let spec = decoded.spec();
        audio.rate = spec.rate();
        audio.channels = u16::try_from(spec.channels().count())?;
        decoded.copy_to_vec_interleaved(&mut packet_samples);
        audio.samples.extend_from_slice(&packet_samples);
    }
    if audio.channels == 0 {
        bail!("the file has no decodable audio");
    }
    Ok(audio)
}
