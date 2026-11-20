//! Opens a station's stream URL as bytes symphonia can probe: a plain HTTP
//! stream, with its ICY metadata taken out, or an HLS playlist. A `.pls` or
//! `.m3u` playlist is followed to the stream it names.

use std::io::{self, BufRead, BufReader, Read};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use encoding_rs::Encoding;
use ureq::ResponseExt;
use url::Url;

use super::hls::{self, HlsReader};
use crate::error::{Error, Result};

/// How many playlists may point at another before giving up.
const MAX_REDIRECTS: u8 = 3;

pub struct Source {
    pub reader: Box<dyn Read + Send>,
    /// The file extension that tells symphonia's probe where to start.
    pub extension: Option<&'static str>,
}

/// `legacy_encoding` is what stream titles that are not UTF-8 are read as.
pub fn open(
    agent: &ureq::Agent,
    stop: &Arc<AtomicBool>,
    url: &str,
    legacy_encoding: &'static Encoding,
    on_title: impl FnMut(String) + Send + 'static,
) -> Result<Source> {
    let mut url = parse_url(url)?;
    for _ in 0..=MAX_REDIRECTS {
        let response = agent
            .get(url.as_str())
            .header("Icy-MetaData", "1")
            .call()
            .map_err(|error| Error::Stream(error.to_string()))?;
        if let Ok(final_url) = Url::parse(&response.get_uri().to_string()) {
            url = final_url;
        }
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        };
        let content_type = header("content-type")
            .map(|value| value.split(';').next().unwrap_or("").trim().to_lowercase())
            .unwrap_or_default();
        let metadata_interval = header("icy-metaint").and_then(|value| value.trim().parse().ok());

        let mut body = BufReader::with_capacity(1 << 16, response.into_body().into_reader());
        let start = body
            .fill_buf()
            .map_err(|error| Error::Stream(error.to_string()))?;
        if is_playlist_type(&content_type) || looks_like_text_playlist(start) {
            let mut text = String::new();
            body.take(1 << 20)
                .read_to_string(&mut text)
                .map_err(|error| Error::Stream(error.to_string()))?;
            if hls::is_playlist(&text) {
                let (reader, codec) = HlsReader::open(agent.clone(), Arc::clone(stop), url, text)?;
                return Ok(Source {
                    reader: Box::new(reader),
                    extension: Some(codec.extension()),
                });
            }
            url = first_stream(&text, &url)
                .ok_or_else(|| Error::Stream("the playlist lists no stream".to_owned()))?;
            continue;
        }
        let extension = extension_for(&content_type, &url);
        let reader: Box<dyn Read + Send> = match metadata_interval {
            Some(interval) if interval > 0 => Box::new(IcyReader::new(
                body,
                interval,
                legacy_encoding,
                Box::new(on_title),
            )),
            _ => Box::new(body),
        };
        return Ok(Source { reader, extension });
    }
    Err(Error::Stream("too many playlists in a row".to_owned()))
}

fn parse_url(url: &str) -> Result<Url> {
    Url::parse(url)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .ok_or_else(|| Error::Stream(format!("{url} is not a web address")))
}

fn is_playlist_type(content_type: &str) -> bool {
    matches!(
        content_type,
        "application/vnd.apple.mpegurl"
            | "application/x-mpegurl"
            | "audio/mpegurl"
            | "audio/x-mpegurl"
            | "audio/x-scpls"
    )
}

fn looks_like_text_playlist(start: &[u8]) -> bool {
    let start = start.strip_prefix("\u{feff}".as_bytes()).unwrap_or(start);
    start.starts_with(b"#EXTM3U") || start.starts_with(b"[playlist]")
}

/// The first stream a `.pls` or plain `.m3u` playlist names.
fn first_stream(text: &str, base: &Url) -> Option<Url> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with(['#', '[']))
        .filter_map(|line| match line.split_once('=') {
            _ if line.starts_with("http://") || line.starts_with("https://") => Some(line),
            Some((key, value)) => key.to_lowercase().starts_with("file").then(|| value.trim()),
            None => Some(line),
        })
        .find_map(|entry| base.join(entry).ok())
        .filter(|url| matches!(url.scheme(), "http" | "https"))
}

fn extension_for(content_type: &str, url: &Url) -> Option<&'static str> {
    let by_type = match content_type {
        "audio/mpeg" | "audio/mp3" | "audio/mpeg3" => Some("mp3"),
        "audio/aac" | "audio/aacp" | "audio/x-aac" => Some("aac"),
        "application/ogg" | "audio/ogg" | "audio/vorbis" => Some("ogg"),
        "audio/flac" | "audio/x-flac" => Some("flac"),
        _ => None,
    };
    by_type.or_else(|| {
        let path = url.path().to_lowercase();
        ["mp3", "aac", "ogg", "flac"]
            .into_iter()
            .find(|extension| path.ends_with(&format!(".{extension}")))
    })
}

/// Reads a SHOUTcast or Icecast stream with the metadata blocks the server
/// puts every `interval` bytes left out, reporting each new stream title.
struct IcyReader<R> {
    inner: R,
    interval: usize,
    until_metadata: usize,
    title: String,
    legacy_encoding: &'static Encoding,
    on_title: Box<dyn FnMut(String) + Send>,
}

impl<R: Read> IcyReader<R> {
    fn new(
        inner: R,
        interval: usize,
        legacy_encoding: &'static Encoding,
        on_title: Box<dyn FnMut(String) + Send>,
    ) -> Self {
        Self {
            inner,
            interval,
            until_metadata: interval,
            title: String::new(),
            legacy_encoding,
            on_title,
        }
    }

    fn read_metadata(&mut self) -> io::Result<()> {
        let mut length = [0];
        self.inner.read_exact(&mut length)?;
        let mut metadata = vec![0; usize::from(length[0]) * 16];
        self.inner.read_exact(&mut metadata)?;
        if let Some(title) = stream_title(&metadata, self.legacy_encoding)
            && title != self.title
        {
            self.title.clone_from(&title);
            (self.on_title)(title);
        }
        Ok(())
    }
}

impl<R: Read> Read for IcyReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.until_metadata == 0 {
            self.read_metadata()?;
            self.until_metadata = self.interval;
        }
        let limit = buf.len().min(self.until_metadata);
        let read = self.inner.read(&mut buf[..limit])?;
        self.until_metadata -= read;
        Ok(read)
    }
}

/// `StreamTitle` from a metadata block such as `StreamTitle='Artist - Song';`,
/// in UTF-8 or else `legacy_encoding`.
fn stream_title(metadata: &[u8], legacy_encoding: &'static Encoding) -> Option<String> {
    let metadata = metadata.split(|&byte| byte == 0).next().unwrap_or_default();
    let key = b"StreamTitle='";
    let start = metadata
        .windows(key.len())
        .position(|window| window == key)?
        + key.len();
    let rest = &metadata[start..];
    let end = rest
        .windows(2)
        .position(|window| window == b"';")
        .or_else(|| rest.iter().rposition(|&byte| byte == b'\''))
        .unwrap_or(rest.len());
    let title = match std::str::from_utf8(&rest[..end]) {
        Ok(text) => std::borrow::Cow::Borrowed(text),
        Err(_) => legacy_encoding.decode_without_bom_handling(&rest[..end]).0,
    };
    let title = unescape_html(title.trim());
    // Some servers fill an empty title in with a dash.
    let blank = title.chars().all(|c| c == '-' || c.is_whitespace());
    (!blank).then_some(title)
}

/// Some servers send the title HTML-escaped, Chinese as numeric references.
fn unescape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        match entity(rest) {
            Some((character, length)) => {
                out.push(character);
                rest = &rest[length..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The character the entity `text` starts with stands for, and the entity's length.
fn entity(text: &str) -> Option<(char, usize)> {
    let end = text.find(';').filter(|&end| end < 12)?;
    let character = match &text[1..end] {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        name => {
            let code = match name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => name.strip_prefix('#')?.parse().ok()?,
            };
            char::from_u32(code)?
        }
    };
    Some((character, end + 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn metadata_block(text: &[u8]) -> Vec<u8> {
        let blocks = text.len().div_ceil(16);
        let mut block = vec![blocks as u8];
        block.extend_from_slice(text);
        block.resize(1 + blocks * 16, 0);
        block
    }

    #[test]
    fn takes_metadata_out_of_the_stream_and_reports_titles() {
        let mut stream = b"abcd".to_vec();
        stream.extend(metadata_block(
            "StreamTitle='周杰伦 - 晴天';StreamUrl='';".as_bytes(),
        ));
        stream.extend_from_slice(b"efgh");
        stream.push(0);
        stream.extend_from_slice(b"ijkl");
        stream.extend(metadata_block("StreamTitle='周杰伦 - 晴天';".as_bytes()));

        let titles = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&titles);
        let mut reader = IcyReader::new(
            &stream[..],
            4,
            encoding_rs::GBK,
            Box::new(move |title| seen.lock().unwrap().push(title)),
        );
        let mut audio = Vec::new();
        reader.read_to_end(&mut audio).unwrap();

        assert_eq!(audio, b"abcdefghijkl");
        assert_eq!(*titles.lock().unwrap(), ["周杰伦 - 晴天"]);
    }

    #[test]
    fn decodes_titles_in_utf8_or_the_legacy_encoding() {
        let (gbk, _, _) = encoding_rs::GBK.encode("StreamTitle='新闻联播';");
        assert_eq!(
            stream_title(&gbk, encoding_rs::GBK).as_deref(),
            Some("新闻联播")
        );
        let (big5, _, _) = encoding_rs::BIG5.encode("StreamTitle='臺灣之聲';");
        assert_eq!(
            stream_title(&big5, encoding_rs::BIG5).as_deref(),
            Some("臺灣之聲")
        );
        let utf8 = "StreamTitle='晴天';".as_bytes();
        assert_eq!(
            stream_title(utf8, encoding_rs::BIG5).as_deref(),
            Some("晴天")
        );
        assert_eq!(stream_title(b"StreamTitle='';", encoding_rs::GBK), None);
        assert_eq!(stream_title(b"StreamTitle=' - ';", encoding_rs::GBK), None);
        assert_eq!(
            stream_title(b"StreamTitle='Rock 'n' Roll';", encoding_rs::GBK).as_deref(),
            Some("Rock 'n' Roll")
        );
    }

    #[test]
    fn unescapes_html_in_titles() {
        let title = b"StreamTitle='1766 Radio &#30334;&#x5BB6; - Tom &amp; Jerry & co';";
        assert_eq!(
            stream_title(title, encoding_rs::GBK).as_deref(),
            Some("1766 Radio 百家 - Tom & Jerry & co")
        );
    }

    #[test]
    fn follows_pls_and_m3u_playlists() {
        let base = Url::parse("https://example.com/listen/station.pls").unwrap();
        let pls = "[playlist]\nNumberOfEntries=1\nFile1=http://stream.example.com:8000/live\n";
        assert_eq!(
            first_stream(pls, &base).unwrap().as_str(),
            "http://stream.example.com:8000/live"
        );
        let m3u = "#EXTM3U\n#EXTINF:-1,Station\nlive.mp3\n";
        assert_eq!(
            first_stream(m3u, &base).unwrap().as_str(),
            "https://example.com/listen/live.mp3"
        );
    }

    #[test]
    fn picks_a_probe_hint_from_the_type_or_the_path() {
        let url = Url::parse("https://example.com/live.aac").unwrap();
        assert_eq!(extension_for("audio/mpeg", &url), Some("mp3"));
        assert_eq!(extension_for("application/octet-stream", &url), Some("aac"));
    }
}
