//! What peers in a room say to each other. Gossip neither signs messages nor names their author,
//! so each one carries its sender's key and a signature over the rest.

use iroh::{PublicKey, SecretKey, Signature};
use serde::{Deserialize, Serialize};

use crate::station::Station;

/// The longest name a listener goes by, in characters.
pub const NAME_CHARS: usize = 40;
/// The longest chat message, in characters.
pub const TEXT_CHARS: usize = 500;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Note {
    /// Sent once on joining; everyone already there answers with `Here`.
    Hello {
        name: String,
    },
    /// Who is in the room, and what they listen to, for someone who just joined.
    Here {
        name: String,
        station: Option<Box<Station>>,
    },
    /// The sender changed station; everyone follows.
    Tune {
        name: String,
        station: Box<Station>,
    },
    Say {
        name: String,
        text: String,
    },
    /// Sent on leaving, so the others need not wait for the connection to drop.
    Bye {
        name: String,
    },
}

#[derive(Serialize, Deserialize)]
struct Body {
    /// Counts the sender's messages: gossip drops a message identical to one it has seen.
    seq: u64,
    note: Note,
}

/// `note`, signed by `key`, as it goes on the wire.
pub fn seal(key: &SecretKey, seq: u64, note: Note) -> Vec<u8> {
    let body = serde_json::to_vec(&Body { seq, note }).expect("a note serializes");
    let mut sealed = Vec::with_capacity(32 + Signature::LENGTH + body.len());
    sealed.extend_from_slice(key.public().as_bytes());
    sealed.extend_from_slice(&key.sign(&body).to_bytes());
    sealed.extend_from_slice(&body);
    sealed
}

/// Who sent `bytes` and what they said; `None` for anything unsigned, forged or unreadable.
pub fn open(bytes: &[u8]) -> Option<(PublicKey, Note)> {
    let (key, rest) = bytes.split_first_chunk::<32>()?;
    let (signature, body) = rest.split_first_chunk::<{ Signature::LENGTH }>()?;
    let sender = PublicKey::from_bytes(key).ok()?;
    sender
        .verify(body, &Signature::from_bytes(signature))
        .ok()?;
    let body: Body = serde_json::from_slice(body).ok()?;
    Some((sender, tidy(body.note)?))
}

/// `note` with its name and text cut to length; `None` when one is left empty.
fn tidy(note: Note) -> Option<Note> {
    let cut = |text: String, limit: usize| {
        let text: String = text.trim().chars().take(limit).collect();
        (!text.is_empty()).then_some(text)
    };
    Some(match note {
        Note::Hello { name } => Note::Hello {
            name: cut(name, NAME_CHARS)?,
        },
        Note::Here { name, station } => Note::Here {
            name: cut(name, NAME_CHARS)?,
            station,
        },
        Note::Tune { name, station } => Note::Tune {
            name: cut(name, NAME_CHARS)?,
            station,
        },
        Note::Say { name, text } => Note::Say {
            name: cut(name, NAME_CHARS)?,
            text: cut(text, TEXT_CHARS)?,
        },
        Note::Bye { name } => Note::Bye {
            name: cut(name, NAME_CHARS)?,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello(name: &str) -> Note {
        Note::Hello { name: name.into() }
    }

    #[test]
    fn opens_what_it_sealed_with_the_sender() {
        let key = SecretKey::generate();
        let (sender, note) = open(&seal(&key, 1, hello("Mei"))).unwrap();
        assert_eq!(sender, key.public());
        assert_eq!(note, hello("Mei"));
    }

    #[test]
    fn refuses_a_changed_message() {
        let mut sealed = seal(&SecretKey::generate(), 1, hello("Mei"));
        let last = sealed.len() - 3;
        sealed[last] ^= 1;
        assert!(open(&sealed).is_none());
    }

    #[test]
    fn refuses_a_message_signed_by_someone_else() {
        let mut sealed = seal(&SecretKey::generate(), 1, hello("Mei"));
        sealed[..32].copy_from_slice(SecretKey::generate().public().as_bytes());
        assert!(open(&sealed).is_none());
    }

    #[test]
    fn refuses_scraps() {
        assert!(open(&[]).is_none());
        assert!(open(&[0; 40]).is_none());
    }

    #[test]
    fn differs_for_the_same_note_sent_twice() {
        let key = SecretKey::generate();
        assert_ne!(seal(&key, 1, hello("Mei")), seal(&key, 2, hello("Mei")));
    }

    #[test]
    fn trims_names_and_text_and_refuses_empty_ones() {
        let key = SecretKey::generate();
        let long = "长".repeat(TEXT_CHARS + 10);
        let said = Note::Say {
            name: "  Mei ".into(),
            text: long,
        };
        let Some((_, Note::Say { name, text })) = open(&seal(&key, 1, said)) else {
            panic!("a long message opens");
        };
        assert_eq!(name, "Mei");
        assert_eq!(text.chars().count(), TEXT_CHARS);
        assert!(open(&seal(&key, 2, hello("   "))).is_none());
    }
}
