//! Turns an HLS segment into the audio stream inside it: MPEG-TS is
//! demultiplexed, and the ID3 tag that starts a packed-audio segment is
//! dropped. What comes out is ADTS AAC or MP3 frames, which concatenate
//! across segments.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const PACKET: usize = 188;
const SYNC: u8 = 0x47;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Codec {
    Aac,
    Mp3,
}

impl Codec {
    /// The file extension symphonia's probe takes as a hint.
    pub fn extension(self) -> &'static str {
        match self {
            Codec::Aac => "aac",
            Codec::Mp3 => "mp3",
        }
    }

    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension {
            "aac" => Some(Codec::Aac),
            "mp3" => Some(Codec::Mp3),
            _ => None,
        }
    }
}

pub fn audio(segment: &[u8]) -> Result<(Codec, Vec<u8>)> {
    if is_transport_stream(segment) {
        return demux(segment);
    }
    let audio = strip_id3(segment);
    let codec = sniff(audio).ok_or(Error::UnsupportedStream("this HLS segment's"))?;
    Ok((codec, audio.to_vec()))
}

fn is_transport_stream(data: &[u8]) -> bool {
    data.first() == Some(&SYNC) && data.get(PACKET).is_none_or(|&byte| byte == SYNC)
}

/// Skips any ID3v2 tags at the start.
fn strip_id3(mut data: &[u8]) -> &[u8] {
    while let [b'I', b'D', b'3', _, _, flags, s0, s1, s2, s3, ..] = *data {
        let size = [s0, s1, s2, s3]
            .iter()
            .fold(0usize, |size, &byte| (size << 7) | usize::from(byte & 0x7F));
        let footer = if flags & 0x10 != 0 { 10 } else { 0 };
        data = data.get(10 + size + footer..).unwrap_or_default();
    }
    data
}

fn sniff(data: &[u8]) -> Option<Codec> {
    match *data {
        // ADTS: a 12-bit sync word, then MPEG version and layer 0.
        [0xFF, second, ..] if second & 0xF6 == 0xF0 => Some(Codec::Aac),
        // MPEG audio: an 11-bit sync word and a layer other than reserved.
        [0xFF, second, ..] if second & 0xE0 == 0xE0 && second & 0x06 != 0 => Some(Codec::Mp3),
        _ => None,
    }
}

/// The payload of the first AAC or MP3 stream of the first program.
fn demux(data: &[u8]) -> Result<(Codec, Vec<u8>)> {
    let mut pmt_pid = None;
    let mut audio: Option<(u16, Codec)> = None;
    let mut out = Vec::with_capacity(data.len());
    for packet in data.as_chunks::<PACKET>().0 {
        if packet[0] != SYNC {
            continue;
        }
        let unit_start = packet[1] & 0x40 != 0;
        let pid = u16::from(packet[1] & 0x1F) << 8 | u16::from(packet[2]);
        let control = (packet[3] >> 4) & 0x03;
        let mut start = 4;
        if control & 0x02 != 0 {
            start += 1 + usize::from(packet[4]);
        }
        if control & 0x01 == 0 || start >= PACKET {
            continue;
        }
        let payload = &packet[start..];
        if pid == 0 && unit_start {
            pmt_pid = pmt_pid.or_else(|| program_map_pid(payload));
        } else if Some(pid) == pmt_pid && unit_start && audio.is_none() {
            audio = audio_stream(payload);
        } else if audio.is_some_and(|(audio_pid, _)| audio_pid == pid) {
            out.extend_from_slice(if unit_start {
                pes_payload(payload)
            } else {
                payload
            });
        }
    }
    let (_, codec) = audio.ok_or(Error::UnsupportedStream("this HLS segment's"))?;
    Ok((codec, out))
}

/// A section's body, after the pointer field, from the table ID up to its CRC.
fn section(payload: &[u8]) -> Option<&[u8]> {
    let section = payload.get(1 + usize::from(*payload.first()?)..)?;
    let length = usize::from(section.get(1)? & 0x0F) << 8 | usize::from(*section.get(2)?);
    section.get(..(3 + length).checked_sub(4)?)
}

fn program_map_pid(payload: &[u8]) -> Option<u16> {
    let section = section(payload)?;
    section
        .get(8..)?
        .as_chunks::<4>()
        .0
        .iter()
        .find_map(|program| {
            let number = u16::from_be_bytes([program[0], program[1]]);
            (number != 0).then(|| u16::from(program[2] & 0x1F) << 8 | u16::from(program[3]))
        })
}

fn audio_stream(payload: &[u8]) -> Option<(u16, Codec)> {
    let section = section(payload)?;
    let info_length = usize::from(section.get(10)? & 0x0F) << 8 | usize::from(*section.get(11)?);
    let mut streams = section.get(12 + info_length..)?;
    while let [kind, pid_high, pid_low, length_high, length_low, ..] = *streams {
        let pid = u16::from(pid_high & 0x1F) << 8 | u16::from(pid_low);
        let codec = match kind {
            0x0F => Some(Codec::Aac),
            0x03 | 0x04 => Some(Codec::Mp3),
            _ => None,
        };
        if let Some(codec) = codec {
            return Some((pid, codec));
        }
        let length = usize::from(length_high & 0x0F) << 8 | usize::from(length_low);
        streams = streams.get(5 + length..)?;
    }
    None
}

/// What follows a PES packet's header.
fn pes_payload(payload: &[u8]) -> &[u8] {
    match *payload {
        [0, 0, 1, _, _, _, _, _, header_length, ..] => payload
            .get(9 + usize::from(header_length)..)
            .unwrap_or_default(),
        _ => payload,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ADTS_FRAME: [u8; 7] = [0xFF, 0xF1, 0x50, 0x80, 0x01, 0x1F, 0xFC];

    fn packet(pid: u16, unit_start: bool, payload: &[u8]) -> Vec<u8> {
        let mut packet = vec![
            SYNC,
            (u8::from(unit_start) << 6) | (pid >> 8) as u8,
            pid as u8,
            0x10,
        ];
        packet.extend_from_slice(payload);
        packet.resize(PACKET, 0xFF);
        packet
    }

    /// A section after its pointer field, with a dummy CRC.
    fn section(table_id: u8, body: &[u8]) -> Vec<u8> {
        let length = body.len() + 4;
        let mut section = vec![0, table_id, 0xB0 | (length >> 8) as u8, length as u8];
        section.extend_from_slice(body);
        section.extend_from_slice(&[0; 4]);
        section
    }

    fn transport_stream(stream_type: u8, audio: &[u8]) -> Vec<u8> {
        let pat = section(0x00, &[0, 1, 0xC1, 0, 0, 0, 1, 0xF0, 0x00]);
        let pmt = section(
            0x02,
            &[
                0,
                1,
                0xC1,
                0,
                0,
                0xE1,
                0x00,
                0xF0,
                0x00,
                0x06,
                0xE1,
                0x02,
                0xF0,
                0x00,
                stream_type,
                0xE1,
                0x01,
                0xF0,
                0x00,
            ],
        );
        let mut pes = vec![0, 0, 1, 0xC0, 0, 0, 0x80, 0x80, 5, 0x21, 0, 1, 0, 1];
        pes.extend_from_slice(&audio[..4]);
        let mut stream = packet(0, true, &pat);
        stream.extend(packet(0x1000, true, &pmt));
        stream.extend(packet(0x0102, true, b"not audio"));
        let mut first = packet(0x0101, true, &pes);
        first.truncate(4 + pes.len());
        stream.extend(adaptation_padded(first));
        let mut rest = packet(0x0101, false, &audio[4..]);
        rest.truncate(4 + audio.len() - 4);
        stream.extend(adaptation_padded(rest));
        stream
    }

    /// Pads a short packet with an adaptation field, as muxers do, so its payload ends the packet.
    fn adaptation_padded(short: Vec<u8>) -> Vec<u8> {
        let stuffing = PACKET - short.len();
        let mut packet = short[..4].to_vec();
        packet[3] |= 0x20;
        packet.push((stuffing - 1) as u8);
        if stuffing > 1 {
            packet.push(0);
            packet.extend(std::iter::repeat_n(0xFF, stuffing - 2));
        }
        packet.extend_from_slice(&short[4..]);
        packet
    }

    #[test]
    fn demuxes_the_aac_stream_out_of_a_transport_stream() {
        let (codec, audio) = audio(&transport_stream(0x0F, &ADTS_FRAME)).unwrap();
        assert_eq!(codec, Codec::Aac);
        assert_eq!(audio, ADTS_FRAME);
    }

    #[test]
    fn demuxes_mp3_and_rejects_other_codecs() {
        let mp3 = [0xFF, 0xFB, 0x90, 0x64, 0x00];
        let (codec, audio) = audio(&transport_stream(0x03, &mp3)).unwrap();
        assert_eq!((codec, audio.as_slice()), (Codec::Mp3, &mp3[..]));
        assert!(super::audio(&transport_stream(0x11, &ADTS_FRAME)).is_err());
    }

    #[test]
    fn strips_the_id3_tag_from_packed_audio() {
        let mut segment = b"ID3\x04\x00\x00\x00\x00\x00\x03abc".to_vec();
        segment.extend_from_slice(&ADTS_FRAME);
        let (codec, audio) = audio(&segment).unwrap();
        assert_eq!((codec, audio.as_slice()), (Codec::Aac, &ADTS_FRAME[..]));
    }

    #[test]
    fn rejects_what_is_not_audio() {
        assert!(audio(b"<html>").is_err());
    }
}
