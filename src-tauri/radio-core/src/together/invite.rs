//! An invite to a room: its topic and how to reach the listener who gave it.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use iroh::{EndpointAddr, TransportAddr};
use iroh_gossip::TopicId;
use qrcode::{Color, QrCode};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const PREFIX: &str = "moxia:";
/// Enough of the inviter's addresses to reach them, few enough to keep the QR code scannable.
const MOST_ADDRS: usize = 6;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Invite {
    pub topic: TopicId,
    pub host: EndpointAddr,
}

impl Invite {
    pub fn new(topic: TopicId, mut host: EndpointAddr) -> Self {
        host.addrs = host
            .addrs
            .into_iter()
            .filter(|addr| matches!(addr, TransportAddr::Relay(_) | TransportAddr::Ip(_)))
            .take(MOST_ADDRS)
            .collect();
        Self { topic, host }
    }

    pub fn encode(&self) -> String {
        let json = serde_json::to_vec(self).expect("an invite serializes");
        format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(json))
    }

    pub fn decode(text: &str) -> Result<Self> {
        let refused = || Error::Refused("That is not a Moxia invite".into());
        let encoded = text.trim().strip_prefix(PREFIX).ok_or_else(refused)?;
        let json = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| refused())?;
        serde_json::from_slice(&json).map_err(|_| refused())
    }
}

/// An invite as text to copy and as a QR code to scan.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteCode {
    pub text: String,
    pub qr: Qr,
}

/// A QR code's modules, `width` to a row, row after row: `1` dark, `0` light.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Qr {
    pub width: usize,
    pub modules: String,
}

impl InviteCode {
    pub fn new(invite: &Invite) -> Result<Self> {
        let text = invite.encode();
        let code = QrCode::new(&text)
            .map_err(|error| Error::Refused(format!("Could not draw the invite: {error}")))?;
        let modules = code
            .to_colors()
            .into_iter()
            .map(|color| if color == Color::Dark { '1' } else { '0' })
            .collect();
        Ok(Self {
            text,
            qr: Qr {
                width: code.width(),
                modules,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use iroh::SecretKey;

    use super::*;

    fn invite() -> Invite {
        let addrs = (0..10)
            .map(|port| TransportAddr::Ip(SocketAddr::from(([192, 168, 1, 2], 4000 + port))));
        Invite::new(
            TopicId::from_bytes([7; 32]),
            EndpointAddr {
                id: SecretKey::generate().public(),
                addrs: addrs
                    .chain([TransportAddr::Relay(
                        "https://relay.example.com".parse().unwrap(),
                    )])
                    .collect(),
            },
        )
    }

    #[test]
    fn reads_back_what_it_wrote() {
        let invite = invite();
        assert_eq!(Invite::decode(&invite.encode()).unwrap(), invite);
    }

    #[test]
    fn keeps_only_a_few_addresses() {
        assert_eq!(invite().host.addrs.len(), MOST_ADDRS);
    }

    #[test]
    fn ignores_space_around_a_pasted_invite() {
        let invite = invite();
        let pasted = format!("  {}\n", invite.encode());
        assert_eq!(Invite::decode(&pasted).unwrap(), invite);
    }

    #[test]
    fn refuses_anything_else() {
        for text in ["", "hello", "moxia:", "moxia:!!!", "moxia:e30"] {
            assert!(Invite::decode(text).is_err(), "{text}");
        }
    }

    #[test]
    fn draws_a_square_code() {
        let code = InviteCode::new(&invite()).unwrap();
        assert_eq!(code.qr.modules.len(), code.qr.width * code.qr.width);
        assert!(code.text.starts_with(PREFIX));
    }
}
