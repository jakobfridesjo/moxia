/** Colours as "r,g,b", to fill into rgba(). */
export const INK = "20,19,18";
export const PAPER = "244,240,232";

/**
 * The colours laid over a painting: its weather's ink, its light marks (falling
 * water, catkin fluff), writing floated over it, the paper that writing is
 * haloed in and that closes over it once nothing plays, and its mist.
 */
export interface Tone {
  ink: string;
  light: string;
  writing: string;
  paper: string;
  mist: string;
  /** How thick the mist lies, against the day's. */
  mistAlpha: number;
  /** How far the mist's clouds are blurred, in pixels of its 256 tile: pale on dark, fine detail reads as hard blotches. */
  mistSoftness: number;
  /**
   * Smoke and steam: the colour filling a painted wisp, the colour of the puffs, how thick they lie
   * against the day's, and how many times over the wisp's faint ink is laid to carry its colour.
   */
  smoke: { wisp: string; puff: string; alpha: number; body: number };
  /** The colour falling leaves and needles turn, so they show on the dark; null keeps the painting's ink. */
  fallen: string | null;
}

export const DAY_TONE: Tone = {
  ink: INK,
  light: PAPER,
  writing: INK,
  paper: PAPER,
  mist: PAPER,
  mistAlpha: 1,
  mistSoftness: 0,
  smoke: { wisp: PAPER, puff: INK, alpha: 1, body: 1 },
  fallen: null,
};

const MOONLIT = "176,188,206";

/**
 * Night over the radio's paintings: their ink stays black under the moon, writing over them is pale
 * and haloed in the dark, and mist catches the moonlight, only faintly, since pale mist on dark paper
 * stands out far more than paper-white mist does on paper.
 */
export const NIGHT_TONE: Tone = {
  ink: INK,
  light: MOONLIT,
  writing: "241,224,192",
  paper: "10,11,13",
  mist: MOONLIT,
  mistAlpha: 0.2,
  mistSoftness: 7,
  // Grey and faint: ink-black smoke would vanish into the night, and it must not glow. The painted
  // wisp is barely there, so it is laid on thickly to show at all.
  smoke: { wisp: "136,136,142", puff: "136,136,142", alpha: 3, body: 8 },
  fallen: MOONLIT,
};

const PALE_INK = "232,222,204";

/** Night on the mountain path, whose painting turns pale on dark paper: its weather turns with it. */
export const PATH_NIGHT_TONE: Tone = {
  ink: PALE_INK,
  light: PALE_INK,
  writing: PALE_INK,
  paper: "29,26,23",
  mist: "58,60,66",
  mistAlpha: 0.8,
  mistSoftness: 0,
  smoke: { wisp: "58,60,66", puff: PALE_INK, alpha: 1, body: 1 },
  fallen: PALE_INK,
};
