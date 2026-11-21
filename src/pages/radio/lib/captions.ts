/*
 * Subtitles written into the painting: Chinese a character to a cell, anything
 * else a word to a cell, which the painter wraps into lines. A caption shows
 * pale a little before it is said, and full ink sweeps across each cell as it
 * is said, as in karaoke; it stays a while, then fades, faster once the next
 * is shown.
 */

import type { Caption } from "@/features/player/model/subtitles.ts";

/** How long a caption stays once all of it is written, and how long it takes to fade, in ms. */
const HOLD_MS = 3500;
const FADE_MS = 1500;
/** How fast one fades once the next is shown. */
const GIVE_WAY_MS = 500;
/** How long a caption takes to appear, in ms. */
const SHOW_MS = 300;
/** The shortest and longest the ink takes to sweep across one cell, in seconds: a pause after it is not part of it. */
const SWEEP = { least: 0.08, most: 0.6 } as const;

/** A piece the painter wraps into lines: a Chinese character, or a word of anything else; `from` is which of the text's characters it starts with. */
interface Cell {
  glyph: string;
  /** How a Chinese character is read, written small above it; "" for none. */
  reading: string;
  from: number;
}

export interface Layout {
  chinese: boolean;
  cells: Cell[];
}

const HAN = /\p{Script=Han}/u;

/** Whether `text` is Chinese: when most of its letters are. */
export function isChinese(text: string) {
  const letters = Array.from(text).filter((glyph) => /\p{L}/u.test(glyph));
  const han = letters.filter((glyph) => HAN.test(glyph)).length;
  return letters.length > 0 && han * 2 >= letters.length;
}

/** Splits `text` into cells: Chinese a character to a cell, each keeping its reading from `readings`; anything else a word to a cell. */
export function layOut(text: string, readings: readonly string[] = []): Layout {
  const glyphs = Array.from(text);
  if (isChinese(text)) {
    const cells = glyphs
      .map((glyph, from) => ({ glyph, reading: readings[from] ?? "", from }))
      .filter(({ glyph }) => !/\s/u.test(glyph));
    return { chinese: true, cells };
  }
  const cells: Cell[] = [];
  glyphs.forEach((glyph, from) => {
    if (/\s/u.test(glyph)) return;
    const word = cells.at(-1);
    const previous = glyphs[from - 1];
    if (word !== undefined && previous !== undefined && !/\s/u.test(previous)) word.glyph += glyph;
    else cells.push({ glyph, reading: "", from });
  });
  return { chinese: false, cells };
}

/** When `caption` shows, as a `performance.now()`: as it arrives, ahead of being said, but not while `previous` is still being said. */
export function shownFrom(caption: Caption, previous: Caption | undefined) {
  const free = previous ? previous.at + previous.duration * 1000 : caption.shown;
  return Math.min(caption.at, Math.max(caption.shown, free));
}

/** How far `caption` has appeared at `now`, from 0 to 1, showing from `from`. */
export function shownBy(from: number, now: number) {
  return Math.min(1, Math.max(0, (now - from) / SHOW_MS));
}

/** How far across each of `layout`'s cells the ink has swept at `now`, from 0 to 1: from when its first character is said until the next cell's is. */
export function sungBy(caption: Caption, layout: Layout, now: number) {
  const starts = layout.cells.map((cell) => caption.said[cell.from] ?? 0);
  const elapsed = (now - caption.at) / 1000;
  return starts.map((start, index) => {
    const next = starts[index + 1] ?? caption.duration;
    const sweep = Math.min(SWEEP.most, Math.max(SWEEP.least, next - start));
    return Math.min(1, Math.max(0, (elapsed - start) / sweep));
  });
}

/** How much ink `caption` keeps at `now`, from 1 to 0; `next` is when the next one shows. */
export function inkLeft(caption: Caption, now: number, next: number | null) {
  const written = caption.at + caption.duration * 1000;
  const fading = Math.max(0, now - written - HOLD_MS) / FADE_MS;
  const givenWay = next === null ? 0 : Math.max(0, now - next) / GIVE_WAY_MS;
  return Math.max(0, 1 - Math.max(fading, givenWay));
}
