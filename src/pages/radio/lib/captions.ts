/*
 * Subtitles written into the painting: Chinese in columns read top to bottom,
 * right to left, as the inscription is; anything else in lines. Characters
 * fade in as each is said, stay a while, then fade, faster once the next
 * thing is said.
 */

import type { Caption } from "@/features/player/model/subtitles.ts";

/** Characters to a column, and to a line of other scripts. */
export const COLUMN_LENGTH = 9;
const LINE_LENGTH = 18;
/** How long a caption stays once all of it is written, and how long it takes to fade, in ms. */
const HOLD_MS = 3500;
const FADE_MS = 1500;
/** How fast one fades once the next thing is said. */
const GIVE_WAY_MS = 500;
/** How long each character takes to fade in once it is said, in ms. */
const INK_IN_MS = 400;

/** Where each character goes: its column (0 read first) or line, and its place in it; `from` is which of the text's characters it starts with. */
interface Cell {
  glyph: string;
  column: number;
  row: number;
  from: number;
}

export interface Layout {
  vertical: boolean;
  cells: Cell[];
  columns: number;
  rows: number;
}

const HAN = /\p{Script=Han}/u;

/** Whether `text` is written in columns: when most of its letters are Chinese. */
export function isVertical(text: string) {
  const letters = Array.from(text).filter((glyph) => /\p{L}/u.test(glyph));
  const han = letters.filter((glyph) => HAN.test(glyph)).length;
  return letters.length > 0 && han * 2 >= letters.length;
}

/** Lays `text` out in columns of `COLUMN_LENGTH`, or lines of whole words up to `LINE_LENGTH`. */
export function layOut(text: string): Layout {
  const glyphs = Array.from(text);
  if (isVertical(text)) {
    const written = glyphs
      .map((glyph, from) => ({ glyph, from }))
      .filter(({ glyph }) => !/\s/u.test(glyph));
    const cells = written.map(({ glyph, from }, index) => ({
      glyph,
      column: Math.floor(index / COLUMN_LENGTH),
      row: index % COLUMN_LENGTH,
      from,
    }));
    return {
      vertical: true,
      cells,
      columns: Math.ceil(cells.length / COLUMN_LENGTH),
      rows: Math.min(cells.length, COLUMN_LENGTH),
    };
  }
  const words: { text: string; from: number }[] = [];
  glyphs.forEach((glyph, from) => {
    if (/\s/u.test(glyph)) return;
    const word = words.at(-1);
    const previous = glyphs[from - 1];
    if (word !== undefined && previous !== undefined && !/\s/u.test(previous)) word.text += glyph;
    else words.push({ text: glyph, from });
  });
  const lines: typeof words = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && last.text.length + 1 + word.text.length <= LINE_LENGTH)
      last.text = `${last.text} ${word.text}`;
    else lines.push({ ...word });
  }
  // A line is one cell, so each line appears as its first character is said.
  return {
    vertical: false,
    cells: lines.map((line, row) => ({ glyph: line.text, column: 0, row, from: line.from })),
    columns: 1,
    rows: lines.length,
  };
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
