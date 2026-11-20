//! The script subtitles are written in. SenseVoice writes simplified Chinese
//! whatever it hears; traditional is converted from it by OpenCC's rules, in
//! Taiwan's standard forms (裡) or Hong Kong's (裏), leaving the words as they
//! were said.

use std::sync::LazyLock;

use ferrous_opencc::OpenCC;
use ferrous_opencc::config::BuiltinConfig;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Script {
    #[default]
    Simplified,
    Taiwan,
    HongKong,
}

static TO_TAIWAN: LazyLock<Option<OpenCC>> = LazyLock::new(|| converter(BuiltinConfig::S2tw));
static TO_HONG_KONG: LazyLock<Option<OpenCC>> = LazyLock::new(|| converter(BuiltinConfig::S2hk));

fn converter(config: BuiltinConfig) -> Option<OpenCC> {
    OpenCC::from_config(config)
        .inspect_err(|error| log::error!("Could not load the {config:?} converter: {error}"))
        .ok()
}

impl Script {
    /// `simplified` in this script; left simplified if the converter will not load.
    pub fn write(self, simplified: String) -> String {
        let converter = match self {
            Self::Simplified => return simplified,
            Self::Taiwan => TO_TAIWAN.as_ref(),
            Self::HongKong => TO_HONG_KONG.as_ref(),
        };
        match converter {
            Some(converter) => converter.convert(&simplified),
            None => simplified,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAID: &str = "这里为听众播放新闻";

    #[test]
    fn writes_taiwan_forms() {
        assert_eq!(Script::Taiwan.write(SAID.to_owned()), "這裡為聽眾播放新聞");
    }

    #[test]
    fn writes_hong_kong_forms() {
        assert_eq!(
            Script::HongKong.write(SAID.to_owned()),
            "這裏為聽眾播放新聞"
        );
    }

    #[test]
    fn leaves_simplified_as_it_is() {
        assert_eq!(Script::Simplified.write(SAID.to_owned()), SAID);
    }

    #[test]
    fn serializes_with_the_frontend_names() {
        assert_eq!(
            serde_json::to_value(Script::HongKong).unwrap(),
            serde_json::json!("hongKong")
        );
    }
}
