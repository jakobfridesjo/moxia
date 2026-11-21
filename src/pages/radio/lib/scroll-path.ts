/**
 * The walk up Chen Chun's hanging scroll that the recordings stand along, measured
 * in the pixels of its ink layer (`ui/ink/monastery-path.webp`, 3600 tall).
 */
export const SCROLL = { width: 1435, height: 3600 } as const;

/**
 * Off the bridge onto the near bank, up between the tree trunks to the thatched huts,
 * back along the far shore under the village, up the stepped ledges to the pines and
 * the monastery, up beside the waterfall and over its source, along the ridge and up
 * the tall peak. It keeps to land: never across the river, never up the falling water.
 */
const WAYPOINTS: readonly (readonly [number, number])[] = [
  [232, 3334],
  [353, 3355],
  [408, 3371],
  [572, 3319],
  [766, 3167],
  [839, 2961],
  [1118, 2815],
  [815, 2791],
  [631, 2730],
  [416, 2730],
  [435, 2531],
  [211, 2342],
  [340, 2001],
  [511, 1932],
  [271, 1812],
  [384, 1555],
  [511, 1451],
  [768, 1606],
  [1215, 1487],
  [1000, 1324],
  [1057, 1177],
  [1082, 1007],
  [1088, 922],
  [1185, 874],
  [1283, 607],
  [907, 624],
  [511, 350],
  [409, 76],
];

/** Where lamplight shows in the houses at night: the two huts by the trees, the village, the monastery's two halls. */
export const LIT_WINDOWS: readonly (readonly [number, number])[] = [
  [1110, 2800],
  [1115, 2945],
  [415, 2575],
  [1000, 1330],
  [1200, 1495],
];

/** The open sky the moon lights at night, as ellipses: left of the peaks, the gap between them, and right over the poem. */
export const MOONLIT_SKY = [
  { x: 90, y: 450, across: 170, down: 520 },
  { x: 720, y: 260, across: 110, down: 320 },
  { x: 1180, y: 280, across: 320, down: 330 },
  { x: 950, y: 650, across: 220, down: 140 },
] as const;

/** The old man standing on the bridge, who walks to the recording that plays. */
export const TRAVELLER = {
  left: 196,
  top: 3245,
  width: 73,
  height: 106,
  /** Where his feet stand, which is where the path starts. */
  feet: WAYPOINTS[0],
  /** The bridge's deck, which stays behind: only his cane reaches below it. */
  deck: 3335,
} as const;

/** His dark cane, from the hand that grips it to its tip; he hits with it. */
export const CANE = {
  hand: [214, 3290],
  tip: [203, 3347],
  /** How far either side of the line from hand to tip the cane's ink reaches. */
  reach: 5,
  /** The hand and sleeve around the grip, which swing with it. */
  grip: { left: 205, top: 3286, right: 222, bottom: 3310 },
} as const;

/** Fainter than this, a stroke near the cane belongs to the robe behind it. */
const CANE_INK = 30;

/** Which part of the old man the painting's pixel at `x`, `y` with ink `alpha` (0–255) belongs to. */
export function travellerPart(x: number, y: number, alpha: number): "cane" | "body" | null {
  if (alpha === 0) return null;
  const [hx, hy] = CANE.hand;
  const [dx, dy] = [CANE.tip[0] - hx, CANE.tip[1] - hy];
  const u = Math.max(0, Math.min(1, ((x - hx) * dx + (y - hy) * dy) / (dx * dx + dy * dy)));
  const nearLine = Math.hypot(x - hx - u * dx, y - hy - u * dy) <= CANE.reach;
  const { grip } = CANE;
  const inGrip = x >= grip.left && x <= grip.right && y >= grip.top && y <= grip.bottom;
  if ((nearLine || inGrip) && alpha > CANE_INK) return "cane";
  return y < TRAVELLER.deck ? "body" : null;
}

/** How many recordings it takes to stand all the way up from the bridge to the peak. */
export const SLOTS_TO_PEAK = 24;
/** How far below the peak the oldest stands, once the path is full. */
const TOP_MARGIN = 80;
/** How far from the traveller on the bridge the newest recording stands. */
const BOTTOM_MARGIN = 110;

interface PathPoint {
  x: number;
  y: number;
  /** Distance along the path from the bridge. */
  at: number;
}

const STEPS_PER_LEG = 24;

/** The path as a smooth curve through the waypoints, sampled finely. */
function sample(): PathPoint[] {
  const points: PathPoint[] = [];
  const last = WAYPOINTS.length - 1;
  for (let i = 0; i < last; i++) {
    const [p0, p1, p2, p3] = [
      WAYPOINTS[Math.max(0, i - 1)],
      WAYPOINTS[i],
      WAYPOINTS[i + 1],
      WAYPOINTS[Math.min(last, i + 2)],
    ];
    for (let step = 0; step < STEPS_PER_LEG; step++) {
      const t = step / STEPS_PER_LEG;
      const along = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (c - a) * t +
          (2 * a - 5 * b + 4 * c - d) * t ** 2 +
          (3 * b - a - 3 * c + d) * t ** 3);
      points.push({
        x: along(p0[0], p1[0], p2[0], p3[0]),
        y: along(p0[1], p1[1], p2[1], p3[1]),
        at: 0,
      });
    }
  }
  points.push({ x: WAYPOINTS[last][0], y: WAYPOINTS[last][1], at: 0 });
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    b.at = a.at + Math.hypot(b.x - a.x, b.y - a.y);
  }
  return points;
}

const POINTS = sample();
export const PATH_LENGTH = POINTS[POINTS.length - 1].at;

export const clampToPath = (at: number) => Math.min(PATH_LENGTH, Math.max(0, at));

/** Where on the path `at` is, and which way it heads there as a unit vector. */
export function pointAt(at: number) {
  const target = clampToPath(at);
  let low = 0;
  let high = POINTS.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (POINTS[middle].at <= target) low = middle;
    else high = middle;
  }
  const [a, b] = [POINTS[low], POINTS[high]];
  const span = b.at - a.at || 1;
  const u = (target - a.at) / span;
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    dx: (b.x - a.x) / span,
    dy: (b.y - a.y) / span,
  };
}

/**
 * Where the recording `index` places from the newest stands, among `count`: the newest
 * just above the bridge, older ones further up. They keep an even pace up to the
 * peak, `SLOTS_TO_PEAK` of them, and close up once there are more.
 */
export function slotAt(index: number, count: number) {
  const gap = (PATH_LENGTH - TOP_MARGIN - BOTTOM_MARGIN) / Math.max(SLOTS_TO_PEAK - 1, count - 1);
  return BOTTOM_MARGIN + index * gap;
}

/** The stretch of path from `from` to `to` as SVG path data, scaled by `scale`. */
export function pathData(from: number, to: number, scale: number) {
  const start = clampToPath(from);
  const end = clampToPath(to);
  const parts: string[] = [];
  const add = (at: number) => {
    const { x, y } = pointAt(at);
    parts.push(`${parts.length ? "L" : "M"}${(x * scale).toFixed(1)} ${(y * scale).toFixed(1)}`);
  };
  for (let at = start; at < end; at += 8) add(at);
  add(end);
  return parts.join("");
}
