import { createAtom } from "@tanstack/react-store";
import {
  commandErrorMessage,
  commands,
  type Burst,
  type Emotion,
  type Script,
  type Sound,
} from "@/shared/api/commands.ts";
import { subtitleScriptAtom, subtitlesAtom } from "@/shared/config/preferences.ts";
import { currentMessages } from "@/shared/i18n/messages.ts";
import { toastError } from "@/shared/lib/toast.ts";

/** Whether Rust subtitles what plays: `loading` while it loads the models, which takes seconds. */
export type SubtitlesStatus = "off" | "loading" | "on";

export const subtitlesStatusAtom = createAtom<SubtitlesStatus>("off");

/** A subtitle as it started playing. */
export interface Caption {
  text: string;
  /** How long it takes to say, in seconds. */
  duration: number;
  /** When each character of `text` is said, in seconds after `at`. */
  said: number[];
  /** How the voice sounds, and how sure the model is of it, from 0 to 1. */
  emotion: Emotion;
  emotionSure: number;
  /** A laugh, applause, crying or a cough heard with the words. */
  burst: Burst | null;
  /** When it arrived, as a `performance.now()`. */
  at: number;
}

/**
 * The subtitles of what plays, newest last, kept outside React like the levels: the painting
 * reads them every frame. A new play or a stop clears them.
 */
export const captionsAtom = createAtom<Caption[]>([]);
/** Captions older than the last few have faded from the painting. */
const KEPT_CAPTIONS = 4;

export function addCaption(caption: Caption) {
  captionsAtom.set((captions) => [...captions.slice(1 - KEPT_CAPTIONS), caption]);
}

/** What plays while subtitles are on, as the models hear it; unknown until they say. */
export const soundAtom = createAtom<Sound | null>(null);

export function clearCaptions() {
  if (captionsAtom.get().length > 0) captionsAtom.set([]);
  soundAtom.set(null);
}

let change = 0;

/**
 * Remembers whether subtitles are wanted and has Rust turn them on or off. Turning them on
 * fails, and is forgotten, when the models are not downloaded or will not load.
 */
export async function setSubtitles(on: boolean) {
  const mine = ++change;
  subtitlesAtom.set(on);
  subtitlesStatusAtom.set(on ? "loading" : "off");
  if (!on) clearCaptions();
  try {
    await commands.setSubtitles(on, subtitleScriptAtom.get());
    if (mine === change) subtitlesStatusAtom.set(on ? "on" : "off");
  } catch (error) {
    if (mine !== change) return;
    subtitlesAtom.set(false);
    subtitlesStatusAtom.set("off");
    if (on) toastError(commandErrorMessage(error, currentMessages().subtitles.loadFailed));
  }
}

/** Writes subtitles in `script` from now on, telling Rust at once while they are on. */
export function setSubtitleScript(script: Script) {
  subtitleScriptAtom.set(script);
  if (subtitlesAtom.get()) void setSubtitles(true);
}

/** Forgets subtitles were on, as when their models are deleted; Rust has already let them go. */
export function forgetSubtitles() {
  change += 1;
  subtitlesAtom.set(false);
  subtitlesStatusAtom.set("off");
  clearCaptions();
}

/** Back to subtitles off, for tests that share one page. */
export function resetSubtitles() {
  change += 1;
  subtitlesStatusAtom.set("off");
  captionsAtom.set([]);
  soundAtom.set(null);
}
