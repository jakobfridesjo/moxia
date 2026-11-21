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

export const MOONLIT = "176,188,206";

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

/** The mountain path's paper at night, moonlit from above, as "r,g,b": its top and its foot. */
export const PATH_NIGHT_SKY = "74,80,94";
export const PATH_NIGHT_GROUND = "46,50,60";
/** The glow round the old man at night, the houses' lamplight and a burning slip's, as warm as the boat's lamp by the river. */
export const FIRELIGHT = "255,138,42";

/**
 * Night on the mountain path: its ink stays black on paper dimmed by the moon, as on the radio's
 * paintings, and its weather takes the radio's night colours; mist closes over it in the paper's own.
 */
export const PATH_NIGHT_TONE: Tone = { ...NIGHT_TONE, paper: PATH_NIGHT_GROUND };
