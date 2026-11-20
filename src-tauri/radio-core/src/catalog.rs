//! Every station of every [`Country`], fetched at most once a day and kept on
//! disk, so the app starts with the list and still has it offline.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::radio_browser::RadioBrowser;
use crate::station::{self, Country, Station};

const MAX_AGE: TimeDelta = TimeDelta::hours(24);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cached {
    fetched_at: DateTime<Utc>,
    stations: Arc<Vec<Station>>,
}

pub struct Catalog {
    file: PathBuf,
    cached: Mutex<Option<Cached>>,
}

impl Catalog {
    pub fn new(file: PathBuf) -> Self {
        Self {
            file,
            cached: Mutex::new(None),
        }
    }

    /// The cached list while it is under a day old, else a fresh one. With
    /// `refresh`, always a fresh one. When fetching fails, a stale list is
    /// better than none, unless a refresh asked for a fresh one.
    pub fn stations(
        &self,
        directory: &RadioBrowser,
        refresh: bool,
        now: DateTime<Utc>,
    ) -> Result<Arc<Vec<Station>>> {
        let mut cached = self.cached.lock().unwrap_or_else(PoisonError::into_inner);
        if cached.is_none() {
            *cached = self.load();
        }
        if let Some(current) = cached.as_ref()
            && !refresh
            && now - current.fetched_at < MAX_AGE
        {
            return Ok(Arc::clone(&current.stations));
        }
        match fetch(directory) {
            Ok(stations) => {
                let fresh = Cached {
                    fetched_at: now,
                    stations: Arc::new(stations),
                };
                if let Err(error) = self.save(&fresh) {
                    log::warn!("Could not cache the stations: {error}");
                }
                let stations = Arc::clone(&fresh.stations);
                *cached = Some(fresh);
                Ok(stations)
            }
            Err(error) => match cached.as_ref() {
                Some(stale) if !refresh => {
                    log::warn!("Using stations from {}: {error}", stale.fetched_at);
                    Ok(Arc::clone(&stale.stations))
                }
                _ => Err(error),
            },
        }
    }

    /// `stations` with each replaced by its entry in the loaded list, when it
    /// has one: a saved station's stream can move.
    pub fn latest(&self, stations: Vec<Station>) -> Vec<Station> {
        let cached = self.cached.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(cached) = cached.as_ref() else {
            return stations;
        };
        let by_id: HashMap<&str, &Station> = cached
            .stations
            .iter()
            .map(|station| (station.id.as_str(), station))
            .collect();
        stations
            .into_iter()
            .map(|station| {
                by_id
                    .get(station.id.as_str())
                    .map_or(station, |&s| s.clone())
            })
            .collect()
    }

    fn load(&self) -> Option<Cached> {
        let text = fs::read(&self.file).ok()?;
        serde_json::from_slice(&text)
            .inspect_err(|error| log::warn!("Ignoring the cached stations: {error}"))
            .ok()
    }

    fn save(&self, cached: &Cached) -> Result<()> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir)?;
        }
        let part = self.file.with_extension("part");
        fs::write(&part, serde_json::to_vec(cached)?)?;
        fs::rename(part, &self.file)?;
        Ok(())
    }
}

/// Each country's stations, fetched side by side.
fn fetch(directory: &RadioBrowser) -> Result<Vec<Station>> {
    let lists = std::thread::scope(|scope| {
        let handles: Vec<_> = Country::ALL
            .into_iter()
            .map(|country| scope.spawn(move || directory.stations(country)))
            .collect();
        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
            })
            .collect::<Result<Vec<_>>>()
    })?;
    Ok(station::merge(lists))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::station::station;
    use chrono::TimeZone;

    /// Points at a closed port, so any fetch fails at once.
    fn offline() -> RadioBrowser {
        RadioBrowser::offline_for_tests()
    }

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap()
    }

    fn catalog_with(fetched_at: DateTime<Utc>) -> (tempfile::TempDir, Catalog) {
        let dir = tempfile::tempdir().unwrap();
        let catalog = Catalog::new(dir.path().join("stations.json"));
        catalog
            .save(&Cached {
                fetched_at,
                stations: Arc::new(vec![station("a", 1)]),
            })
            .unwrap();
        (dir, catalog)
    }

    #[test]
    fn serves_a_fresh_list_from_disk() {
        let (_dir, catalog) = catalog_with(now() - TimeDelta::hours(1));
        let stations = catalog.stations(&offline(), false, now()).unwrap();
        assert_eq!(stations[0].id, "a");
    }

    #[test]
    fn falls_back_to_a_stale_list_unless_refreshing() {
        let (_dir, catalog) = catalog_with(now() - TimeDelta::days(3));
        assert_eq!(catalog.stations(&offline(), false, now()).unwrap().len(), 1);
        assert!(catalog.stations(&offline(), true, now()).is_err());
    }

    #[test]
    fn swaps_in_the_listed_version_of_a_saved_station() {
        let (_dir, catalog) = catalog_with(now());
        catalog.stations(&offline(), false, now()).unwrap();
        let mut saved = station("a", 1);
        saved.stream_url = "https://old.example.com".to_owned();
        let latest = catalog.latest(vec![saved, station("gone", 1)]);
        assert_eq!(latest[0].stream_url, "https://example.com/a.mp3");
        assert_eq!(latest[1].id, "gone");
    }
}
