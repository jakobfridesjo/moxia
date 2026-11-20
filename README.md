# 墨虾 Moxia

A Tauri 2 app for desktop and Android that plays Chinese-language radio. It lists every working station from mainland China, Taiwan, Hong Kong and Macau in the [radio-browser](https://www.radio-browser.info/) directory, on one screen: an ink painting whose inscription names the station on air. Swipe sideways to change station, up to change place, keep six on preset seals, record what plays onto a path up a hanging scroll, and listen together with friends: share an invite, and everyone follows the same station and chats, peer to peer over iroh. Streams are fetched and decoded in Rust (MP3 and AAC, over plain HTTP or HLS), and can be subtitled live, on the device: SenseVoice transcribes what is said, FireRedVAD finds the speech, and the words are written into the painting beside the listener. Chat messages translate into English on the device too, with opus-mt.

## Quick start

Install the [system packages](docs/building.md#system-packages) first, then:

```bash
mise install  # tools
mise setup    # dependencies, git hooks, test browser
mise desktop  # run the app with hot reload
mise check    # lint, format, typecheck, knip, steiger
mise test     # Rust core, then frontend
```

## Docs

- [Architecture](docs/architecture.md)
- [Frontend conventions](docs/frontend.md)
- [Testing](docs/testing.md)
- [Building for desktop, Android and macOS](docs/building.md)
- [Licences and data sources](docs/licences.md)
- [Dependency upgrades](docs/dependency-upgrades.md)
- [Agent skills](docs/skills.md)

## Licence

Moxia is licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), at your option. Unless you state otherwise, any contribution you submit for inclusion is dual-licensed the same way, without additional terms. Data sources have their own licences: see [docs/licences.md](docs/licences.md).
