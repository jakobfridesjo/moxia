//! HTTP Live Streaming: follows a live playlist, fetching each new segment in
//! turn, and reads as the audio stream they carry.

use std::collections::VecDeque;
use std::io::{self, Read};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use url::Url;

use super::segment::{self, Codec};
use crate::error::{Error, Result};

/// A live stream starts this many segments from its end, as the HLS specification advises.
const LIVE_START: usize = 3;
/// A master playlist may point to another one, but not endlessly.
const MAX_NESTING: u8 = 3;
/// Consecutive failed playlist fetches before the stream counts as gone.
const MAX_FAILURES: u32 = 5;

#[derive(Debug, Default, PartialEq)]
struct Playlist {
    /// A master playlist's variants, in its order.
    variants: Vec<Url>,
    media_sequence: u64,
    segments: Vec<Url>,
    target_duration: Option<Duration>,
    ended: bool,
}

pub fn is_playlist(text: &str) -> bool {
    text.trim_start_matches('\u{feff}').starts_with("#EXTM3U") && text.contains("#EXT-X-")
}

fn parse(text: &str, base: &Url) -> Result<Playlist> {
    let mut playlist = Playlist::default();
    let mut variant_next = false;
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(tag) = line.strip_prefix('#') {
            let (name, value) = tag.split_once(':').unwrap_or((tag, ""));
            match name {
                "EXT-X-STREAM-INF" => variant_next = true,
                "EXT-X-MEDIA-SEQUENCE" => {
                    playlist.media_sequence = value.parse().unwrap_or_default();
                }
                "EXT-X-TARGETDURATION" => {
                    playlist.target_duration = value.parse().ok().map(Duration::from_secs);
                }
                "EXT-X-ENDLIST" => playlist.ended = true,
                "EXT-X-KEY" if !value.contains("METHOD=NONE") => {
                    return Err(Error::UnsupportedStream("Encrypted HLS"));
                }
                "EXT-X-MAP" => return Err(Error::UnsupportedStream("Fragmented MP4 HLS")),
                _ => {}
            }
        } else if let Ok(url) = base.join(line) {
            if variant_next {
                playlist.variants.push(url);
            } else {
                playlist.segments.push(url);
            }
            variant_next = false;
        }
    }
    Ok(playlist)
}

pub struct HlsReader {
    agent: ureq::Agent,
    stop: Arc<AtomicBool>,
    playlist_url: Url,
    target_duration: Duration,
    ended: bool,
    /// The sequence number of the next segment to queue.
    next_sequence: u64,
    queue: VecDeque<Url>,
    refreshed_at: Instant,
    audio: Vec<u8>,
    read: usize,
}

impl HlsReader {
    /// Starts reading the playlist `text`, fetched from `url`. Fetches the
    /// first segment at once, to tell what codec the stream is in.
    pub fn open(
        agent: ureq::Agent,
        stop: Arc<AtomicBool>,
        mut url: Url,
        mut text: String,
    ) -> Result<(Self, Codec)> {
        let mut playlist = parse(&text, &url)?;
        for _ in 0..MAX_NESTING {
            let Some(variant) = playlist.variants.first().cloned() else {
                break;
            };
            (url, text) = fetch_text(&agent, &variant)?;
            playlist = parse(&text, &url)?;
        }
        if playlist.segments.is_empty() {
            return Err(Error::Stream("the playlist lists no audio".to_owned()));
        }
        let skip = if playlist.ended {
            0
        } else {
            playlist.segments.len().saturating_sub(LIVE_START)
        };
        let mut reader = Self {
            agent,
            stop,
            playlist_url: url,
            target_duration: playlist.target_duration.unwrap_or(Duration::from_secs(6)),
            ended: playlist.ended,
            next_sequence: playlist.media_sequence + playlist.segments.len() as u64,
            queue: playlist.segments.into_iter().skip(skip).collect(),
            refreshed_at: Instant::now(),
            audio: Vec::new(),
            read: 0,
        };
        let codec = reader
            .next_segment()?
            .ok_or_else(|| Error::Stream("the playlist lists no audio".to_owned()))?;
        Ok((reader, codec))
    }

    /// Fetches the next segment into `audio`; `None` once a finished playlist runs out.
    fn next_segment(&mut self) -> Result<Option<Codec>> {
        let mut failures = 0;
        loop {
            if self.stop.load(Ordering::Relaxed) {
                return Ok(None);
            }
            if let Some(url) = self.queue.pop_front() {
                match fetch_bytes(&self.agent, &url).and_then(|bytes| segment::audio(&bytes)) {
                    Ok((codec, audio)) => {
                        self.audio = audio;
                        self.read = 0;
                        return Ok(Some(codec));
                    }
                    Err(error) => {
                        log::warn!("Skipping segment {url}: {error}");
                        continue;
                    }
                }
            }
            if self.ended {
                return Ok(None);
            }
            self.wait_for_update();
            match self.refresh() {
                Ok(()) => failures = 0,
                Err(error) => {
                    failures += 1;
                    if failures >= MAX_FAILURES {
                        return Err(error);
                    }
                    log::warn!("Could not refresh the playlist: {error}");
                }
            }
        }
    }

    /// Sleeps until half a target duration after the last refresh, as the HLS specification advises.
    fn wait_for_update(&self) {
        let due = self.refreshed_at + self.target_duration / 2;
        while Instant::now() < due && !self.stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(100));
        }
    }

    fn refresh(&mut self) -> Result<()> {
        self.refreshed_at = Instant::now();
        let (_, text) = fetch_text(&self.agent, &self.playlist_url)?;
        let playlist = parse(&text, &self.playlist_url)?;
        let first = playlist.media_sequence;
        let end = first + playlist.segments.len() as u64;
        // A restarted encoder numbers from scratch.
        if end < self.next_sequence {
            self.next_sequence = first;
        }
        let new = self.next_sequence.saturating_sub(first) as usize;
        self.queue.extend(playlist.segments.into_iter().skip(new));
        self.next_sequence = self.next_sequence.max(end);
        self.ended = playlist.ended;
        if let Some(target) = playlist.target_duration {
            self.target_duration = target;
        }
        Ok(())
    }
}

impl Read for HlsReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        while self.read == self.audio.len() {
            match self.next_segment() {
                Ok(Some(_)) => {}
                Ok(None) => return Ok(0),
                Err(error) => return Err(io::Error::other(error)),
            }
        }
        let count = buf.len().min(self.audio.len() - self.read);
        buf[..count].copy_from_slice(&self.audio[self.read..self.read + count]);
        self.read += count;
        Ok(count)
    }
}

fn fetch_bytes(agent: &ureq::Agent, url: &Url) -> Result<Vec<u8>> {
    agent
        .get(url.as_str())
        .call()
        .and_then(|mut response| {
            response
                .body_mut()
                .with_config()
                .limit(32 << 20)
                .read_to_vec()
        })
        .map_err(|error| Error::Stream(error.to_string()))
}

/// The text at `url`, and where it came from after any redirects.
fn fetch_text(agent: &ureq::Agent, url: &Url) -> Result<(Url, String)> {
    use ureq::ResponseExt;
    let mut response = agent
        .get(url.as_str())
        .call()
        .map_err(|error| Error::Stream(error.to_string()))?;
    let url = Url::parse(&response.get_uri().to_string()).unwrap_or_else(|_| url.clone());
    let text = response
        .body_mut()
        .with_config()
        .limit(1 << 20)
        .read_to_string()
        .map_err(|error| Error::Stream(error.to_string()))?;
    Ok((url, text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("https://radio.example.com/live/station/playlist.m3u8?token=1").unwrap()
    }

    #[test]
    fn reads_a_live_media_playlist() {
        let text = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:120\n#EXT-X-TARGETDURATION:8\n\
                    #EXTINF:7.04, no desc\n//cdn.example.com/a.aac\n#EXTINF:7.04,\nseg/121.ts\n";
        let playlist = parse(text, &base()).unwrap();
        assert!(is_playlist(text));
        assert_eq!(playlist.media_sequence, 120);
        assert_eq!(playlist.target_duration, Some(Duration::from_secs(8)));
        assert!(!playlist.ended);
        assert_eq!(
            playlist
                .segments
                .iter()
                .map(Url::as_str)
                .collect::<Vec<_>>(),
            [
                "https://cdn.example.com/a.aac",
                "https://radio.example.com/live/station/seg/121.ts"
            ]
        );
    }

    #[test]
    fn reads_a_master_playlists_variants() {
        let text =
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=216000,CODECS=\"mp4a.40.2\"\nchunklist.m3u8\n";
        let playlist = parse(text, &base()).unwrap();
        assert_eq!(
            playlist
                .variants
                .iter()
                .map(Url::as_str)
                .collect::<Vec<_>>(),
            ["https://radio.example.com/live/station/chunklist.m3u8"]
        );
        assert!(playlist.segments.is_empty());
    }

    #[test]
    fn refuses_what_it_cannot_play() {
        let encrypted = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\na.ts\n";
        assert!(parse(encrypted, &base()).is_err());
        let fmp4 = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\na.m4s\n";
        assert!(parse(fmp4, &base()).is_err());
        assert!(!is_playlist("#EXTM3U\nhttp://example.com/stream.mp3\n"));
    }
}
