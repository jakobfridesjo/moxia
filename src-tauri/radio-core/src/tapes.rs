//! Recordings of a station, kept as tapes: the stream's own MP3 or AAC
//! frames, as they came, in `<id>.mp3` or `<id>.aac`, beside an `<id>.json`
//! that describes them. The description is written when recording ends, so
//! a tape still recording is not listed.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::player::{Codec, frames};
use crate::station::Station;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tape {
    pub id: String,
    pub station: Station,
    pub recorded_at: DateTime<Utc>,
    /// In seconds.
    pub duration: f64,
    pub codec: Codec,
    /// What the station said was on air, and when.
    pub notes: Vec<TapeNote>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TapeNote {
    /// Seconds into the tape.
    pub at: f64,
    pub title: String,
}

pub struct Tapes {
    directory: PathBuf,
}

impl Tapes {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    /// Newest first.
    pub fn list(&self) -> Result<Vec<Tape>> {
        let entries = match fs::read_dir(&self.directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut tapes: Vec<Tape> = entries
            .filter_map(|entry| {
                let path = entry.ok()?.path();
                if path.extension()? != "json" {
                    return None;
                }
                read_description(&path)
                    .inspect_err(|error| log::warn!("{}: {error}", path.display()))
                    .ok()
            })
            .filter(|tape| self.audio_path(tape).exists())
            .collect();
        tapes.sort_by_key(|tape| std::cmp::Reverse(tape.recorded_at));
        Ok(tapes)
    }

    pub fn get(&self, id: &str) -> Result<Tape> {
        read_description(&self.description_path(checked(id)?))
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let tape = self.get(id)?;
        remove_if_there(&self.audio_path(&tape))?;
        remove_if_there(&self.description_path(&tape.id))
    }

    pub fn audio_path(&self, tape: &Tape) -> PathBuf {
        self.directory
            .join(&tape.id)
            .with_extension(tape.codec.extension())
    }

    /// Starts a new tape of `station`, whose stream is in `codec`.
    pub fn record(&self, station: &Station, codec: Codec, now: DateTime<Utc>) -> Result<Recorder> {
        fs::create_dir_all(&self.directory)?;
        let tape = Tape {
            id: now.format("%Y%m%d-%H%M%S-%3f").to_string(),
            station: station.clone(),
            recorded_at: now,
            duration: 0.0,
            codec,
            notes: Vec::new(),
        };
        let audio = self.audio_path(&tape);
        let file = File::create_new(&audio)?;
        Ok(Recorder {
            description: self.description_path(&tape.id),
            audio,
            tape,
            file: BufWriter::new(file),
            started: Instant::now(),
        })
    }

    fn description_path(&self, id: &str) -> PathBuf {
        self.directory.join(id).with_extension("json")
    }
}

/// A tape being recorded.
pub struct Recorder {
    tape: Tape,
    audio: PathBuf,
    description: PathBuf,
    file: BufWriter<File>,
    started: Instant,
}

impl Recorder {
    pub fn write(&mut self, bytes: &[u8]) -> Result<()> {
        Ok(self.file.write_all(bytes)?)
    }

    /// Notes what the station says is on air now.
    pub fn note(&mut self, title: &str) {
        self.tape.notes.push(TapeNote {
            at: self.started.elapsed().as_secs_f64(),
            title: title.to_owned(),
        });
    }

    /// Ends the tape: `None` when nothing playable was recorded, which is then thrown away.
    pub fn finish(mut self) -> Result<Option<Tape>> {
        self.file.flush()?;
        drop(self.file);
        let duration = frames::duration(BufReader::new(File::open(&self.audio)?), self.tape.codec)?;
        if duration <= 0.0 {
            remove_if_there(&self.audio)?;
            return Ok(None);
        }
        self.tape.duration = to_milliseconds(duration);
        for note in &mut self.tape.notes {
            note.at = to_milliseconds(note.at.min(duration));
        }
        fs::write(&self.description, serde_json::to_vec(&self.tape)?)?;
        Ok(Some(self.tape))
    }
}

/// Rounded, so the time reads back from JSON as it was written.
fn to_milliseconds(seconds: f64) -> f64 {
    (seconds * 1000.0).round() / 1000.0
}

/// Tape ids are made by [`Tapes::record`]; anything else could reach outside the directory.
fn checked(id: &str) -> Result<&str> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit() || c == '-') {
        Ok(id)
    } else {
        Err(Error::Refused(format!("There is no tape {id}")))
    }
}

fn read_description(path: &Path) -> Result<Tape> {
    match fs::read(path) {
        Ok(json) => Ok(serde_json::from_slice(&json)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(Error::Refused("The tape is gone".to_owned()))
        }
        Err(error) => Err(error.into()),
    }
}

fn remove_if_there(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::frames::tests::adts_frame;
    use crate::station::station;
    use chrono::{TimeDelta, TimeZone};

    fn at(seconds: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 12, 8, 0, 0).unwrap() + TimeDelta::seconds(seconds)
    }

    fn record(tapes: &Tapes, id: &str, when: DateTime<Utc>, frames: usize) -> Option<Tape> {
        let mut recorder = tapes.record(&station(id, 1), Codec::Aac, when).unwrap();
        recorder.note("新闻");
        for _ in 0..frames {
            recorder.write(&adts_frame(200)).unwrap();
        }
        recorder.finish().unwrap()
    }

    #[test]
    fn lists_finished_tapes_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let tapes = Tapes::new(dir.path().join("tapes"));
        assert_eq!(tapes.list().unwrap(), []);

        let first = record(&tapes, "a", at(0), 431).unwrap();
        record(&tapes, "b", at(60), 10).unwrap();
        assert_eq!(first.duration, 10.008);
        assert_eq!(first.notes[0].title, "新闻");

        let listed = tapes.list().unwrap();
        let stations: Vec<&str> = listed.iter().map(|t| t.station.id.as_str()).collect();
        assert_eq!(stations, ["b", "a"]);
        assert_eq!(tapes.get(&first.id).unwrap(), first);
    }

    #[test]
    fn throws_away_a_tape_with_nothing_on_it() {
        let dir = tempfile::tempdir().unwrap();
        let tapes = Tapes::new(dir.path().to_owned());
        assert_eq!(record(&tapes, "a", at(0), 0), None);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn deletes_a_tape_and_refuses_odd_ids() {
        let dir = tempfile::tempdir().unwrap();
        let tapes = Tapes::new(dir.path().to_owned());
        let tape = record(&tapes, "a", at(0), 5).unwrap();
        tapes.delete(&tape.id).unwrap();
        assert_eq!(tapes.list().unwrap(), []);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        assert!(tapes.get("../radio").is_err());
    }

    #[test]
    fn serializes_with_the_frontend_field_names() {
        let tape = Tape {
            id: "20261112-080000-000".to_owned(),
            station: station("a", 1),
            recorded_at: at(0),
            duration: 1.5,
            codec: Codec::Mp3,
            notes: vec![TapeNote {
                at: 0.5,
                title: "晴天".to_owned(),
            }],
        };
        let value = serde_json::to_value(&tape).unwrap();
        assert_eq!(value["recordedAt"], "2026-11-12T08:00:00Z");
        assert_eq!(value["codec"], "mp3");
        assert_eq!(value["duration"], 1.5);
        assert_eq!(
            value["notes"],
            serde_json::json!([{ "at": 0.5, "title": "晴天" }])
        );
    }
}
