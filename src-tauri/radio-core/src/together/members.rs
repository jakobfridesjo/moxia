//! Who is in a room and what it listens to, as one peer sees it.

use std::collections::HashMap;

use iroh::PublicKey;
use serde::Serialize;

use super::wire::Note;
use crate::station::Station;

/// What the frontend hears from a room.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RoomEvent {
    /// How many are in the room, counting this listener.
    Listeners {
        count: usize,
    },
    Joined {
        name: String,
    },
    Left {
        name: String,
    },
    Said {
        name: String,
        text: String,
    },
    /// Someone changed station, or this listener just joined a room listening to `station`.
    Tuned {
        name: String,
        station: Box<Station>,
    },
    /// The room cannot be reached any more.
    Closed,
}

/// What hearing something leads to.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    Tell(RoomEvent),
    Answer(Note),
}

pub struct Members {
    me: String,
    names: HashMap<PublicKey, String>,
    on_air: Option<Station>,
    /// Whether this listener follows the room yet: one who joins takes the first station heard.
    following: bool,
}

impl Members {
    /// For the listener who opened the room, whom the others follow from the start.
    pub fn opened(me: String) -> Self {
        Self {
            me,
            names: HashMap::new(),
            on_air: None,
            following: true,
        }
    }

    /// For a listener joining a room already listening to something.
    pub fn joining(me: String) -> Self {
        Self {
            following: false,
            ..Self::opened(me)
        }
    }

    pub fn me(&self) -> &str {
        &self.me
    }

    pub fn count(&self) -> usize {
        self.names.len() + 1
    }

    /// This listener changed station. Whether to tell the others: not before following the
    /// room, or someone just joining would retune everyone to what they played alone.
    pub fn tune(&mut self, station: Station) -> bool {
        if self.following {
            self.on_air = Some(station);
        }
        self.following
    }

    fn follow(&mut self, station: Station) {
        self.on_air = Some(station);
        self.following = true;
    }

    pub fn heard(&mut self, from: PublicKey, note: Note) -> Vec<Outcome> {
        let mut outcomes = Vec::new();
        let name = match &note {
            Note::Hello { name }
            | Note::Here { name, .. }
            | Note::Tune { name, .. }
            | Note::Say { name, .. }
            | Note::Bye { name } => name.clone(),
        };
        if matches!(note, Note::Bye { .. }) {
            return self.gone(from);
        }
        let new = self.names.insert(from, name.clone()).is_none();
        if new && matches!(note, Note::Hello { .. }) {
            outcomes.push(Outcome::Tell(RoomEvent::Joined { name: name.clone() }));
        }
        match note {
            Note::Hello { .. } => outcomes.push(Outcome::Answer(Note::Here {
                name: self.me.clone(),
                station: self.on_air.clone().map(Box::new),
            })),
            Note::Here {
                station: Some(station),
                ..
            } if !self.following => {
                self.follow(*station.clone());
                outcomes.push(Outcome::Tell(RoomEvent::Tuned { name, station }));
            }
            // A room with nothing on air has nothing to follow.
            Note::Here { station: None, .. } => self.following = true,
            Note::Here { .. } | Note::Bye { .. } => {}
            Note::Tune { station, .. } => {
                self.follow(*station.clone());
                outcomes.push(Outcome::Tell(RoomEvent::Tuned { name, station }));
            }
            Note::Say { text, .. } => outcomes.push(Outcome::Tell(RoomEvent::Said { name, text })),
        }
        // Counted last, so one who just joined has heard what the room listens to by then.
        if new {
            outcomes.push(Outcome::Tell(RoomEvent::Listeners {
                count: self.count(),
            }));
        }
        outcomes
    }

    /// `who` left, or their connection dropped.
    pub fn gone(&mut self, who: PublicKey) -> Vec<Outcome> {
        let Some(name) = self.names.remove(&who) else {
            return Vec::new();
        };
        vec![
            Outcome::Tell(RoomEvent::Left { name }),
            Outcome::Tell(RoomEvent::Listeners {
                count: self.count(),
            }),
        ]
    }
}

#[cfg(test)]
mod tests {
    use iroh::SecretKey;

    use super::*;
    use crate::station::station;

    fn someone() -> PublicKey {
        SecretKey::generate().public()
    }

    fn told(outcomes: &[Outcome]) -> Vec<&RoomEvent> {
        outcomes
            .iter()
            .filter_map(|outcome| match outcome {
                Outcome::Tell(event) => Some(event),
                Outcome::Answer(_) => None,
            })
            .collect()
    }

    #[test]
    fn greets_a_newcomer_with_the_station_on_air() {
        let mut room = Members::opened("Lin".into());
        assert!(room.tune(station("a", 1)));
        let outcomes = room.heard(someone(), Note::Hello { name: "Mei".into() });
        assert_eq!(
            outcomes,
            [
                Outcome::Tell(RoomEvent::Joined { name: "Mei".into() }),
                Outcome::Answer(Note::Here {
                    name: "Lin".into(),
                    station: Some(Box::new(station("a", 1))),
                }),
                Outcome::Tell(RoomEvent::Listeners { count: 2 }),
            ]
        );
    }

    #[test]
    fn a_newcomer_follows_the_first_station_it_hears_of_and_no_later_greeting() {
        let mut room = Members::joining("Mei".into());
        let first = room.heard(
            someone(),
            Note::Here {
                name: "Lin".into(),
                station: Some(Box::new(station("a", 1))),
            },
        );
        assert_eq!(
            told(&first),
            [
                &RoomEvent::Tuned {
                    name: "Lin".into(),
                    station: Box::new(station("a", 1)),
                },
                &RoomEvent::Listeners { count: 2 },
            ],
            "tuned before counted, and no greeting"
        );
        let second = room.heard(
            someone(),
            Note::Here {
                name: "Ana".into(),
                station: Some(Box::new(station("b", 1))),
            },
        );
        assert_eq!(told(&second), [&RoomEvent::Listeners { count: 3 }]);
    }

    #[test]
    fn a_newcomer_keeps_its_station_to_itself_until_it_follows_the_room() {
        let mut room = Members::joining("Mei".into());
        assert!(!room.tune(station("x", 1)));
        room.heard(
            someone(),
            Note::Here {
                name: "Lin".into(),
                station: None,
            },
        );
        assert!(room.tune(station("x", 1)));
    }

    #[test]
    fn the_opener_is_not_retuned_by_a_greeting() {
        let mut room = Members::opened("Lin".into());
        let outcomes = room.heard(
            someone(),
            Note::Here {
                name: "Mei".into(),
                station: Some(Box::new(station("b", 1))),
            },
        );
        assert_eq!(told(&outcomes), [&RoomEvent::Listeners { count: 2 }]);
    }

    #[test]
    fn follows_a_change_of_station_and_passes_on_chat() {
        let mut room = Members::opened("Lin".into());
        let mei = someone();
        room.heard(mei, Note::Hello { name: "Mei".into() });
        let tuned = room.heard(
            mei,
            Note::Tune {
                name: "Mei".into(),
                station: Box::new(station("c", 1)),
            },
        );
        assert_eq!(
            told(&tuned),
            [&RoomEvent::Tuned {
                name: "Mei".into(),
                station: Box::new(station("c", 1)),
            }]
        );
        let said = room.heard(
            mei,
            Note::Say {
                name: "Mei".into(),
                text: "你好".into(),
            },
        );
        assert_eq!(
            told(&said),
            [&RoomEvent::Said {
                name: "Mei".into(),
                text: "你好".into(),
            }]
        );
    }

    #[test]
    fn counts_someone_out_once_whether_they_said_bye_or_dropped() {
        let mut room = Members::opened("Lin".into());
        let mei = someone();
        room.heard(mei, Note::Hello { name: "Mei".into() });
        let left = room.heard(mei, Note::Bye { name: "Mei".into() });
        assert_eq!(
            told(&left),
            [
                &RoomEvent::Left { name: "Mei".into() },
                &RoomEvent::Listeners { count: 1 },
            ]
        );
        assert!(room.gone(mei).is_empty());
    }
}
