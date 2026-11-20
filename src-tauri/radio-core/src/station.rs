use serde::{Deserialize, Serialize};

/// The places whose stations the app lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Country {
    #[serde(rename = "CN")]
    China,
    #[serde(rename = "TW")]
    Taiwan,
    #[serde(rename = "HK")]
    HongKong,
    #[serde(rename = "MO")]
    Macau,
}

impl Country {
    pub const ALL: [Country; 4] = [
        Country::China,
        Country::Taiwan,
        Country::HongKong,
        Country::Macau,
    ];

    /// The ISO 3166-1 code radio-browser files the station under.
    pub fn code(self) -> &'static str {
        match self {
            Country::China => "CN",
            Country::Taiwan => "TW",
            Country::HongKong => "HK",
            Country::Macau => "MO",
        }
    }

    /// What older software there writes Chinese in, when it is not UTF-8.
    pub fn legacy_encoding(self) -> &'static encoding_rs::Encoding {
        match self {
            Country::China => encoding_rs::GBK,
            Country::Taiwan | Country::HongKong | Country::Macau => encoding_rs::BIG5,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    /// radio-browser's `stationuuid`.
    pub id: String,
    pub name: String,
    pub stream_url: String,
    pub homepage: Option<String>,
    /// A remote image; the frontend shows it through `Favicons`.
    pub favicon: Option<String>,
    pub tags: Vec<String>,
    pub country_code: Country,
    /// The province or region.
    pub state: Option<String>,
    /// Where the station is, in degrees, when radio-browser knows.
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub languages: Vec<String>,
    pub codec: Option<String>,
    /// In kbit/s.
    pub bitrate: Option<u32>,
    pub hls: bool,
    pub votes: u32,
    pub click_count: u32,
}

/// Every station once, the most listened to first.
pub fn merge(lists: impl IntoIterator<Item = Vec<Station>>) -> Vec<Station> {
    let mut seen = std::collections::HashSet::new();
    let mut stations: Vec<Station> = lists
        .into_iter()
        .flatten()
        .filter(|station| seen.insert(station.id.clone()))
        .collect();
    stations.sort_by(|a, b| {
        b.click_count
            .cmp(&a.click_count)
            .then_with(|| b.votes.cmp(&a.votes))
    });
    stations
}

#[cfg(test)]
pub(crate) fn station(id: &str, click_count: u32) -> Station {
    Station {
        id: id.to_owned(),
        name: format!("电台{id}"),
        stream_url: format!("https://example.com/{id}.mp3"),
        homepage: None,
        favicon: None,
        tags: vec!["news".to_owned()],
        country_code: Country::Taiwan,
        state: None,
        latitude: None,
        longitude: None,
        languages: vec!["chinese".to_owned()],
        codec: Some("MP3".to_owned()),
        bitrate: Some(128),
        hls: false,
        votes: 0,
        click_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_without_duplicates_most_listened_first() {
        let merged = merge([
            vec![station("a", 5), station("b", 50)],
            vec![station("a", 5), station("c", 10)],
        ]);
        let ids: Vec<&str> = merged.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["b", "c", "a"]);
    }

    #[test]
    fn serializes_with_the_frontend_field_names() {
        let value = serde_json::to_value(station("a", 1)).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "id": "a",
                "name": "电台a",
                "streamUrl": "https://example.com/a.mp3",
                "homepage": null,
                "favicon": null,
                "tags": ["news"],
                "countryCode": "TW",
                "state": null,
                "latitude": null,
                "longitude": null,
                "languages": ["chinese"],
                "codec": "MP3",
                "bitrate": 128,
                "hls": false,
                "votes": 0,
                "clickCount": 1,
            })
        );
    }
}
