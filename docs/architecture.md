# Architecture

## Layout

| Path                         | What it is                                                      |
| ---------------------------- | --------------------------------------------------------------- |
| `src/`                       | Solid frontend (Vite), the top-level project                    |
| `src-tauri/radio-core/`      | All logic, with no Tauri dependency                             |
| `src-tauri/src/commands.rs`  | Tauri commands: a thin layer over `radio-core`                  |
| `src-tauri/src/media.rs`     | The system's media controls (souvlaki; Android's media session) |
| `src/shared/api/commands.ts` | The frontend's only way into Rust; there is no HTTP backend     |

### `radio-core`

| Module           | Does                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `radio_browser`  | Talks to radio-browser, trying its mirrors in turn; counts each play                                  |
| `catalog`        | Every CN, TW, HK and MO station, cached in memory and on disk for a day, categorized at each load     |
| `category`       | Reads a station's categories (music, news, talk, traffic, full service) out of its tags and name      |
| `store`          | SQLite: favourites, their preset keys and the 30 last played                                          |
| `favicon`        | Fetches station logos and hands them over as `data:` URLs, cached on disk                             |
| `player`         | Fetches, decodes (symphonia) and plays (rodio) one station or tape at a time                          |
| `tapes`          | Recordings: the stream's own MP3 or AAC frames, with a JSON description                               |
| `models`, `onnx` | Model downloads, and the tract runtime that runs them (on the GPU when there is one)                  |
| `speech`         | Live subtitles: finds speech and transcribes it                                                       |
| `sky`            | The weather where a station is, from Open-Meteo, as how much rain, snow, cloud, fog and wind to paint |
| `together`       | Listening together: rooms of peers who follow each other's station and chat, on iroh                  |
| `translation`    | Translates chat messages from Chinese into English (opus-mt)                                          |

## The command contract

**Types are mirrored by hand.** The TypeScript types in `commands.ts` copy the serde types. When you change one side, change the other and the `serializes_*_with_the_frontend_field_names` tests in `station.rs` and `player/mod.rs`.

**Errors** come back as the Rust error message, a plain string. **Player events** (`connecting`, `playing`, `buffering`, `reconnecting`, `nowPlaying`, `level`, `subtitle`, `stopped`, `error`) go through the `Channel` passed to `play` or `play_tape`; a new play or `stop` silences the old channel. `level` comes about 20 times a second while playing.

**Room events** (`listeners`, `joined`, `left`, `said`, `tuned`, `closed`) go through the `Channel` passed to `open_room` or `join_room`; leaving or entering another room silences it.

## Playback

A play runs a session on its own thread:

1. `player/source.rs` opens the stream URL. A plain stream has its ICY metadata taken out, reporting each stream title (UTF-8, else GBK for CN stations and Big5 for the rest). A `.pls` or `.m3u` playlist is followed.
2. An HLS playlist goes to `player/hls.rs`, which follows the live playlist from three segments before its end. `player/segment.rs` turns each segment into the ADTS AAC or MP3 inside it, demultiplexing MPEG-TS. Encrypted and fragmented-MP4 HLS are refused.
3. symphonia decodes the bytes to PCM, gathered into tenth-of-a-second chunks on a rodio player, which starts once two seconds are queued (six while subtitles are on) and pauses when the queue runs dry.

A station that drops after it has played (its server closes the stream, or sends nothing for 20 s) is opened again after 1, 2, 4, 8, 15 and 30 s, with a `reconnecting` event before each try; once it plays again the count starts over, and after about a minute it is given up with an `error`. A tape being recorded carries on across. A station that never played, and a tape, are not tried again.

Ogg Opus is not supported (symphonia has no Opus decoder).

Each chunk goes to rodio wrapped in `player/meter.rs`, which keeps the peaks, and how long the output has played, as the output plays them, seconds behind decoding; a watcher thread sends the peaks as `level` events.

## Subtitles

`set_subtitles` loads `Speech` (about 4 seconds the first time on a desktop, 1.7 after) and hands it to the player; from the next chunk on, each decoded chunk also goes, with where it starts in the session, to a `Subtitler` on a thread of its own (`Captions` in `player/mod.rs`). If it falls 30 seconds behind, chunks are skipped and it starts afresh at the next.

1. `speech/resample.rs` brings the audio to 16 kHz mono; `speech/fbank.rs` makes Kaldi filterbanks of it.
2. FireRedVAD (`speech/vad.rs`) gives each 10 ms frame a speech probability, a DFSMN (`speech/dfsmn.rs`) run in ndarray from the official PyTorch checkpoint (`speech/torch.rs` reads it without running its pickle). Its own streaming rules cut speech into stretches, at most six seconds long.
3. Meanwhile FireRedVAD's audio event detector (`speech/sound.rs`), the same network with each memory also reaching 20 frames ahead, gives each frame a probability of speech, singing and music. Streamed, a layer answers for a frame once the 20 after it arrive, so it runs 1.6 s behind, exactly as the whole recording at once would (a test checks this). Smoothed over five frames with FireRedVAD's thresholds (0.4, 0.5, 0.5), each frame is `talk`, `talkOverMusic`, `singing` (singing wins), `music` or `quiet`; a new one is taken once it has held a second, two for quiet, and dated back to where it began.
4. Each stretch goes to SenseVoice-Small (`speech/recognizer.rs`), whose CTC output also dates each character to the 60 ms step it came from. Only what it is at least 0.8 sure of the language of becomes a subtitle: speech in any language it knows comes near 1, a noise or breath misheard as "Yeah." or "あ。" well below. Its emotion tag becomes the subtitle's `emotion`, with the tag's probability among the nine emotion tags as `emotion_sure` (neutral and 0 when <|OTHER|> or <|EMO_UNKNOWN|> wins); its event tag becomes a `burst` when it is laughter, applause, crying, a cough or a sneeze.
5. The watcher releases each subtitle as a `subtitle` event once the output has played up to its start, with how long it takes to say and when each character is said (`said`, seconds from then), and each change of sound as a `sound` event once the output reaches it (only the latest, should several be due). Converted to traditional, a character keeps the time of the one at its place.

tract's GPU runtime gives wrong answers when a graph runs on another thread than the one that prepared it, so SenseVoice lives on a `speech` thread of its own that `Speech::hear` sends work to.

## Tapes

- **Recording** copies the stream's bytes, before decoding, to `<id>.mp3` or `<id>.aac`: no re-encoding, the station's own quality. Only MP3 and AAC streams can be recorded, since they can start at any frame.
- A tape ends on `stop_recording`, or when its session stops or is replaced. Then `player/frames.rs` times it by walking its frames, and `<id>.json` is written with the station, the duration and the stream titles seen while recording (`notes`). A tape still recording is not listed.
- **Playing a tape** finds the frame at the start time with `frames.rs`, opens the file there and runs it through the same session as a stream; `play_tape` answers with where it really starts.

## Listening together

`together` keeps one room at a time. Everyone in it plays the station from the station; the room only carries short notes between the peers, so it costs next to no bandwidth and nobody re-broadcasts a stream.

- **Network:** each room gets a fresh [iroh](https://iroh.computer) endpoint, a new key every time, with n0's preset: QUIC dialled by public key, hole punching, n0's public relays when that fails, and their DNS to find peers by key. The notes go over [iroh-gossip](https://docs.rs/iroh-gossip) on a random 32-byte topic.
- **Invite:** `moxia:` and base64url JSON of the topic and the inviter's key with up to six of its addresses (relay and IP), drawn as a QR code by the `qrcode` crate (`together/invite.rs`). Joining puts those addresses in a `MemoryLookup`, so it needs no DNS to reach the inviter; every member's invite works, since each names the same topic. Opening waits up to 8 s to reach a relay, then hands out whatever addresses it has; joining gives up after 30 s.
- **Notes** (`together/wire.rs`): JSON of `Hello`, `Here`, `Tune`, `Say` or `Bye`, each with the sender's name (40 characters at most; text 500). Gossip neither signs messages nor says who wrote them, so every note goes out as the sender's 32-byte key, an ed25519 signature and the body, with a counter in it (gossip drops a message identical to one it has seen). Unsigned, forged and unreadable ones are dropped.
- **Members** (`together/members.rs`, pure and unit-tested): whoever joins says `Hello` and everyone answers `Here`, with what they play. A newcomer follows the first station it hears of and keeps its own changes of station to itself until then, so joining never retunes the room; the frontend follows the same rule from the `listeners` event, which comes after `tuned`. Someone is counted out on `Bye` or when their connection drops. `Tune` retunes everyone.
- The room test in `together/mod.rs` runs two listeners over the real network and is ignored by default: `cargo test -p radio-core -- --ignored`.

## Media controls

The frontend shows what plays with `show_media` (the station, what it says is on air, whether it plays) and hands `watch_media` a channel for the buttons pressed: `play`, `pause`, `toggle`, `next`, `previous` and `stop`. On Linux they are an MPRIS player (`org.mpris.MediaPlayer2.moxia`, souvlaki over zbus), so desktop media menus and keyboard media keys reach the radio; on macOS the Now Playing centre and on Windows the system transport controls. On Android, `media.rs` forwards both commands to `MediaSessionPlugin.kt`, the channel included, whose `MediaPlaybackService` keeps the radio playing with the screen off. `model/use-media-controls.ts` decides what a button means: play and pause stop or start the radio as its own button does, next and previous change station or recording.

## Data

| Data               | Where                       |
| ------------------ | --------------------------- |
| Station list       | `<app cache>/stations.json` |
| Station logos      | `<app cache>/favicons/`     |
| Favourites, recent | `<app data>/radio.sqlite3`  |
| Tapes              | `<app data>/tapes/`         |

Every request names the app as `Moxia/<version>`, as radio-browser asks. Sources and licences: [licences.md](licences.md).

## Models

`models.rs` downloads a model's files from pinned Hugging Face revisions into `<app data>/models/<model>-<revision>/`, resumably and checked by SHA-256; `tidy` drops folders of revisions no longer used. `onnx.rs` runs ONNX graphs in tract, on the GPU (wgpu) when there is one and on every CPU core otherwise.

`Model::Subtitles` is one download of about 969 MB:

| File            | Model                                                           |
| --------------- | --------------------------------------------------------------- |
| `model.onnx`    | SenseVoice-Small, k2-fsa's fp32 export (2024-07-17), run in f16 |
| `tokens.txt`    | Its vocabulary                                                  |
| `model.pth.tar` | FireRedVAD's streaming VAD (`Stream-VAD`)                       |
| `aed.pth.tar`   | FireRedVAD's audio event detector (`AED/model.pth.tar`)         |
| `cmvn.ark`      | Their feature statistics, the same for both                     |

SenseVoice loads in f16 (`onnx::Floats::Half`), not from k2-fsa's int8 export: tract's GPU runtime has no int8 matrix products, so the int8 graph ran mostly on the CPU. Its attention masks are dropped (`unmask_attention` in `speech/recognizer.rs`), since one unpadded stretch at a time masks nothing, and masking read every layer's scores back from the GPU. A 6-second stretch takes about 50 ms on a desktop GPU.

Reading, parsing and decluttering the 937 MB ONNX file takes most of a load, so the first load writes the f16 model it builds to `model.f16.v1.nnef.tar` (470 MB, tract's NNEF format) beside it, and later loads read that instead (`onnx::cached`). Its padding mask is sized by the input (`measure_mask_by_input`), as otherwise tract cannot write the model. A copy tract cannot read is built and written again. Bump the file's version in `recognizer.rs` whenever `build` changes. The copy lives in the model's folder, so deleting the model or moving to a new revision drops it.

`Model::Translator` is opus-mt-zh-en (Helsinki-NLP's Marian model, in Xenova's fp16 ONNX export), about 337 MB: `source.spm` (its SentencePiece tokenizer, run by [kitoken](https://crates.io/crates/kitoken) in pure Rust), `vocab.json`, and the encoder and decoder graphs, with and without the decoder's cache. `translate` loads it on the first call (`Translator` in `translation.rs`, kept in `AppState` until the model is deleted) and decodes greedily into English; it reads simplified and traditional alike.

SenseVoice writes simplified Chinese for every station. `set_subtitles` also takes the script subtitles are written in; for traditional, the subtitler thread converts each subtitle with OpenCC's `s2tw` or `s2hk` rules (`speech/script.rs`, ferrous-opencc): Taiwan's or Hong Kong's standard forms (裡 or 裏), leaving the words as they were said.

It takes a reading too (`speech/reading.rs`): none, pinyin or zhuyin. Each subtitle's simplified text is read by [pinyin_pro](https://crates.io/crates/pinyin_pro), a Rust port of pinyin-pro, which reads by whole words (银行 háng, 行长 zhǎng) and changes the tones of 一 and 不 as they are said. Zhuyin is turned from that pinyin as Taiwan writes it, the tone after the syllable and the neutral tone's dot before it. The `subtitle` event carries one reading for each character of its text (empty for what is not Chinese), kept in step through the conversion to traditional as `said` is.
