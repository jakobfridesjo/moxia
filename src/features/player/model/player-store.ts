import { createAtom } from "@/shared/lib/atom.ts";
import {
  commandErrorMessage,
  commands,
  type PlayerEvent,
  type Station,
  type Tape,
  type TapeNote,
} from "@/shared/api/commands.ts";
import { volumeAtom } from "@/shared/config/preferences.ts";
import { currentMessages } from "@/shared/i18n/messages.ts";
import { toastError } from "@/shared/lib/toast.ts";
import { addCaption, clearCaptions, soundAtom } from "@/features/player/model/subtitles.ts";

export type PlayerStatus =
  | "idle"
  | "connecting"
  | "playing"
  | "buffering"
  | "reconnecting"
  | "stopped"
  | "error";

/**
 * The tape in the deck. It moves at `speed` tape seconds per second since
 * `since` (a `performance.now()`): 1 while playing, more or less while winding,
 * and not at all when `since` is null.
 */
export interface Deck {
  tape: Tape;
  /** Seconds into the tape when it last started or stopped moving. */
  from: number;
  speed: number;
  since: number | null;
}

/** A tape being recorded from the station on air. */
interface Recording {
  /** A `performance.now()`. */
  since: number;
  /** What the station said was on air while recording. */
  notes: TapeNote[];
}

export interface PlayerState {
  /** The station on air or last played, or the tape's station; null before anything played. */
  station: Station | null;
  /** Whether the station or the tape in the deck plays. */
  source: "station" | "tape";
  status: PlayerStatus;
  /** What the station says is on air, when it says. */
  nowPlaying: string | null;
  error: string | null;
  deck: Deck | null;
  recording: Recording | null;
}

const IDLE: PlayerState = {
  station: null,
  source: "station",
  status: "idle",
  nowPlaying: null,
  error: null,
  deck: null,
  recording: null,
};

export const playerAtom = createAtom<PlayerState>(IDLE);

/** How loud each channel plays now, from 0 to 1; silent unless playing. */
export const levelAtom = createAtom({ left: 0, right: 0 });
const SILENT = { left: 0, right: 0 };

/** Bumped whenever a tape may have been finished, so the tape list is fetched again. */
export const tapesChangedAtom = createAtom(0);
const tapesChanged = () => tapesChangedAtom.set((count) => count + 1);

/** Whether a tape is being recorded, which the next play or stop finishes. */
const recordingNow = () => playerAtom.get().recording !== null;

/** Whether the player holds a stream open, so the main button stops it. */
export function isActive(status: PlayerStatus) {
  return (
    status === "connecting" ||
    status === "playing" ||
    status === "buffering" ||
    status === "reconnecting"
  );
}

/** Where the deck's tape is at `now`, in seconds. */
export function deckPosition(deck: Deck, now = performance.now()) {
  const moved = deck.since === null ? 0 : (deck.speed * (now - deck.since)) / 1000;
  return Math.min(Math.max(deck.from + moved, 0), deck.tape.duration);
}

/** `deck` held still where it is at `now`. */
function halt(deck: Deck | null, now: number): Deck | null {
  return deck && { ...deck, from: deckPosition(deck, now), speed: 0, since: null };
}

/** `state` after the player reported `event` at `now`. */
export function applyPlayerEvent(
  state: PlayerState,
  event: PlayerEvent,
  now = performance.now()
): PlayerState {
  const tape = state.source === "tape";
  switch (event.kind) {
    case "connecting":
      return { ...state, status: "connecting", nowPlaying: null, error: null };
    case "playing":
      return {
        ...state,
        status: "playing",
        error: null,
        deck: tape && state.deck ? { ...state.deck, speed: 1, since: now } : state.deck,
      };
    case "buffering":
      return { ...state, status: "buffering", deck: tape ? halt(state.deck, now) : state.deck };
    case "reconnecting":
      return { ...state, status: "reconnecting" };
    case "nowPlaying": {
      const title = event.title.trim() || null;
      const recording =
        title && state.recording
          ? {
              ...state.recording,
              notes: [
                ...state.recording.notes,
                { at: (now - state.recording.since) / 1000, title },
              ],
            }
          : state.recording;
      return { ...state, nowPlaying: title, recording };
    }
    case "level":
    case "subtitle":
    case "sound":
      return state;
    case "stopped":
      return {
        ...state,
        status: "stopped",
        nowPlaying: null,
        recording: null,
        deck: tape ? halt(state.deck, now) : state.deck,
      };
    case "error":
      return {
        ...state,
        status: "error",
        nowPlaying: null,
        error: event.message,
        recording: null,
        deck: tape ? halt(state.deck, now) : state.deck,
      };
  }
}

/** Counts plays, so events from a stream already replaced are dropped. */
let playCount = 0;

function listen(play: number) {
  return (event: PlayerEvent) => {
    if (play !== playCount) return;
    if (event.kind === "level") {
      levelAtom.set({ left: event.left, right: event.right });
      return;
    }
    if (event.kind === "subtitle") {
      const shown = performance.now();
      addCaption({ ...event, shown, at: shown + event.ahead * 1000 });
      return;
    }
    if (event.kind === "sound") {
      soundAtom.set(event.sound);
      return;
    }
    if (event.kind !== "nowPlaying") levelAtom.set(SILENT);
    const recorded = recordingNow();
    playerAtom.set((state) => applyPlayerEvent(state, event));
    if (recorded && !recordingNow()) tapesChanged();
  };
}

function failed(play: number, error: unknown) {
  if (play !== playCount) return;
  const message = commandErrorMessage(error, currentMessages().player.playFailed);
  playerAtom.set((state) => applyPlayerEvent(state, { kind: "error", message }));
}

/** Plays `station` in place of whatever plays; resolves once Rust starts connecting. */
export async function playStation(station: Station) {
  const play = ++playCount;
  const recorded = recordingNow();
  levelAtom.set(SILENT);
  clearCaptions();
  playerAtom.set((state) => ({
    ...state,
    station,
    source: "station",
    status: "connecting",
    nowPlaying: null,
    error: null,
    recording: null,
    deck: halt(state.deck, performance.now()),
  }));
  try {
    await commands.play(station, volumeAtom.get(), listen(play));
  } catch (error) {
    failed(play, error);
  }
  if (recorded) tapesChanged();
}

/** Puts `tape` in the deck, at `from` seconds, without playing it. */
export function loadTape(tape: Tape, from = 0) {
  playerAtom.set((state) => ({ ...state, deck: { tape, from, speed: 0, since: null } }));
}

/** Takes the tape out of the deck, as when it is deleted; a station that was on air stays. */
export function unloadTape() {
  playerAtom.set((state) => ({ ...state, deck: null, source: "station" }));
}

/** Plays the deck's tape from where it is, or from the start once it has run out. */
export async function playDeck() {
  const { deck } = playerAtom.get();
  if (!deck) return;
  const at = deckPosition(deck);
  const from = at >= deck.tape.duration - 0.5 ? 0 : at;
  const play = ++playCount;
  const recorded = recordingNow();
  levelAtom.set(SILENT);
  clearCaptions();
  playerAtom.set((state) => ({
    ...state,
    station: deck.tape.station,
    source: "tape",
    status: "connecting",
    nowPlaying: null,
    error: null,
    recording: null,
    deck: { ...deck, from, speed: 0, since: null },
  }));
  try {
    const start = await commands.playTape(deck.tape.id, from, volumeAtom.get(), listen(play));
    if (play !== playCount) return;
    playerAtom.set((state) =>
      state.deck?.tape.id === deck.tape.id && state.deck.since === null
        ? { ...state, deck: { ...state.deck, from: start } }
        : state
    );
  } catch (error) {
    failed(play, error);
  }
  if (recorded) tapesChanged();
}

export async function stopPlayback() {
  playCount += 1;
  const recorded = recordingNow();
  levelAtom.set(SILENT);
  clearCaptions();
  playerAtom.set((state) => applyPlayerEvent(state, { kind: "stopped" }));
  try {
    await commands.stop();
  } catch (error) {
    const message = commandErrorMessage(error, currentMessages().player.playFailed);
    playerAtom.set((state) => applyPlayerEvent(state, { kind: "error", message }));
  }
  if (recorded) tapesChanged();
}

/** Starts copying the station on air to a new tape. */
export async function startRecording() {
  const play = playCount;
  try {
    await commands.startRecording();
  } catch (error) {
    toastError(commandErrorMessage(error, currentMessages().radio.recordFailed));
    return;
  }
  if (play !== playCount) return;
  playerAtom.set((state) => ({ ...state, recording: { since: performance.now(), notes: [] } }));
}

/** Ends the tape being recorded and puts it in the deck; the station plays on. */
export async function stopRecording() {
  try {
    const tape = await commands.stopRecording();
    playerAtom.set((state) => ({ ...state, recording: null }));
    if (tape) loadTape(tape);
    return tape;
  } catch (error) {
    toastError(commandErrorMessage(error, currentMessages().radio.recordFailed));
    return null;
  } finally {
    tapesChanged();
  }
}

/** Saves `volume` and applies it to what plays; from 0 to 1. */
export function changeVolume(volume: number) {
  volumeAtom.set(volume);
  if (isActive(playerAtom.get().status)) void commands.setVolume(volume).catch(() => {});
}

/** Back to nothing played, for tests that share one page. */
export function resetPlayer() {
  playCount += 1;
  playerAtom.set(IDLE);
  levelAtom.set(SILENT);
  clearCaptions();
}
