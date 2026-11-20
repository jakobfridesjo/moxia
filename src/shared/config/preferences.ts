import { createAtom, type Atom } from "@tanstack/react-store";
import * as z from "zod/mini";
import { SCRIPTS, type Script } from "@/shared/api/commands.ts";
import {
  persistedJson,
  persistedString,
  type PersistedValue,
} from "@/shared/lib/persisted-value.ts";

export const LANGUAGES = ["en", "sv", "zh-Hans", "zh-Hant"] as const;

export type Language = (typeof LANGUAGES)[number];

/** An atom that starts from what `stored` holds and saves every change to it. */
function storedAtom<T>(stored: PersistedValue<T>, fallback: () => T) {
  const atom = createAtom(stored.load());
  atom.subscribe((value) => stored.save(value));
  return Object.assign(atom, { reset: () => atom.set(fallback()) }) satisfies Atom<T>;
}

/** A preference kept in `localStorage`, readable outside React. */
function persistedAtom<T extends string>(key: string, values: readonly [T, ...T[]], fallback: T) {
  return storedAtom(persistedString<T>({ key, schema: z.enum(values), fallback }), () => fallback);
}

export const languageAtom = persistedAtom<Language>("language", LANGUAGES, "en");

/** Day is ink on paper; night darkens the paper and lights each painting its own way; auto follows the system. */
export const THEMES = ["auto", "day", "night"] as const;

export type Theme = (typeof THEMES)[number];

export const themeAtom = persistedAtom<Theme>("theme", THEMES, "auto");

/** A switch kept in `localStorage`, readable outside React. */
function persistedSwitch(key: string, fallback: boolean) {
  return storedAtom(persistedJson<boolean>({ key, schema: z.boolean(), fallback }), () => fallback);
}

/** Whether hardware keys click when pressed and the tuning dial hisses between stations. */
export const keySoundsAtom = persistedSwitch("keySounds", false);

/** Whether weather moves over the paintings: mist, rain, falling leaves, the day's light. */
export const environmentAtom = persistedSwitch("environment", true);

/** Whether the paintings may be drawn with WebGL shaders; without them everything is drawn in 2D. */
export const shadersAtom = persistedSwitch("shaders", true);

/** What subtitles are written in. */
export const subtitleScriptAtom = persistedAtom<Script>("subtitleScript", SCRIPTS, "simplified");

/** Whether stations are subtitled, once their models are downloaded. */
export const subtitlesAtom = persistedSwitch("subtitles", false);

/** The name this listener goes by when listening together. */
export const listenerNameAtom = storedAtom(
  persistedJson<string>({ key: "listenerName", schema: z.string(), fallback: "" }),
  () => ""
);

const DEFAULT_VOLUME = 0.8;
/** The player's volume, from 0 to 1. */
export const volumeAtom = storedAtom(
  persistedJson<number>({
    key: "volume",
    schema: z.number().check(z.gte(0), z.lte(1)),
    fallback: DEFAULT_VOLUME,
  }),
  () => DEFAULT_VOLUME
);

/** Back to the defaults, for tests that share one page. */
export function resetPreferences() {
  languageAtom.reset();
  themeAtom.reset();
  volumeAtom.reset();
  keySoundsAtom.reset();
  environmentAtom.reset();
  shadersAtom.reset();
  subtitlesAtom.reset();
  subtitleScriptAtom.reset();
  listenerNameAtom.reset();
}
