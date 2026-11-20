//! The radio-browser.info directory. Its servers mirror each other; requests
//! go to them in turn until one answers.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::station::{Country, Station};

/// Answers with every server's name, and serves the API itself if all else fails.
const ROUND_ROBIN: &str = "all.api.radio-browser.info";

pub struct RadioBrowser {
    agent: ureq::Agent,
    servers: Mutex<Vec<String>>,
}

#[derive(Deserialize)]
struct Server {
    name: String,
}

/// A station as the API describes it; unset text is an empty string.
#[derive(Deserialize)]
struct ApiStation {
    stationuuid: String,
    name: String,
    url: String,
    url_resolved: String,
    homepage: String,
    favicon: String,
    tags: String,
    state: String,
    #[serde(default)]
    geo_lat: Option<f64>,
    #[serde(default)]
    geo_long: Option<f64>,
    language: String,
    codec: String,
    bitrate: u32,
    hls: u8,
    votes: u32,
    clickcount: u32,
}

impl RadioBrowser {
    pub fn new(user_agent: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .user_agent(user_agent)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(60)))
            .build()
            .into();
        Self {
            agent,
            servers: Mutex::new(Vec::new()),
        }
    }

    /// A directory whose only server refuses every connection.
    #[cfg(test)]
    pub(crate) fn offline_for_tests() -> Self {
        let directory = Self::new("test");
        *directory.servers.lock().unwrap() = vec!["127.0.0.1:9".to_owned()];
        directory
    }

    /// Every working station radio-browser files under `country`.
    pub fn stations(&self, country: Country) -> Result<Vec<Station>> {
        let body = self.get(&format!(
            "/json/stations/search?countrycode={}&hidebroken=true&limit=100000",
            country.code()
        ))?;
        parse_stations(&body, country)
    }

    /// Tells radio-browser the station was played, as its usage guidelines ask.
    pub fn count_click(&self, station_id: &str) -> Result<()> {
        self.get(&format!("/json/url/{station_id}")).map(drop)
    }

    fn get(&self, path: &str) -> Result<String> {
        let mut last_error = None;
        for server in self.servers() {
            match self.agent.get(format!("https://{server}{path}")).call() {
                Ok(mut response) => {
                    return response
                        .body_mut()
                        .with_config()
                        .limit(64 << 20)
                        .read_to_string()
                        .map_err(|error| Error::Directory(error.to_string()));
                }
                Err(error) => {
                    log::warn!("radio-browser server {server} failed: {error}");
                    last_error = Some(error);
                }
            }
        }
        Err(Error::Directory(last_error.map_or_else(
            || "no servers".to_owned(),
            |error| error.to_string(),
        )))
    }

    /// The mirrors, starting at a different one per process to spread the load.
    fn servers(&self) -> Vec<String> {
        let mut servers = self
            .servers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if servers.is_empty() {
            *servers = self.fetch_servers().unwrap_or_else(|error| {
                log::warn!("Could not list radio-browser servers: {error}");
                Vec::new()
            });
            let start = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |now| now.subsec_nanos() as usize);
            if !servers.is_empty() {
                let len = servers.len();
                servers.rotate_left(start % len);
            }
            servers.push(ROUND_ROBIN.to_owned());
        }
        servers.clone()
    }

    fn fetch_servers(&self) -> Result<Vec<String>> {
        let body = self
            .agent
            .get(format!("https://{ROUND_ROBIN}/json/servers"))
            .call()
            .and_then(|mut response| response.body_mut().read_to_string())
            .map_err(|error| Error::Directory(error.to_string()))?;
        let mut names: Vec<String> = serde_json::from_str::<Vec<Server>>(&body)?
            .into_iter()
            .map(|server| server.name)
            .collect();
        names.sort_unstable();
        names.dedup();
        Ok(names)
    }
}

fn parse_stations(body: &str, country: Country) -> Result<Vec<Station>> {
    let stations: Vec<ApiStation> = serde_json::from_str(body)?;
    Ok(stations
        .into_iter()
        .filter_map(|s| station(s, country))
        .collect())
}

fn station(api: ApiStation, country: Country) -> Option<Station> {
    let stream_url = [api.url_resolved, api.url]
        .into_iter()
        .map(|url| url.trim().to_owned())
        .find(|url| url.starts_with("http://") || url.starts_with("https://"))?;
    let name = api.name.trim();
    if name.is_empty() {
        return None;
    }
    let codec = api.codec.trim();
    let place = coordinates(api.geo_lat, api.geo_long);
    let mut station = Station {
        id: api.stationuuid,
        name: name.to_owned(),
        stream_url,
        homepage: non_empty(api.homepage),
        favicon: non_empty(api.favicon),
        tags: list(&api.tags),
        categories: Vec::new(),
        country_code: country,
        state: non_empty(api.state),
        latitude: place.map(|(latitude, _)| latitude),
        longitude: place.map(|(_, longitude)| longitude),
        languages: list(&api.language),
        codec: (!codec.is_empty() && codec != "UNKNOWN").then(|| codec.to_owned()),
        bitrate: (api.bitrate > 0).then_some(api.bitrate),
        hls: api.hls == 1,
        votes: api.votes,
        click_count: api.clickcount,
    };
    station.categorize();
    Some(station)
}

/// A real place: many stations are filed at 0, 0 or out of range.
fn coordinates(latitude: Option<f64>, longitude: Option<f64>) -> Option<(f64, f64)> {
    let (latitude, longitude) = (latitude?, longitude?);
    let real =
        latitude.abs() <= 90.0 && longitude.abs() <= 180.0 && (latitude != 0.0 || longitude != 0.0);
    real.then_some((latitude, longitude))
}

fn non_empty(text: String) -> Option<String> {
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn list(text: &str) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    for item in text
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if !items.iter().any(|seen| seen == item) {
            items.push(item.to_owned());
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::category::Category;

    #[test]
    fn reads_api_stations_and_drops_unplayable_ones() {
        let body = r#"[
            {"stationuuid": "a", "name": " 中国之声 ", "url": "http://x/a.m3u8",
             "url_resolved": "https://cdn.x/a.m3u8", "homepage": "", "favicon": "https://x/a.png",
             "tags": "news, 新闻,news,", "state": "北京", "language": "mandarin,chinese",
             "codec": "UNKNOWN", "bitrate": 0, "hls": 1, "votes": 3, "clickcount": 9,
             "lastcheckok": 1, "geo_lat": 39.9, "geo_long": 116.4},
            {"stationuuid": "b", "name": "No stream", "url": "rtmp://x", "url_resolved": "",
             "homepage": "", "favicon": "", "tags": "", "state": "", "language": "",
             "codec": "MP3", "bitrate": 128, "hls": 0, "votes": 0, "clickcount": 0},
            {"stationuuid": "c", "name": "Nowhere", "url": "http://x/c.mp3", "url_resolved": "",
             "homepage": "", "favicon": "", "tags": "", "state": "", "language": "",
             "codec": "MP3", "bitrate": 128, "hls": 0, "votes": 0, "clickcount": 0,
             "geo_lat": 0.0, "geo_long": 0.0}
        ]"#;
        let stations = parse_stations(body, Country::China).unwrap();
        assert_eq!(stations.len(), 2);
        assert_eq!(stations[1].latitude, None);
        let station = &stations[0];
        assert_eq!(
            (station.latitude, station.longitude),
            (Some(39.9), Some(116.4))
        );
        assert_eq!(station.name, "中国之声");
        assert_eq!(station.stream_url, "https://cdn.x/a.m3u8");
        assert_eq!(station.homepage, None);
        assert_eq!(station.tags, ["news", "新闻"]);
        assert_eq!(station.categories, [Category::News]);
        assert_eq!(station.state.as_deref(), Some("北京"));
        assert_eq!(station.codec, None);
        assert_eq!(station.bitrate, None);
        assert!(station.hls);
    }
}
