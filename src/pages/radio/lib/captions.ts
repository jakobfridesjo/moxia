/*
 * Subtitles written into the painting: Chinese a character to a cell, anything
 * else a word to a cell, which the painter wraps into lines. Each cell fades in
 * as it is said; the caption stays a while, then fades, faster once the next
 * thing is said.
 */

import type { Caption } from "@/features/player/model/subtitles.ts";

/** How long a caption stays once all of it is written, and how long it takes to fade, in ms. */
const HOLD_MS = 3500;
const FADE_MS = 1500;
/** How fast one fades once the next thing is said. */
const GIVE_WAY_MS = 500;
/** How long each character takes to fade in once it is said, in ms. */
const INK_IN_MS = 400;

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

/** How much ink each of `layout`'s cells has taken at `now`, from 0 to 1: each fades in as its first character is said. */
export function inkIn(caption: Caption, layout: Layout, now: number) {
  return layout.cells.map((cell) => {
    const said = caption.at + (caption.said[cell.from] ?? 0) * 1000;
    return Math.min(1, Math.max(0, (now - said) / INK_IN_MS));
  });
}

/** How much ink `caption` keeps at `now`, from 1 to 0; `next` is when the next thing was said. */
export function inkLeft(caption: Caption, now: number, next: number | null) {
  const written = caption.at + caption.duration * 1000;
  const fading = Math.max(0, now - written - HOLD_MS) / FADE_MS;
  const givenWay = next === null ? 0 : Math.max(0, now - next) / GIVE_WAY_MS;
  return Math.max(0, 1 - Math.max(fading, givenWay));
}
