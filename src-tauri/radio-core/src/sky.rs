//! The weather where a station is, for its painting: Open-Meteo's current
//! conditions (CC BY 4.0), boiled down to how much rain, snow, cloud, fog and
//! wind to draw.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const FORECAST: &str = "https://api.open-meteo.com/v1/forecast";
const VARIABLES: &str = "weather_code,cloud_cover,rain,showers,snowfall,wind_speed_10m,visibility";

/// How much of each the painting shows, each from 0 to 1.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWeather {
    pub rain: f32,
    pub snow: f32,
    pub cloud: f32,
    pub fog: f32,
    pub wind: f32,
    /// Thunder, so lightning.
    pub storm: bool,
}

/// Open-Meteo's `current` block. Sums cover the `interval` before `time`.
#[derive(Debug, Deserialize)]
struct Current {
    /// Seconds.
    interval: f32,
    /// A WMO weather interpretation code.
    weather_code: u8,
    /// Percent.
    cloud_cover: f32,
    /// Millimetres.
    rain: f32,
    /// Millimetres.
    showers: f32,
    /// Centimetres.
    snowfall: f32,
    /// km/h.
    wind_speed_10m: f32,
    /// Metres.
    visibility: Option<f32>,
}

#[derive(Deserialize)]
struct Forecast {
    current: Current,
}

pub struct Skies {
    agent: ureq::Agent,
}

impl Skies {
    pub fn new(user_agent: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .user_agent(user_agent)
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .into();
        Self { agent }
    }

    /// The weather now at `latitude`, `longitude`, rounded to about a kilometre.
    pub fn weather(&self, latitude: f64, longitude: f64) -> Result<LocalWeather> {
        let body = self
            .agent
            .get(format!(
                "{FORECAST}?latitude={latitude:.2}&longitude={longitude:.2}&current={VARIABLES}"
            ))
            .call()
            .and_then(|mut response| response.body_mut().read_to_string())
            .map_err(|error| Error::Weather(error.to_string()))?;
        Ok(painted(&serde_json::from_str::<Forecast>(&body)?.current))
    }
}

fn painted(now: &Current) -> LocalWeather {
    let code = now.weather_code;
    let per_hour = 3600.0 / now.interval.max(60.0);
    let drizzle = (51..=57).contains(&code);
    let raining = drizzle || (61..=67).contains(&code) || (80..=82).contains(&code) || code >= 95;
    let snowing = (71..=77).contains(&code) || (85..=86).contains(&code);
    // Light rain, about 1 mm an hour, is half; a downpour of 4 or more is all.
    let rain = ((now.rain + now.showers) * per_hour / 4.0).sqrt().min(1.0);
    // Snow falls about seven times deeper than its water: 2 cm an hour is heavy.
    let snow = (now.snowfall * per_hour / 2.0).sqrt().min(1.0);
    let fog = if code == 45 || code == 48 {
        1.0
    } else {
        now.visibility.map_or(0.0, |metres| {
            ((10_000.0 - metres) / 9_000.0).clamp(0.0, 1.0)
        })
    };
    LocalWeather {
        rain: if raining {
            rain.max(if drizzle { 0.2 } else { 0.3 })
        } else {
            rain
        },
        snow: if snowing { snow.max(0.3) } else { snow },
        cloud: (now.cloud_cover / 100.0).clamp(0.0, 1.0),
        fog,
        wind: (now.wind_speed_10m / 50.0).clamp(0.0, 1.0),
        storm: code >= 95,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current(json: &str) -> Current {
        serde_json::from_str::<Forecast>(json).unwrap().current
    }

    #[test]
    fn reads_rain_and_wind_from_open_meteo() {
        let weather = painted(&current(
            r#"{"latitude": 25.0, "current": {"time": "2026-11-20T09:15", "interval": 900,
                "weather_code": 63, "cloud_cover": 100, "rain": 0.25, "showers": 0.0,
                "snowfall": 0.0, "wind_speed_10m": 25.0, "visibility": 24140.0}}"#,
        ));
        assert_eq!(
            weather,
            LocalWeather {
                rain: 0.5,
                snow: 0.0,
                cloud: 1.0,
                fog: 0.0,
                wind: 0.5,
                storm: false
            }
        );
    }

    #[test]
    fn shows_a_little_of_what_the_code_says_even_when_the_sums_are_nil() {
        let weather = painted(&current(
            r#"{"current": {"interval": 900, "weather_code": 95, "cloud_cover": 80,
                "rain": 0.0, "showers": 0.0, "snowfall": 0.0, "wind_speed_10m": 80.0,
                "visibility": null}}"#,
        ));
        assert_eq!(
            (weather.rain, weather.wind, weather.storm),
            (0.3, 1.0, true)
        );
        let fog = painted(&current(
            r#"{"current": {"interval": 900, "weather_code": 45, "cloud_cover": 100,
                "rain": 0.0, "showers": 0.0, "snowfall": 0.0, "wind_speed_10m": 3.0,
                "visibility": 20000.0}}"#,
        ));
        assert_eq!(fog.fog, 1.0);
    }

    #[test]
    fn serializes_with_the_frontend_field_names() {
        let value = serde_json::to_value(LocalWeather {
            rain: 0.0,
            snow: 0.5,
            cloud: 0.25,
            fog: 0.0,
            wind: 1.0,
            storm: false,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({"rain": 0.0, "snow": 0.5, "cloud": 0.25, "fog": 0.0, "wind": 1.0, "storm": false})
        );
    }
}
