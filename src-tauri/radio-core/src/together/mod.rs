//! Listening together: a room of listeners who follow one another's station and chat. Each plays
//! the stream itself; the room only carries short signed notes, gossiped peer to peer over iroh,
//! which dials by public key, punches through NATs and falls back to n0's public relays.

mod invite;
mod members;
mod wire;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use iroh::address_lookup::memory::MemoryLookup;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, SecretKey};
use iroh_gossip::api::{Event, GossipReceiver, GossipSender};
use iroh_gossip::{Gossip, TopicId};
use n0_future::StreamExt;
use tokio::task::JoinHandle;

pub use invite::{InviteCode, Qr};
pub use members::RoomEvent;

use crate::error::{Error, Result};
use crate::station::Station;
use invite::Invite;
use members::{Members, Outcome};
use wire::{NAME_CHARS, Note, TEXT_CHARS};

/// How long opening a room waits to reach a relay, so the invite works beyond the local network.
const ONLINE_WAIT: Duration = Duration::from_secs(8);
/// How long joining waits for the one who sent the invite.
const JOIN_WAIT: Duration = Duration::from_secs(30);
/// How long leaving waits for the goodbye to go out.
const BYE_WAIT: Duration = Duration::from_secs(1);

/// The room this listener is in, if any: one at a time.
#[derive(Default)]
pub struct Together {
    room: tokio::sync::Mutex<Option<Room>>,
}

struct Room {
    router: Router,
    voice: Arc<Voice>,
    members: Arc<Mutex<Members>>,
    listening: JoinHandle<()>,
}

/// Signs and sends this listener's notes.
struct Voice {
    key: SecretKey,
    sender: GossipSender,
    sent: AtomicU64,
}

impl Voice {
    async fn say(&self, note: Note) -> Result<()> {
        let seq = self.sent.fetch_add(1, Ordering::Relaxed);
        self.sender
            .broadcast(wire::seal(&self.key, seq, note).into())
            .await
            .map_err(network)
    }
}

fn network(error: impl std::fmt::Display) -> Error {
    Error::Together(error.to_string())
}

/// `name` trimmed and cut to length, refused when empty.
fn listener_name(name: &str) -> Result<String> {
    let name: String = name.trim().chars().take(NAME_CHARS).collect();
    if name.is_empty() {
        return Err(Error::Refused("Choose a name to listen together".into()));
    }
    Ok(name)
}

fn lock(members: &Mutex<Members>) -> std::sync::MutexGuard<'_, Members> {
    members.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A fresh endpoint with gossip on it; `lookup` knows addresses learned from an invite.
async fn connect(lookup: Option<MemoryLookup>) -> Result<(Endpoint, Gossip, Router)> {
    let mut builder = Endpoint::builder(presets::N0);
    if let Some(lookup) = lookup {
        builder = builder.address_lookup(lookup);
    }
    let endpoint = builder.bind().await.map_err(network)?;
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone())
        .accept(iroh_gossip::ALPN, gossip.clone())
        .spawn();
    Ok((endpoint, gossip, router))
}

impl Together {
    /// Opens a new room as `name`, leaving any other, and returns its invite.
    pub async fn open(
        &self,
        name: &str,
        on_event: impl Fn(RoomEvent) + Send + Sync + 'static,
    ) -> Result<InviteCode> {
        let name = listener_name(name)?;
        self.leave().await;
        let mut topic = [0; 32];
        getrandom::fill(&mut topic).map_err(network)?;
        let topic = TopicId::from_bytes(topic);
        let (endpoint, gossip, router) = connect(None).await?;
        if tokio::time::timeout(ONLINE_WAIT, endpoint.online())
            .await
            .is_err()
        {
            log::info!("No relay reached; the invite works on the local network only");
        }
        let (sender, receiver) = gossip
            .subscribe(topic, Vec::new())
            .await
            .map_err(network)?
            .split();
        let code = InviteCode::new(&Invite::new(topic, endpoint.addr()))?;
        let room = Room::start(
            &endpoint,
            router,
            sender,
            receiver,
            Members::opened(name),
            on_event,
        );
        *self.room.lock().await = Some(room);
        Ok(code)
    }

    /// Joins the room `invite` leads to as `name`, leaving any other, and returns an invite to
    /// pass on. Fails when no one in it answers in time.
    pub async fn join(
        &self,
        invite: &str,
        name: &str,
        on_event: impl Fn(RoomEvent) + Send + Sync + 'static,
    ) -> Result<InviteCode> {
        let invite = Invite::decode(invite)?;
        let name = listener_name(name)?;
        self.leave().await;
        let lookup = MemoryLookup::new();
        lookup.add_endpoint_info(invite.host.clone());
        let (endpoint, gossip, router) = connect(Some(lookup)).await?;
        let joined = tokio::time::timeout(
            JOIN_WAIT,
            gossip.subscribe_and_join(invite.topic, vec![invite.host.id]),
        )
        .await;
        let topic = match joined {
            Ok(Ok(topic)) => topic,
            Ok(Err(error)) => {
                router.shutdown().await.ok();
                return Err(network(error));
            }
            Err(_) => {
                router.shutdown().await.ok();
                return Err(Error::Refused(
                    "No one answered the invite. Ask for a new one if they have left.".into(),
                ));
            }
        };
        let (sender, receiver) = topic.split();
        let code = InviteCode::new(&Invite::new(invite.topic, endpoint.addr()))?;
        let room = Room::start(
            &endpoint,
            router,
            sender,
            receiver,
            Members::joining(name.clone()),
            on_event,
        );
        let voice = Arc::clone(&room.voice);
        *self.room.lock().await = Some(room);
        voice.say(Note::Hello { name }).await?;
        Ok(code)
    }

    /// Sends `text` to everyone else in the room.
    pub async fn say(&self, text: &str) -> Result<()> {
        let text: String = text.trim().chars().take(TEXT_CHARS).collect();
        if text.is_empty() {
            return Ok(());
        }
        let (voice, name) = self.speaking().await?;
        voice.say(Note::Say { name, text }).await
    }

    /// Tells the room this listener changed to `station`, so everyone follows; kept quiet by one
    /// who just joined until they hear what the room listens to.
    pub async fn tune(&self, station: Station) -> Result<()> {
        let (voice, name) = {
            let room = self.room.lock().await;
            let room = room.as_ref().ok_or_else(not_in_a_room)?;
            let mut members = lock(&room.members);
            if !members.tune(station.clone()) {
                return Ok(());
            }
            (Arc::clone(&room.voice), members.me().to_owned())
        };
        voice
            .say(Note::Tune {
                name,
                station: Box::new(station),
            })
            .await
    }

    /// Says goodbye and leaves the room, if in one.
    pub async fn leave(&self) {
        let Some(room) = self.room.lock().await.take() else {
            return;
        };
        let name = lock(&room.members).me().to_owned();
        let _ = tokio::time::timeout(BYE_WAIT, room.voice.say(Note::Bye { name })).await;
        room.listening.abort();
        if let Err(error) = room.router.shutdown().await {
            log::info!("The room did not close cleanly: {error}");
        }
    }

    async fn speaking(&self) -> Result<(Arc<Voice>, String)> {
        let room = self.room.lock().await;
        let room = room.as_ref().ok_or_else(not_in_a_room)?;
        let name = lock(&room.members).me().to_owned();
        Ok((Arc::clone(&room.voice), name))
    }
}

fn not_in_a_room() -> Error {
    Error::Refused("Not listening together".into())
}

impl Room {
    fn start(
        endpoint: &Endpoint,
        router: Router,
        sender: GossipSender,
        mut receiver: GossipReceiver,
        members: Members,
        on_event: impl Fn(RoomEvent) + Send + Sync + 'static,
    ) -> Self {
        let me = endpoint.id();
        let voice = Arc::new(Voice {
            key: endpoint.secret_key().clone(),
            sender,
            sent: AtomicU64::new(0),
        });
        let members = Arc::new(Mutex::new(members));
        let listening = tokio::spawn({
            let voice = Arc::clone(&voice);
            let members = Arc::clone(&members);
            async move {
                while let Some(event) = receiver.next().await {
                    let outcomes = match event {
                        Ok(Event::Received(message)) => match wire::open(&message.content) {
                            Some((from, note)) if from != me => lock(&members).heard(from, note),
                            _ => continue,
                        },
                        Ok(Event::NeighborDown(who)) => lock(&members).gone(who),
                        Ok(_) => continue,
                        Err(error) => {
                            log::info!("The room closed: {error}");
                            break;
                        }
                    };
                    for outcome in outcomes {
                        match outcome {
                            Outcome::Tell(event) => on_event(event),
                            Outcome::Answer(note) => {
                                if let Err(error) = voice.say(note).await {
                                    log::info!("Could not answer the room: {error}");
                                }
                            }
                        }
                    }
                }
                on_event(RoomEvent::Closed);
            }
        });
        Self {
            router,
            voice,
            members,
            listening,
        }
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

    use super::*;
    use crate::station::station;

    fn events() -> (
        impl Fn(RoomEvent) + Send + Sync + 'static,
        UnboundedReceiver<RoomEvent>,
    ) {
        let (send, receive) = unbounded_channel();
        (move |event| drop(send.send(event)), receive)
    }

    async fn next(events: &mut UnboundedReceiver<RoomEvent>, wanted: fn(&RoomEvent) -> bool) {
        let waiting = async {
            while let Some(event) = events.recv().await {
                if wanted(&event) {
                    return;
                }
            }
            panic!("the room closed");
        };
        tokio::time::timeout(Duration::from_secs(60), waiting)
            .await
            .expect("the event came in time");
    }

    /// Two listeners over the real network and n0's relays: `cargo test -p radio-core -- --ignored`.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs the internet"]
    async fn two_listeners_follow_each_other_and_chat() {
        let (lin, mut lin_hears) = events();
        let (mei, mut mei_hears) = events();
        let host = Together::default();
        let guest = Together::default();

        let invite = host.open("Lin", lin).await.unwrap();
        host.tune(station("a", 1)).await.unwrap();
        guest.join(&invite.text, "Mei", mei).await.unwrap();

        next(
            &mut lin_hears,
            |event| matches!(event, RoomEvent::Joined { name } if name == "Mei"),
        )
        .await;
        next(&mut mei_hears, |event| {
            matches!(event, RoomEvent::Tuned { name, station } if name == "Lin" && station.id == "a")
        })
        .await;

        guest.tune(station("b", 1)).await.unwrap();
        next(
            &mut lin_hears,
            |event| matches!(event, RoomEvent::Tuned { station, .. } if station.id == "b"),
        )
        .await;

        guest.say("你好").await.unwrap();
        guest.say("你好").await.unwrap();
        for _ in 0..2 {
            next(
                &mut lin_hears,
                |event| matches!(event, RoomEvent::Said { text, .. } if text == "你好"),
            )
            .await;
        }

        guest.leave().await;
        next(&mut lin_hears, |event| {
            matches!(event, RoomEvent::Listeners { count: 1 })
        })
        .await;
        host.leave().await;
    }
}
