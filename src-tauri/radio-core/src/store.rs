//! Favourite and recently played stations, and the favourites stored on the
//! preset keys. Each row keeps the whole station, so it still shows when the
//! directory is unreachable or has dropped it.

use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use rusqlite_migration::{M, Migrations};

use serde::Serialize;

use crate::error::{Error, Result};
use crate::station::Station;

/// How many recently played stations are kept.
pub const RECENT_LIMIT: u32 = 30;
/// Preset keys are numbered from 1 to this.
pub const PRESET_KEYS: u8 = 6;

const MIGRATIONS: &[M<'_>] = &[
    M::up(
        "CREATE TABLE favourites (
        station_id TEXT PRIMARY KEY,
        station TEXT NOT NULL,
        added_at INTEGER NOT NULL
    );
    CREATE TABLE plays (
        station_id TEXT PRIMARY KEY,
        station TEXT NOT NULL,
        played_at INTEGER NOT NULL
    );
    CREATE INDEX plays_by_time ON plays (played_at);",
    ),
    M::up(
        "ALTER TABLE favourites ADD COLUMN preset INTEGER;
        CREATE UNIQUE INDEX favourites_by_preset ON favourites (preset) WHERE preset IS NOT NULL;",
    ),
];

/// A favourite stored on a preset key.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Preset {
    /// From 1 to [`PRESET_KEYS`].
    pub key: u8,
    pub station: Station,
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        // With WAL, NORMAL still survives a crash and skips a sync per commit.
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        Self::init(connection)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut connection: Connection) -> Result<Self> {
        Migrations::from_slice(MIGRATIONS).to_latest(&mut connection)?;
        Ok(Self { connection })
    }

    /// Newest first.
    pub fn favourites(&self) -> Result<Vec<Station>> {
        self.stations("SELECT station FROM favourites ORDER BY added_at DESC, rowid DESC")
    }

    pub fn set_favourite(
        &mut self,
        station: &Station,
        favourite: bool,
        now: DateTime<Utc>,
    ) -> Result<()> {
        if favourite {
            self.connection.execute(
                "INSERT INTO favourites (station_id, station, added_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (station_id) DO UPDATE SET station = excluded.station",
                params![
                    station.id,
                    serde_json::to_string(station)?,
                    now.timestamp_millis()
                ],
            )?;
        } else {
            self.connection.execute(
                "DELETE FROM favourites WHERE station_id = ?1",
                [&station.id],
            )?;
        }
        Ok(())
    }

    /// By key.
    pub fn presets(&self) -> Result<Vec<Preset>> {
        let mut statement = self.connection.prepare(
            "SELECT preset, station FROM favourites WHERE preset IS NOT NULL ORDER BY preset",
        )?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get::<_, String>(1)?)))?;
        rows.map(|row| {
            let (key, json) = row?;
            Ok(Preset {
                key,
                station: serde_json::from_str(&json)?,
            })
        })
        .collect()
    }

    /// Stores `station` on preset `key` in place of what was there, making it a favourite.
    pub fn set_preset(&mut self, station: &Station, key: u8, now: DateTime<Utc>) -> Result<()> {
        if !(1..=PRESET_KEYS).contains(&key) {
            return Err(Error::Refused(format!("There is no preset key {key}")));
        }
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE favourites SET preset = NULL WHERE preset = ?1 OR station_id = ?2",
            params![key, station.id],
        )?;
        transaction.execute(
            "INSERT INTO favourites (station_id, station, added_at, preset) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (station_id) DO UPDATE SET station = excluded.station, preset = excluded.preset",
            params![
                station.id,
                serde_json::to_string(station)?,
                now.timestamp_millis(),
                key
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Most recent first, at most [`RECENT_LIMIT`].
    pub fn recent(&self) -> Result<Vec<Station>> {
        self.stations(&format!(
            "SELECT station FROM plays ORDER BY played_at DESC, rowid DESC LIMIT {RECENT_LIMIT}"
        ))
    }

    /// Moves `station` to the top of the recently played, dropping the oldest beyond the limit.
    pub fn record_play(&mut self, station: &Station, now: DateTime<Utc>) -> Result<()> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO plays (station_id, station, played_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (station_id) DO UPDATE
             SET station = excluded.station, played_at = excluded.played_at",
            params![
                station.id,
                serde_json::to_string(station)?,
                now.timestamp_millis()
            ],
        )?;
        let cutoff: Option<i64> = transaction
            .query_row(
                &format!(
                    "SELECT played_at FROM plays ORDER BY played_at DESC LIMIT 1 OFFSET {}",
                    RECENT_LIMIT - 1
                ),
                [],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(cutoff) = cutoff {
            transaction.execute("DELETE FROM plays WHERE played_at < ?1", [cutoff])?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn stations(&self, sql: &str) -> Result<Vec<Station>> {
        let mut statement = self.connection.prepare(sql)?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|json| Ok(serde_json::from_str(&json?)?)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::station::station;
    use chrono::{TimeDelta, TimeZone};

    fn at(minutes: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap() + TimeDelta::minutes(minutes)
    }

    fn ids(stations: &[Station]) -> Vec<&str> {
        stations.iter().map(|station| station.id.as_str()).collect()
    }

    #[test]
    fn keeps_favourites_newest_first_and_forgets_removed_ones() {
        let mut store = Store::open_in_memory().unwrap();
        store.set_favourite(&station("a", 1), true, at(0)).unwrap();
        store.set_favourite(&station("b", 1), true, at(1)).unwrap();
        store.set_favourite(&station("a", 1), true, at(2)).unwrap();
        assert_eq!(ids(&store.favourites().unwrap()), ["b", "a"]);

        store.set_favourite(&station("b", 1), false, at(3)).unwrap();
        assert_eq!(ids(&store.favourites().unwrap()), ["a"]);
    }

    #[test]
    fn moves_a_replayed_station_to_the_top_and_keeps_only_the_newest() {
        let mut store = Store::open_in_memory().unwrap();
        for minute in 0..40 {
            store
                .record_play(&station(&minute.to_string(), 1), at(minute))
                .unwrap();
        }
        store.record_play(&station("20", 1), at(41)).unwrap();

        let recent = store.recent().unwrap();
        assert_eq!(recent.len(), RECENT_LIMIT as usize);
        assert_eq!(ids(&recent)[..3], ["20", "39", "38"]);
    }

    #[test]
    fn stores_one_favourite_per_preset_key() {
        let mut store = Store::open_in_memory().unwrap();
        store.set_favourite(&station("a", 1), true, at(0)).unwrap();
        store.set_preset(&station("a", 1), 2, at(1)).unwrap();
        store.set_preset(&station("b", 1), 1, at(2)).unwrap();
        let keys = |store: &Store| -> Vec<(u8, String)> {
            let presets = store.presets().unwrap();
            presets.into_iter().map(|p| (p.key, p.station.id)).collect()
        };
        assert_eq!(keys(&store), [(1, "b".into()), (2, "a".into())]);
        assert_eq!(ids(&store.favourites().unwrap()), ["b", "a"]);

        store.set_preset(&station("a", 1), 1, at(3)).unwrap();
        assert_eq!(keys(&store), [(1, "a".into())]);

        store.set_favourite(&station("a", 1), false, at(4)).unwrap();
        assert_eq!(keys(&store), []);
        assert!(store.set_preset(&station("a", 1), 7, at(5)).is_err());
    }

    #[test]
    fn a_reopened_database_keeps_its_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("radio.sqlite3");
        Store::open(&path)
            .unwrap()
            .set_favourite(&station("a", 1), true, at(0))
            .unwrap();
        assert_eq!(
            ids(&Store::open(&path).unwrap().favourites().unwrap()),
            ["a"]
        );
    }
}
