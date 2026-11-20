# Building

All tasks are mise tasks, run from the repo root. `mise tasks` lists them.

## System packages

The Rust side needs the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), plus the ALSA headers for sound output on Linux, and `cmake` and a C++ compiler for SentencePiece, the translator's tokenizer.

**Fedora**

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel alsa-lib-devel gcc-c++ cmake
```

**Ubuntu or Debian** (also under WSL)

```bash
sudo apt install libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libgtk-3-dev libasound2-dev build-essential pkg-config curl wget file cmake
```

**Fedora Atomic Desktop**

The host lacks the GTK libraries and `libstdc++.so`. Install the Fedora packages in the `fedora-toolbox-45` toolbox and run every Rust build there: `mise desktop`, `mise test`, `mise test:rust` and any `cargo`.

## Desktop

```bash
mise desktop        # run with hot reload
mise desktop:build  # installers in src-tauri/target/release/bundle/ (.deb and .rpm on Linux)
```

## Android

```bash
mise android:build    # signed arm64 APK
mise android:install  # install it on the adb-connected phone
```

- `android:build` first installs the NDK (`android:sdk`) and creates the release key in `~/.android` (`android:keystore`), outside the repo.
- Pair a phone over Wi-Fi with `adb pair`.
- Sound goes out through AAudio (cpal). It plays on with the screen off through `MediaPlaybackService.kt`, a media playback foreground service in `gen/android` that holds a partial wake lock and a Wi-Fi lock while something plays, and carries the media session for the lock screen, the notification and headset buttons. `MediaSessionPlugin.kt` beside it is the app's own Tauri plugin, registered from `src-tauri/src/media.rs`; both are kept in git with the rest of `gen/android`.
- The display stays on while the app shows: `MainActivity.kt` sets `FLAG_KEEP_SCREEN_ON` on its window. On desktops `lib.rs` holds a keepawake display inhibitor for as long as the app runs.
- The camera (for invites) comes from Tauri's barcode scanner plugin, which declares it required: stores would hide the app from phones without one.

## macOS

```bash
mise desktop:build:mac  # .app and .dmg, on a Mac only
```

- Needs the Xcode Command Line Tools.
- `src-tauri/tauri.macos.conf.json` signs ad-hoc.
- To sign for distribution, set `APPLE_SIGNING_IDENTITY` and the notarization variables.
