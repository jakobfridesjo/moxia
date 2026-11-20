import { Channel, invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";

// Mirrors the serde types in src-tauri (camelCase). Keep the two in step.

/** The countries whose stations the app lists: mainland China, Taiwan, Hong Kong and Macau. */
export const COUNTRY_CODES = ["CN", "TW", "HK", "MO"] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

/** A radio-browser station. */
export interface Station {
  /** radio-browser's `stationuuid`. */
  id: string;
  name: string;
  streamUrl: string;
  homepage: string | null;
  /** A remote URL: never load it in an `<img>`, ask `getFavicon` for it. */
  favicon: string | null;
  tags: string[];
  countryCode: CountryCode;
  /** Province or region. */
  state: string | null;
  languages: string[];
  codec: string | null;
  /** In kbps. */
  bitrate: number | null;
  hls: boolean;
  votes: number;
  clickCount: number;
}

/** What the player reports through `play`'s channel. */
export type PlayerEvent =
  | { kind: "connecting" }
  | { kind: "playing" }
  | { kind: "buffering" }
  /** The stream's own title for what is on air; may arrive at any time while playing. */
  | { kind: "nowPlaying"; title: string }
  /** How loud each channel peaked lately, from 0 to 1; about 20 times a second while playing. */
  | { kind: "level"; left: number; right: number }
  /**
   * What is said from now on, as it plays, while subtitles are on. `duration` is how long it takes to say, and `said`
   * when each of its characters is said, in seconds from now. `emotion` is how the voice
   * sounds, `emotionSure` how sure the model is of it (0 to 1), and `burst` a laugh,
   * applause, crying or a cough heard with the words.
   */
  | {
      kind: "subtitle";
      text: string;
      duration: number;
      said: number[];
      emotion: Emotion;
      emotionSure: number;
      burst: Burst | null;
    }
  /** What plays from now on, while subtitles are on. */
  | { kind: "sound"; sound: Sound }
  | { kind: "stopped" }
  | { kind: "error"; message: string };

export type Emotion = "neutral" | "happy" | "sad" | "angry" | "fearful" | "surprised" | "disgusted";

export type Burst = "laughter" | "applause" | "cry" | "cough";

export type Sound = "quiet" | "talk" | "talkOverMusic" | "singing" | "music";

/** A favourite stored on one of the preset keys, numbered from 1. */
export interface Preset {
  key: number;
  station: Station;
}

export const PRESET_KEYS = 6;

/** What the station said was on air, `at` seconds into a tape. */
export interface TapeNote {
  at: number;
  title: string;
}

/** A recording of a station: its stream as it came, MP3 or AAC. */
export interface Tape {
  id: string;
  station: Station;
  /** ISO 8601, UTC. */
  recordedAt: string;
  /** In seconds. */
  duration: number;
  codec: "mp3" | "aac";
  notes: TapeNote[];
}

/**
 * What subtitles are written in: SenseVoice writes simplified, which Rust converts to traditional
 * in Taiwan's or Hong Kong's standard forms.
 */
export const SCRIPTS = ["simplified", "taiwan", "hongKong"] as const;
export type Script = (typeof SCRIPTS)[number];

/**
 * The models downloaded on request: `subtitles` transcribes what stations say, `translator` puts
 * chat messages into English.
 */
export type Model = "subtitles" | "translator";

export interface ModelStatus {
  model: Model;
  /** The whole download's size, in bytes. */
  bytes: number;
  downloaded: boolean;
}

export interface DownloadProgress {
  /** Bytes on disk so far, counting what an earlier attempt left. */
  downloaded: number;
  total: number;
}

/** What happens in a room listening together, through `openRoom`'s or `joinRoom`'s channel. */
export type RoomEvent =
  /** How many are in the room, counting this listener. */
  | { kind: "listeners"; count: number }
  | { kind: "joined"; name: string }
  | { kind: "left"; name: string }
  | { kind: "said"; name: string; text: string }
  /** Someone changed station, or this listener just joined a room listening to `station`. */
  | { kind: "tuned"; name: string; station: Station }
  /** The room cannot be reached any more. */
  | { kind: "closed" };

/** An invite to a room: text to copy and a QR code to scan. */
export interface InviteCode {
  text: string;
  qr: {
    width: number;
    /** `width` modules to a row, row after row: `1` dark, `0` light. */
    modules: string;
  };
}

/** Every Rust command: `commands` and the test mocks accept only these names. */
export type CommandName =
  | "list_stations"
  | "list_favourites"
  | "set_favourite"
  | "list_presets"
  | "set_preset"
  | "list_recent"
  | "get_favicon"
  | "play"
  | "stop"
  | "set_volume"
  | "start_recording"
  | "stop_recording"
  | "list_tapes"
  | "delete_tape"
  | "play_tape"
  | "list_models"
  | "download_model"
  | "cancel_model_download"
  | "delete_model"
  | "set_subtitles"
  | "translate"
  | "open_room"
  | "join_room"
  | "say_to_room"
  | "tune_room"
  | "leave_room";

const invoke = <T>(command: CommandName, args?: InvokeArgs) => tauriInvoke<T>(command, args);

export const commands = {
  /**
   * Every station of the four countries, most played first. Rust keeps them for a day;
   * `refresh` fetches them again from radio-browser.
   */
  listStations: (refresh: boolean) => invoke<Station[]>("list_stations", { refresh }),

  /** Newest first. */
  listFavourites: () => invoke<Station[]>("list_favourites"),

  setFavourite: (station: Station, favourite: boolean) =>
    invoke<null>("set_favourite", { station, favourite }),

  /** By key; keys with nothing stored are left out. */
  listPresets: () => invoke<Preset[]>("list_presets"),

  /** Stores `station` on preset `key` in place of what was there, making it a favourite. */
  setPreset: (station: Station, key: number) => invoke<null>("set_preset", { station, key }),

  /** The stations played last, most recent first. */
  listRecent: () => invoke<Station[]>("list_recent"),

  /** A station's favicon as a `data:` URL, fetched and kept by Rust; null when it has none. */
  getFavicon: (url: string) => invoke<string | null>("get_favicon", { url }),

  /**
   * Stops whatever plays and starts `station`, reporting on `onEvent` until it stops.
   * Resolves once it starts connecting; the station joins the recent list.
   */
  play: (station: Station, volume: number, onEvent: (event: PlayerEvent) => void) => {
    const channel = new Channel<PlayerEvent>(onEvent);
    return invoke<null>("play", { station, volume, onEvent: channel });
  },

  stop: () => invoke<null>("stop"),

  /** From 0 to 1. */
  setVolume: (volume: number) => invoke<null>("set_volume", { volume }),

  /** Copies the station on air to a new tape until `stopRecording`, a stop or another play. */
  startRecording: () => invoke<null>("start_recording"),

  /** The finished tape; null when nothing was recorded. The station plays on. */
  stopRecording: () => invoke<Tape | null>("stop_recording"),

  /** Newest first. */
  listTapes: () => invoke<Tape[]>("list_tapes"),

  deleteTape: (id: string) => invoke<null>("delete_tape", { id }),

  /**
   * Stops whatever plays and plays tape `id` from `from` seconds, reporting on `onEvent`.
   * Resolves to where it really starts: the start of the audio frame playing at `from`.
   */
  playTape: (id: string, from: number, volume: number, onEvent: (event: PlayerEvent) => void) => {
    const channel = new Channel<PlayerEvent>(onEvent);
    return invoke<number>("play_tape", { id, from, volume, onEvent: channel });
  },

  /** Which downloadable models are on this device. */
  listModels: () => invoke<ModelStatus[]>("list_models"),

  /** Resolves to false when `cancelModelDownload` stopped it; what arrived stays for next time. */
  downloadModel: (model: Model, onProgress: (progress: DownloadProgress) => void) => {
    const channel = new Channel<DownloadProgress>(onProgress);
    return invoke<boolean>("download_model", { model, onProgress: channel });
  },

  /** The download stops at its next chunk. */
  cancelModelDownload: (model: Model) => invoke<null>("cancel_model_download", { model }),

  deleteModel: (model: Model) => invoke<null>("delete_model", { model }),

  /**
   * Turns live subtitles on, loading their models the first time (several seconds), or off, and
   * writes them in `script`. Either applies to what plays at once; with subtitles on, a play
   * waits a few seconds longer before it starts, so speech is transcribed before it is heard.
   */
  setSubtitles: (enabled: boolean, script: Script) =>
    invoke<null>("set_subtitles", { enabled, script }),

  /** Chinese text in English. The translator loads on the first call (a second or two). */
  translate: (text: string) => invoke<string>("translate", { text }),

  /** Opens a room to listen together in as `name`, leaving any other, and resolves to its invite. */
  openRoom: (name: string, onEvent: (event: RoomEvent) => void) => {
    const channel = new Channel<RoomEvent>(onEvent);
    return invoke<InviteCode>("open_room", { name, onEvent: channel });
  },

  /**
   * Joins the room `invite` leads to as `name`, leaving any other, and resolves to an invite to
   * pass on. Rejects when no one in it answers within half a minute.
   */
  joinRoom: (invite: string, name: string, onEvent: (event: RoomEvent) => void) => {
    const channel = new Channel<RoomEvent>(onEvent);
    return invoke<InviteCode>("join_room", { invite, name, onEvent: channel });
  },

  sayToRoom: (text: string) => invoke<null>("say_to_room", { text }),

  /**
   * Tells the room this listener changed to `station`, so everyone follows. One who just joined
   * stays quiet until they hear what the room listens to.
   */
  tuneRoom: (station: Station) => invoke<null>("tune_room", { station }),

  leaveRoom: () => invoke<null>("leave_room"),
};

/** Rust rejects with its error's message as a plain string. */
export function commandErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
