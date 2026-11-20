//! Station logos, fetched by Rust and handed over as `data:` URLs: the
//! webview's content security policy allows no remote images, and many logos
//! are served over plain HTTP.

use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sha2::{Digest, Sha256};

use crate::error::Result;

/// Logos larger than this are skipped.
const MAX_BYTES: u64 = 512 << 10;
/// A logo, or a logo found missing, is fetched again after this long.
const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

pub struct Favicons {
    dir: PathBuf,
    agent: ureq::Agent,
}

impl Favicons {
    pub fn new(dir: PathBuf, user_agent: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .user_agent(user_agent)
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .into();
        Self { dir, agent }
    }

    /// The image at `url` as a `data:` URL; `None` when there is none to show.
    /// An empty file in the cache remembers that.
    pub fn data_url(&self, url: &str) -> Result<Option<String>> {
        let file = self.dir.join(cache_key(url));
        let bytes = match fs::read(&file) {
            Ok(bytes) if !is_stale(&file) => bytes,
            _ => {
                let bytes = self.fetch(url).unwrap_or_default();
                fs::create_dir_all(&self.dir)?;
                fs::write(&file, &bytes)?;
                bytes
            }
        };
        Ok(
            image_type(&bytes)
                .map(|mime| format!("data:{mime};base64,{}", STANDARD.encode(&bytes))),
        )
    }

    /// Drops logos past their age, so the cache does not keep stations long gone.
    pub fn tidy(&self) -> Result<()> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Ok(());
        };
        for entry in entries {
            let path = entry?.path();
            if is_stale(&path) {
                fs::remove_file(path)?;
            }
        }
        Ok(())
    }

    fn fetch(&self, url: &str) -> Option<Vec<u8>> {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return None;
        }
        let mut response = self
            .agent
            .get(url)
            .call()
            .inspect_err(|error| log::info!("No logo at {url}: {error}"))
            .ok()?;
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        (bytes.len() as u64 <= MAX_BYTES).then_some(bytes)
    }
}

fn cache_key(url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn is_stale(path: &std::path::Path) -> bool {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_none_or(|age| age > MAX_AGE)
}

/// What the bytes are, by their signature rather than the server's word for it.
fn image_type(bytes: &[u8]) -> Option<&'static str> {
    let svg = || {
        let start = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_lowercase();
        start.contains("<svg")
    };
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => Some("image/webp"),
        [0, 0, 1, 0, ..] => Some("image/x-icon"),
        [b'B', b'M', ..] => Some("image/bmp"),
        _ if svg() => Some("image/svg+xml"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_images_by_their_signature() {
        assert_eq!(image_type(b"\x89PNG\r\n\x1a\n"), Some("image/png"));
        assert_eq!(image_type(b"\xFF\xD8\xFF\xE0"), Some("image/jpeg"));
        assert_eq!(image_type(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(
            image_type(b"<?xml version=\"1.0\"?>\n<SVG xmlns="),
            Some("image/svg+xml")
        );
        assert_eq!(image_type(b"<!DOCTYPE html><html>"), None);
        assert_eq!(image_type(b""), None);
    }

    #[test]
    fn remembers_a_missing_logo_without_fetching_again() {
        let dir = tempfile::tempdir().unwrap();
        let favicons = Favicons::new(dir.path().to_owned(), "test");
        assert_eq!(
            favicons.data_url("ftp://example.com/logo.png").unwrap(),
            None
        );
        let cached = dir.path().join(cache_key("ftp://example.com/logo.png"));
        assert_eq!(fs::read(cached).unwrap(), b"");
    }

    #[test]
    fn serves_a_cached_logo_as_a_data_url() {
        let dir = tempfile::tempdir().unwrap();
        let favicons = Favicons::new(dir.path().to_owned(), "test");
        let url = "https://example.com/logo.gif";
        fs::write(dir.path().join(cache_key(url)), b"GIF89a").unwrap();
        assert_eq!(
            favicons.data_url(url).unwrap().as_deref(),
            Some("data:image/gif;base64,R0lGODlh")
        );
    }
}
