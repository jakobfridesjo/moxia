//! What kind of station it is. radio-browser has no categories, only tags
//! anyone may write, so a station's are read out of its tags and its name.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Music,
    News,
    Talk,
    Traffic,
    FullService,
}

/// What a tag or name holds, in lower case, when the station is of a category.
const KEYWORDS: [(Category, &[&str]); 5] = [
    (
        Category::Music,
        &[
            "music",
            "pop",
            "rock",
            "oldies",
            "hits",
            "top 40",
            "top40",
            "classical",
            "jazz",
            "opera",
            "folk",
            "electronic",
            "edm",
            "dance",
            "hip hop",
            "r&b",
            "easy listening",
            "音乐",
            "音樂",
            "戏曲",
            "戲曲",
        ],
    ),
    (
        Category::News,
        &[
            "news",
            "information",
            "econom",
            "business",
            "financ",
            "新闻",
            "新聞",
            "资讯",
            "資訊",
            "财经",
            "財經",
            "经济",
            "經濟",
        ],
    ),
    (
        Category::Talk,
        &[
            "talk",
            "spoken",
            "story",
            "literature",
            "culture",
            "lifestyle",
            "entertainment",
            "educat",
            "children",
            "sport",
            "religio",
            "christian",
            "catholic",
            "buddhis",
            "podcast",
            "相声",
            "相聲",
            "故事",
            "评书",
            "評書",
            "文艺",
            "文藝",
            "生活",
        ],
    ),
    (Category::Traffic, TRAFFIC),
    (
        Category::FullService,
        &[
            "full service",
            "public radio",
            "variety",
            "general",
            "综合",
            "綜合",
        ],
    ),
];

const TRAFFIC: &[&str] = &["traffic", "交通"];

/// The categories `tags` and `name` put a station in, in the order of
/// [`Category`]; none when they say nothing.
pub fn categories(tags: &[String], name: &str) -> Vec<Category> {
    let texts: Vec<String> = tags
        .iter()
        .map(String::as_str)
        .chain([name])
        .map(str::to_lowercase)
        .collect();
    KEYWORDS
        .iter()
        .filter(|(category, keywords)| texts.iter().any(|text| says(text, *category, keywords)))
        .map(|&(category, _)| category)
        .collect()
}

/// A text about traffic says only that: "traffic information" is not news.
fn says(text: &str, category: Category, keywords: &[&str]) -> bool {
    let holds = |words: &[&str]| words.iter().any(|word| text.contains(word));
    holds(keywords) && (category == Category::Traffic || !holds(TRAFFIC))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn of(tags: &[&str], name: &str) -> Vec<Category> {
        let tags: Vec<String> = tags.iter().map(|&tag| tag.to_owned()).collect();
        categories(&tags, name)
    }

    #[test]
    fn reads_categories_from_tags_in_either_language() {
        assert_eq!(of(&["Pop Music"], "FM 97.4"), [Category::Music]);
        assert_eq!(
            of(&["新聞", "full service"], "FM 97.4"),
            [Category::News, Category::FullService]
        );
        assert_eq!(of(&["storytelling"], "FM 97.4"), [Category::Talk]);
    }

    #[test]
    fn reads_the_name_of_an_untagged_station() {
        assert_eq!(of(&[], "北京音乐广播"), [Category::Music]);
        assert_eq!(
            of(&[], "新闻综合广播"),
            [Category::News, Category::FullService]
        );
        assert_eq!(of(&[], "FM 97.4"), []);
    }

    #[test]
    fn takes_traffic_information_for_traffic_alone() {
        assert_eq!(of(&["traffic information"], "FM 97.4"), [Category::Traffic]);
        assert_eq!(
            of(&["local traffic & weather"], "交通广播"),
            [Category::Traffic]
        );
        assert_eq!(
            of(&["traffic", "news"], "FM 97.4"),
            [Category::News, Category::Traffic]
        );
    }

    #[test]
    fn serializes_as_the_frontend_names_them() {
        assert_eq!(
            serde_json::to_value([Category::Music, Category::FullService]).unwrap(),
            serde_json::json!(["music", "fullService"])
        );
    }
}
