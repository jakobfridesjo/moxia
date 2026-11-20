//! Finds the MP3 or ADTS AAC frames in a recording, to time it and to seek
//! in it. A recording starts wherever the stream was when REC was pressed,
//! so a frame only counts when the next one follows right after it.

use std::io::{self, Read};

use super::segment::Codec;

/// No ADTS or MP3 frame is longer.
const MAX_FRAME: usize = 1 << 13;
const READ_SIZE: usize = 1 << 16;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    /// Where it starts in the file, in bytes.
    pub offset: u64,
    /// When it starts, in seconds.
    pub start: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Header {
    length: usize,
    samples: u32,
    rate: u32,
}

/// The playing time of everything in `reader`, in seconds.
pub fn duration(reader: impl Read, codec: Codec) -> io::Result<f64> {
    let mut end = 0.0;
    each(reader, codec, |frame| {
        end = frame.start + frame.duration;
        true
    })?;
    Ok(end)
}

/// The frame playing at `seconds`, or the last one when `seconds` is past
/// the end; `None` when there are no frames.
pub fn at(reader: impl Read, codec: Codec, seconds: f64) -> io::Result<Option<Frame>> {
    let mut found = None;
    each(reader, codec, |frame| {
        found = Some(frame);
        frame.start + frame.duration <= seconds
    })?;
    Ok(found)
}

/// Calls `visit` with each frame in order, while it returns true.
fn each(
    mut reader: impl Read,
    codec: Codec,
    mut visit: impl FnMut(Frame) -> bool,
) -> io::Result<()> {
    let header = |bytes: &[u8]| match codec {
        Codec::Aac => adts_header(bytes),
        Codec::Mp3 => mp3_header(bytes),
    };
    let mut buffer = Vec::with_capacity(READ_SIZE + 2 * MAX_FRAME);
    // The file offset of `buffer[0]`.
    let mut base = 0_u64;
    let mut at = 0;
    let mut ended = false;
    let mut start = 0.0;
    loop {
        if !ended && buffer.len() - at < 2 * MAX_FRAME {
            buffer.drain(..at);
            base += at as u64;
            at = 0;
            let filled = buffer.len();
            buffer.resize(filled + READ_SIZE, 0);
            let read = read_fully(&mut reader, &mut buffer[filled..])?;
            buffer.truncate(filled + read);
            ended = read == 0;
        }
        let Some(found) = buffer.get(at..).and_then(header) else {
            if at >= buffer.len() && ended {
                return Ok(());
            }
            at += 1;
            continue;
        };
        let next = at + found.length;
        let followed = match buffer.get(next..) {
            Some([]) => ended,
            Some(rest) => header(rest).is_some_and(|h| h.rate == found.rate),
            None => false,
        };
        if !followed {
            at += 1;
            continue;
        }
        let duration = f64::from(found.samples) / f64::from(found.rate);
        let frame = Frame {
            offset: base + at as u64,
            start,
            duration,
        };
        if !visit(frame) {
            return Ok(());
        }
        start += duration;
        at = next;
    }
}

fn read_fully(reader: &mut impl Read, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

const ADTS_RATES: [u32; 13] = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

fn adts_header(bytes: &[u8]) -> Option<Header> {
    let &[b0, b1, b2, b3, b4, b5, b6, ..] = bytes else {
        return None;
    };
    if b0 != 0xFF || b1 & 0xF6 != 0xF0 {
        return None;
    }
    let rate = *ADTS_RATES.get(usize::from((b2 >> 2) & 0x0F))?;
    let length = usize::from(b3 & 0x03) << 11 | usize::from(b4) << 3 | usize::from(b5 >> 5);
    let blocks = u32::from(b6 & 0x03) + 1;
    (length >= 7).then_some(Header {
        length,
        samples: 1024 * blocks,
        rate,
    })
}

/// In kbit/s, by MPEG version 1 layer I, II and III.
const MPEG1_BITRATES: [[u16; 15]; 3] = [
    [
        0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448,
    ],
    [
        0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384,
    ],
    [
        0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
    ],
];
/// In kbit/s, by MPEG version 2 and 2.5 layer I, and layers II and III.
const MPEG2_BITRATES: [[u16; 15]; 2] = [
    [
        0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256,
    ],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
];
const MPEG1_RATES: [u32; 3] = [44100, 48000, 32000];

fn mp3_header(bytes: &[u8]) -> Option<Header> {
    let &[b0, b1, b2, ..] = bytes else {
        return None;
    };
    if b0 != 0xFF || b1 & 0xE0 != 0xE0 {
        return None;
    }
    // 0 is MPEG 2.5, 2 is MPEG 2, 3 is MPEG 1; 1 is reserved.
    let version = (b1 >> 3) & 0x03;
    // 1 is layer III, 2 is layer II, 3 is layer I; 0 is reserved.
    let layer = (b1 >> 1) & 0x03;
    let bitrate_index = usize::from(b2 >> 4);
    let rate_index = usize::from((b2 >> 2) & 0x03);
    if version == 1 || layer == 0 || bitrate_index == 0 || bitrate_index == 15 {
        return None;
    }
    let rate = match version {
        3 => *MPEG1_RATES.get(rate_index)?,
        2 => MPEG1_RATES.get(rate_index)? / 2,
        _ => MPEG1_RATES.get(rate_index)? / 4,
    };
    let bitrate = u32::from(if version == 3 {
        MPEG1_BITRATES[usize::from(3 - layer)][bitrate_index]
    } else {
        MPEG2_BITRATES[usize::from(layer != 3)][bitrate_index]
    }) * 1000;
    let padding = u32::from((b2 >> 1) & 0x01);
    let (samples, length) = match layer {
        3 => (384, (12 * bitrate / rate + padding) * 4),
        2 => (1152, 144 * bitrate / rate + padding),
        _ if version == 3 => (1152, 144 * bitrate / rate + padding),
        _ => (576, 72 * bitrate / rate + padding),
    };
    Some(Header {
        length: usize::try_from(length).ok()?,
        samples,
        rate,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// An ADTS frame of `length` bytes at 44.1 kHz.
    pub fn adts_frame(length: usize) -> Vec<u8> {
        let mut frame = vec![0; length];
        frame[..7].copy_from_slice(&[
            0xFF,
            0xF1,
            0x50,
            0x80 | (length >> 11) as u8,
            (length >> 3) as u8,
            ((length & 0x07) << 5) as u8 | 0x1F,
            0xFC,
        ]);
        frame
    }

    /// An MPEG-1 layer III frame at 128 kbit/s and 44.1 kHz: 417 bytes.
    pub fn mp3_frame() -> Vec<u8> {
        let mut frame = vec![0; 417];
        frame[..4].copy_from_slice(&[0xFF, 0xFB, 0x90, 0x00]);
        frame
    }

    #[test]
    fn reads_adts_and_mp3_headers() {
        assert_eq!(
            adts_header(&adts_frame(300)),
            Some(Header {
                length: 300,
                samples: 1024,
                rate: 44100
            })
        );
        assert_eq!(
            mp3_header(&mp3_frame()),
            Some(Header {
                length: 417,
                samples: 1152,
                rate: 44100
            })
        );
        // MPEG-2 layer III, 64 kbit/s, 22.05 kHz.
        assert_eq!(
            mp3_header(&[0xFF, 0xF3, 0x80, 0x00]),
            Some(Header {
                length: 208,
                samples: 576,
                rate: 22050
            })
        );
        assert_eq!(mp3_header(&[0xFF, 0xFB, 0xF0, 0x00]), None);
    }

    #[test]
    fn times_a_recording_that_starts_mid_frame() {
        let mut bytes = adts_frame(300)[120..].to_vec();
        for _ in 0..431 {
            bytes.extend(adts_frame(300));
        }
        bytes.extend(&adts_frame(300)[..50]);
        let seconds = duration(bytes.as_slice(), Codec::Aac).unwrap();
        assert!((seconds - 431.0 * 1024.0 / 44100.0).abs() < 1e-9);
    }

    #[test]
    fn finds_the_frame_playing_at_a_time() {
        let mut bytes = vec![0x12, 0xFF];
        for _ in 0..200 {
            bytes.extend(mp3_frame());
        }
        let frame_seconds = 1152.0 / 44100.0;
        let frame = at(bytes.as_slice(), Codec::Mp3, 3.0).unwrap().unwrap();
        assert_eq!(frame.offset, 2 + 114 * 417);
        assert!(frame.start <= 3.0 && 3.0 < frame.start + frame_seconds);

        let last = at(bytes.as_slice(), Codec::Mp3, 999.0).unwrap().unwrap();
        assert_eq!(last.offset, 2 + 199 * 417);
        assert_eq!(at(&b"no audio"[..], Codec::Mp3, 0.0).unwrap(), None);
    }

    #[test]
    fn reads_past_the_buffer() {
        let mut bytes = Vec::new();
        for _ in 0..1000 {
            bytes.extend(adts_frame(700));
        }
        let seconds = duration(bytes.as_slice(), Codec::Aac).unwrap();
        assert!((seconds - 1000.0 * 1024.0 / 44100.0).abs() < 1e-9);
    }
}
