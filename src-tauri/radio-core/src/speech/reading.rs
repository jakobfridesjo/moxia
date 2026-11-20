//! How each character of a subtitle is read, written small beside it: pinyin,
//! or zhuyin (bopomofo) as Taiwan teaches it. Readings come from pinyin-pro's
//! dictionaries by whole words, with 一 and 不 changing tone as they are said.

use pinyin_pro::options::{NonZh, PinyinOptions, PinyinOutput, ToneType, TypeMode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Reading {
    #[default]
    None,
    Pinyin,
    Zhuyin,
}

impl Reading {
    /// How each character of `simplified` is read, one for each; empty for
    /// what is not Chinese, and all empty for `None`.
    pub fn of(self, simplified: &str) -> Vec<String> {
        let length = simplified.chars().count();
        if self == Self::None {
            return vec![String::new(); length];
        }
        let options = PinyinOptions {
            type_mode: TypeMode::All,
            tone_type: ToneType::Symbol,
            non_zh: NonZh::Spaced,
            ..PinyinOptions::default()
        };
        let PinyinOutput::All(read) = pinyin_pro::pinyin::pinyin(simplified, options) else {
            return vec![String::new(); length];
        };
        let mut readings = Vec::with_capacity(length);
        for each in read {
            let pinyin = (each.is_zh && each.origin.chars().count() == 1).then(|| match self {
                Self::Zhuyin => zhuyin(&each.pinyin, each.num),
                _ => each.pinyin.clone(),
            });
            match pinyin {
                Some(reading) => readings.push(reading),
                None => readings.extend(each.origin.chars().map(|_| String::new())),
            }
        }
        // Should the dictionary ever split the text otherwise, nothing is better than misplaced readings.
        if readings.len() == length {
            readings
        } else {
            vec![String::new(); length]
        }
    }
}

const INITIALS: [(&str, &str); 21] = [
    ("zh", "ㄓ"),
    ("ch", "ㄔ"),
    ("sh", "ㄕ"),
    ("b", "ㄅ"),
    ("p", "ㄆ"),
    ("m", "ㄇ"),
    ("f", "ㄈ"),
    ("d", "ㄉ"),
    ("t", "ㄊ"),
    ("n", "ㄋ"),
    ("l", "ㄌ"),
    ("g", "ㄍ"),
    ("k", "ㄎ"),
    ("h", "ㄏ"),
    ("j", "ㄐ"),
    ("q", "ㄑ"),
    ("x", "ㄒ"),
    ("r", "ㄖ"),
    ("z", "ㄗ"),
    ("c", "ㄘ"),
    ("s", "ㄙ"),
];

const FINALS: [(&str, &str); 37] = [
    ("iang", "ㄧㄤ"),
    ("iong", "ㄩㄥ"),
    ("uang", "ㄨㄤ"),
    ("ueng", "ㄨㄥ"),
    ("iao", "ㄧㄠ"),
    ("ian", "ㄧㄢ"),
    ("ing", "ㄧㄥ"),
    ("uai", "ㄨㄞ"),
    ("uan", "ㄨㄢ"),
    ("üan", "ㄩㄢ"),
    ("ang", "ㄤ"),
    ("eng", "ㄥ"),
    ("ong", "ㄨㄥ"),
    ("iou", "ㄧㄡ"),
    ("uei", "ㄨㄟ"),
    ("uen", "ㄨㄣ"),
    ("ai", "ㄞ"),
    ("ei", "ㄟ"),
    ("ao", "ㄠ"),
    ("ou", "ㄡ"),
    ("an", "ㄢ"),
    ("en", "ㄣ"),
    ("er", "ㄦ"),
    ("ia", "ㄧㄚ"),
    ("ie", "ㄧㄝ"),
    ("in", "ㄧㄣ"),
    ("io", "ㄧㄛ"),
    ("ua", "ㄨㄚ"),
    ("uo", "ㄨㄛ"),
    ("üe", "ㄩㄝ"),
    ("ün", "ㄩㄣ"),
    ("a", "ㄚ"),
    ("o", "ㄛ"),
    ("e", "ㄜ"),
    ("i", "ㄧ"),
    ("u", "ㄨ"),
    ("ü", "ㄩ"),
];

/// `pinyin` (with or without tone marks) in tone `tone` (0 for the neutral tone) as zhuyin.
fn zhuyin(pinyin: &str, tone: i64) -> String {
    let plain: String = pinyin.chars().map(untoned).collect();
    let syllable = spelled_out(&plain);
    let (initial, rime) = INITIALS
        .iter()
        .find(|(spelled, _)| syllable.starts_with(spelled))
        .map_or(("", syllable.as_str()), |(spelled, symbol)| {
            (*symbol, &syllable[spelled.len()..])
        });
    // After j, q and x a written u is ü.
    let rime = if matches!(initial, "ㄐ" | "ㄑ" | "ㄒ") && rime.starts_with('u') {
        rime.replacen('u', "ü", 1)
    } else {
        rime.to_owned()
    };
    // zhi, chi, shi, ri, zi, ci and si end on their initial alone.
    let buzzed = matches!(initial, "ㄓ" | "ㄔ" | "ㄕ" | "ㄖ" | "ㄗ" | "ㄘ" | "ㄙ") && rime == "i";
    let ending = if buzzed {
        ""
    } else {
        FINALS
            .iter()
            .find(|(spelled, _)| *spelled == rime)
            .map_or("", |(_, symbol)| *symbol)
    };
    if initial.is_empty() && ending.is_empty() {
        return String::new();
    }
    match tone {
        0 => format!("˙{initial}{ending}"),
        2 => format!("{initial}{ending}ˊ"),
        3 => format!("{initial}{ending}ˇ"),
        4 => format!("{initial}{ending}ˋ"),
        _ => format!("{initial}{ending}"),
    }
}

/// The syllable with y and w spelled out as the vowels they stand for, and iu, ui and un in full.
fn spelled_out(plain: &str) -> String {
    let full = match plain {
        "yi" => "i".to_owned(),
        "yin" => "in".to_owned(),
        "ying" => "ing".to_owned(),
        "yu" | "yue" | "yuan" | "yun" => format!("ü{}", &plain[2..]),
        "wu" => "u".to_owned(),
        _ if plain.starts_with('y') => format!("i{}", &plain[1..]),
        _ if plain.starts_with('w') => format!("u{}", &plain[1..]),
        _ => plain.to_owned(),
    };
    if full.ends_with("iu") {
        format!("{}ou", &full[..full.len() - 1])
    } else if full.ends_with("ui") {
        format!("{}ei", &full[..full.len() - 1])
    } else if full.ends_with("un") && !full.ends_with("ün") {
        let stem = &full[..full.len() - 2];
        // j, q and x take ün, written un.
        if stem.ends_with(['j', 'q', 'x']) {
            format!("{stem}ün")
        } else {
            format!("{stem}uen")
        }
    } else {
        full
    }
}

/// `c` without its tone mark; ü keeps its dots.
fn untoned(c: char) -> char {
    match c {
        'ā' | 'á' | 'ǎ' | 'à' => 'a',
        'ē' | 'é' | 'ě' | 'è' => 'e',
        'ī' | 'í' | 'ǐ' | 'ì' => 'i',
        'ō' | 'ó' | 'ǒ' | 'ò' => 'o',
        'ū' | 'ú' | 'ǔ' | 'ù' => 'u',
        'ǖ' | 'ǘ' | 'ǚ' | 'ǜ' | 'v' => 'ü',
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_each_character_by_the_word_it_is_in() {
        assert_eq!(
            Reading::Pinyin.of("银行行长"),
            ["yín", "háng", "háng", "zhǎng"]
        );
        assert_eq!(Reading::Pinyin.of("长大"), ["zhǎng", "dà"]);
    }

    #[test]
    fn leaves_what_is_not_chinese_unread() {
        assert_eq!(
            Reading::Pinyin.of("FM 新闻。"),
            ["", "", "", "xīn", "wén", ""]
        );
        assert_eq!(Reading::None.of("新闻"), ["", ""]);
    }

    #[test]
    fn writes_zhuyin_as_taiwan_teaches_it() {
        assert_eq!(
            Reading::Zhuyin.of("这里是新闻"),
            ["ㄓㄜˋ", "ㄌㄧˇ", "ㄕˋ", "ㄒㄧㄣ", "ㄨㄣˊ"]
        );
        assert_eq!(
            Reading::Zhuyin.of("我们去学校"),
            ["ㄨㄛˇ", "˙ㄇㄣ", "ㄑㄩˋ", "ㄒㄩㄝˊ", "ㄒㄧㄠˋ"]
        );
        assert_eq!(
            Reading::Zhuyin.of("有用的音乐"),
            ["ㄧㄡˇ", "ㄩㄥˋ", "˙ㄉㄜ", "ㄧㄣ", "ㄩㄝˋ"]
        );
        assert_eq!(
            Reading::Zhuyin.of("对准会员"),
            ["ㄉㄨㄟˋ", "ㄓㄨㄣˇ", "ㄏㄨㄟˋ", "ㄩㄢˊ"]
        );
        assert_eq!(
            Reading::Zhuyin.of("中国人儿"),
            ["ㄓㄨㄥ", "ㄍㄨㄛˊ", "ㄖㄣˊ", "ㄦˊ"]
        );
    }

    #[test]
    fn serializes_with_the_frontend_names() {
        assert_eq!(
            serde_json::to_value(Reading::Zhuyin).unwrap(),
            serde_json::json!("zhuyin")
        );
    }
}
