import type { CountryCode } from "@/shared/api/commands.ts";
import type { Layout } from "@/pages/radio/lib/captions.ts";
import type { Poses } from "@/pages/radio/lib/mood.ts";
import { INK, PAPER, type Tone } from "@/pages/radio/lib/ink-tone.ts";

/*
 * The radio's painting: a leaf of Min Zhen's album of 1788 for each place, cut
 * into ink by `mise art:ink` and laid over paper. One part of each leaf, a head
 * or a boat, is cut free and drawn by the listener layer so it can move with the
 * music. Leaves are measured in their own units, the layer's pixels at 1600 tall,
 * and cover the screen keeping their proportions, centred on their focus.
 */

const LEAF_HEIGHT = 1600;
/** Units at the top of a leaf that fade into the paper above it. */
const TOP_FADE = 140;

type Point = [number, number];
type Random = () => number;
type Context = CanvasRenderingContext2D;

function seeded(seed: number): Random {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothNoise(random: Random) {
  const values = Array.from({ length: 256 }, random);
  return (x: number) => {
    const i = Math.floor(x);
    const t = (1 - Math.cos((x - i) * Math.PI)) / 2;
    return values[i & 255] * (1 - t) + values[(i + 1) & 255] * t;
  };
}

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

/** Points along `path`, `spacing` apart. */
function resample(path: Point[], spacing: number): Point[] {
  const out: Point[] = [path[0]];
  let since = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const length = Math.hypot(bx - ax, by - ay);
    if (!length) continue;
    let d = spacing - since;
    while (d <= length) {
      out.push([ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length]);
      d += spacing;
    }
    since = length - (d - spacing);
  }
  const last = path[path.length - 1];
  if (since > spacing * 0.3 || out.length < 2) out.push(last);
  return out;
}

function normalAt(points: Point[], i: number): Point {
  const a = points[Math.max(0, i - 1)];
  const b = points[Math.min(points.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

interface BrushOptions {
  width?: number;
  /** How dark the loaded brush is, 0 to 1. */
  ink?: number;
  /** How dry the brush is: dry bristles run out and leave flying white. */
  dry?: number;
  /** The share of the stroke spent pressing down and lifting off. */
  taper?: [number, number];
  /** Loads one side of the brush more than the other, as in a side-brush stroke; −1 to 1. */
  side?: number;
  color?: string;
}

/** One stroke of a brush whose bristles each carry their own ink and run dry on their own. */
function brush(
  ctx: Context,
  random: Random,
  path: Point[],
  {
    width = 3,
    ink = 0.85,
    dry = 0.25,
    taper = [0.15, 0.35],
    side = 0,
    color = INK,
  }: BrushOptions = {}
) {
  const points = resample(path, clamp(width / 4, 0.3, 1.5));
  const n = points.length;
  if (n < 2) return;
  const widths = points.map((_, i) => {
    const t = i / (n - 1);
    const press = taper[0] ? Math.min(1, t / taper[0]) : 1;
    const lift = taper[1] ? Math.min(1, (1 - t) / taper[1]) : 1;
    return (
      width *
      (0.35 + 0.65 * Math.sin((press * Math.PI) / 2)) *
      (0.08 + 0.92 * Math.sin((lift * Math.PI) / 2))
    );
  });
  const normals = points.map((_, i) => normalAt(points, i));
  const count = clamp(Math.round(width * 2.4), 2, 24);
  const texture = smoothNoise(random);
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  for (let b = 0; b < count; b++) {
    const offset = (b + 0.5) / count - 0.5 + ((random() - 0.5) * 0.5) / count;
    const load = clamp(1 - dry * random() * 0.5 + side * offset * 1.4, 0.1, 1.2);
    const rim = 1 - 0.45 * (2 * offset) ** 2;
    const thirst = dry * (0.5 + random());
    const seed = random() * 200;
    for (let i = 0; i < n - 1; i += 3) {
      const end = Math.min(n - 1, i + 3);
      const mid = (i + end) >> 1;
      const t = mid / (n - 1);
      const left = load - thirst * t + (texture(seed + mid * 0.22) - 0.5) * dry * 1.5;
      if (left < 0.25 * dry + 0.04) continue;
      ctx.strokeStyle = `rgba(${color},${ink * rim * clamp(0.35 + left * 0.65)})`;
      ctx.lineWidth = Math.max(0.3, (widths[mid] / count) * 2.2);
      ctx.beginPath();
      for (let k = i; k <= end; k++) {
        const x = points[k][0] + normals[k][0] * offset * widths[k];
        const y = points[k][1] + normals[k][1] * offset * widths[k];
        if (k === i) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

export type LayerName =
  | "dozing-under-pine"
  | "su-dongpo"
  | "river-landscape"
  | "scholar-at-waterfall";

interface Leaf {
  layer: LayerName;
  /** The part that moves: its outline, and the point it turns about. */
  part: Point[];
  pivot: Point;
  /** The furthest the part turns, in radians: further and the cut would show. */
  turn: number;
  /** A boat rocks and bobs on its own as well as to the music. */
  afloat?: boolean;
  /** The x a screen narrower than the leaf centres on, as far as the leaf's edges allow; the leaf's middle when unset. */
  focus?: number;
  /** Where notes, and sleep, float up from. */
  crown: Point;
  /** Which way the listener looks: words leave his mouth (or crown) that way. */
  facing: 1 | -1;
  /** Where subtitles go instead of beside his mouth: beside `beside` the way he faces, to clear what lies between, centred above his crown, for a figure with no room beside him, or in lines on the water, starting at `water` below what floats there and as wide as the screen allows, with their reflection beneath. */
  caption?: "above" | { beside: Point } | { water: Point };
  /** Where the scroll lies while the radio records. */
  hands: Point;
  /** A jaw inside the part, hinged near the ear, that drops as he speaks to show the dark of his mouth. */
  jaw?: { part: Point[]; hinge: Point; mouth: Point; open: number };
  /** Someone asleep beside him who wakes to talk: his head, the neck it lifts about, how far, how far it turns awake, and where his words rise. */
  partner?: {
    part: Point[];
    pivot: Point;
    wake: number;
    turn: number;
    crown: Point;
    facing: 1 | -1;
  };
}

/** How the figures hold themselves, as `makeMover` says, and whether the listener writes. */
export interface ListenerPose extends Poses {
  writing: boolean;
  /** Seconds, for what moves on its own: a boat on the water. */
  time: number;
}

/** Each place's leaf, and the part of it that moves. */
export const LEAVES: Record<CountryCode, Leaf> = {
  // Lu Tong, the poet of tea, reclining under his pine while his servant sleeps.
  CN: {
    layer: "dozing-under-pine",
    part: [
      [543, 694],
      [565, 680],
      [590, 674],
      [625, 676],
      [658, 688],
      [668, 712],
      [662, 740],
      [652, 770],
      [636, 795],
      [622, 806],
      [616, 850],
      [596, 890],
      [552, 920],
      [502, 945],
      [470, 956],
      [490, 900],
      [510, 850],
      [524, 806],
      [534, 786],
      [538, 760],
      [540, 735],
      [535, 712],
    ],
    pivot: [585, 815],
    turn: 0.07,
    crown: [614, 672],
    facing: -1,
    hands: [520, 1064],
    jaw: {
      part: [
        [526, 803],
        [548, 804],
        [578, 800],
        [602, 806],
        [621, 807],
        [616, 850],
        [596, 890],
        [552, 920],
        [502, 945],
        [470, 956],
        [490, 900],
        [510, 850],
      ],
      hinge: [610, 790],
      mouth: [556, 811],
      open: 0.035,
    },
    // His servant, asleep on his arm.
    partner: {
      part: [
        [100, 712],
        [125, 700],
        [160, 695],
        [195, 700],
        [214, 715],
        [218, 745],
        [214, 780],
        [200, 800],
        [170, 810],
        [135, 808],
        [108, 795],
        [96, 770],
        [94, 740],
      ],
      pivot: [200, 805],
      wake: 0.12,
      turn: 0.05,
      crown: [160, 697],
      facing: 1,
    },
  },
  // Su Dongpo, who lived out his exile at Huizhou, up the coast from Hong Kong.
  HK: {
    layer: "su-dongpo",
    part: [
      [470, 558],
      [512, 572],
      [514, 615],
      [490, 632],
      [483, 645],
      [496, 665],
      [500, 700],
      [480, 730],
      [450, 770],
      [422, 820],
      [406, 860],
      [393, 852],
      [392, 800],
      [391, 745],
      [393, 700],
      [392, 670],
      [393, 630],
      [405, 600],
      [430, 573],
    ],
    pivot: [450, 725],
    turn: 0.07,
    crown: [470, 560],
    facing: -1,
    caption: "above",
    hands: [420, 836],
  },
  // A boat poling home through the reeds on a misty river.
  TW: {
    layer: "river-landscape",
    part: [
      [20, 1080],
      [60, 1055],
      [80, 1050],
      [128, 1041],
      [150, 1058],
      [280, 1058],
      [292, 1052],
      [302, 1072],
      [412, 1070],
      [414, 1086],
      [330, 1106],
      [150, 1117],
      [60, 1108],
      [18, 1100],
    ],
    pivot: [215, 1095],
    turn: 0.02,
    afloat: true,
    focus: 215,
    crown: [78, 1050],
    facing: 1,
    caption: { water: [230, 1150] },
    hands: [96, 1078],
  },
  // An old scholar, hands folded, listening to a waterfall while his boy holds his staff.
  MO: {
    layer: "scholar-at-waterfall",
    part: [
      [226, 790],
      [225, 772],
      [233, 761],
      [248, 755],
      [264, 759],
      [273, 770],
      [274, 787],
      [268, 802],
      [262, 818],
      [254, 826],
      [246, 816],
      [236, 806],
    ],
    pivot: [250, 815],
    turn: 0.07,
    crown: [249, 755],
    facing: 1,
    // Clear of his robe, which flares out to his right.
    caption: { beside: [285, 770] },
    hands: [262, 845],
    // His boy, who looks up to answer him.
    partner: {
      part: [
        [112, 878],
        [114, 860],
        [124, 850],
        [138, 847],
        [150, 853],
        [152, 870],
        [150, 888],
        [144, 899],
        [132, 903],
        [120, 898],
      ],
      pivot: [133, 908],
      wake: -0.08,
      turn: 0.03,
      crown: [134, 847],
      facing: 1,
    },
  },
};

/** A leaf's size in its own units. */
export function leafSize(image: ImageBitmap) {
  return { width: (image.width * LEAF_HEIGHT) / image.height, height: LEAF_HEIGHT };
}

/** How a leaf of `image`'s proportions sits on a `width`×`height` canvas, in CSS pixels: covering it, centred on `focus`. */
function fit(width: number, height: number, image: ImageBitmap, focus?: number) {
  const units = (image.width * LEAF_HEIGHT) / image.height;
  const scale = Math.max(width / units, height / LEAF_HEIGHT);
  return {
    units,
    scale,
    left: clamp(width / 2 - (focus ?? units / 2) * scale, width - units * scale, 0),
    top: (height - LEAF_HEIGHT * scale) / 2,
  };
}

/** The transform that draws in a leaf's units onto a canvas of `width`×`height` CSS pixels. */
function leafTransform(
  width: number,
  height: number,
  pixelRatio: number,
  image: ImageBitmap,
  focus?: number
) {
  const { scale, left, top } = fit(width, height, image, focus);
  return [
    pixelRatio * scale,
    0,
    0,
    pixelRatio * scale,
    pixelRatio * left,
    pixelRatio * top,
  ] as const;
}

function outline(ctx: Context, points: Point[]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

type Transform = readonly [number, number, number, number, number, number];

/** A moving part, cut from the leaf once: its ink and its exact shape, where they sit on the canvas, and room to turn it in. */
interface Piece {
  ink: HTMLCanvasElement;
  shape: HTMLCanvasElement;
  x: number;
  y: number;
  scratch: HTMLCanvasElement;
}

/** Device pixels a piece may move beyond where it was cut. */
const ROOM = 40;

/** A turn about a point in leaf units, and how far it lifts, for a boat that bobs. */
interface Turn {
  about: Point;
  angle: number;
  lift?: number;
  /** How far the part moves forward or back, in units. */
  shift?: number;
}

/**
 * A pixel mask of `keep` without `drop`, on the canvas's grid. Its edge is hard,
 * not smoothed, so the hole cut with it and the piece cut with it fit exactly:
 * two smoothed edges meeting would leave a pale seam through every stroke.
 */
function mask(width: number, height: number, transform: Transform, keep: Point[], drop?: Point[]) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.setTransform(...transform);
  outline(ctx, keep);
  ctx.fill();
  if (drop) {
    ctx.globalCompositeOperation = "destination-out";
    outline(ctx, drop);
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  const alpha = pixels.data;
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let i = 3; i < alpha.length; i += 4) {
    alpha[i] = alpha[i] >= 128 ? 255 : 0;
    if (!alpha[i]) continue;
    const x = ((i - 3) / 4) % width;
    const y = Math.floor((i - 3) / 4 / width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  ctx.putImageData(pixels, 0, 0);
  if (right < 0) return null;
  return { canvas, left, top, width: right - left + 1, height: bottom - top + 1 };
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Cuts the part `cut` covers out of `ink`, and keeps it as a piece. */
function cutPiece(ink: Context, cut: NonNullable<ReturnType<typeof mask>>): Piece | null {
  const shape = canvasOf(cut.width, cut.height);
  const piece = canvasOf(cut.width, cut.height);
  const shapeCtx = shape.getContext("2d");
  const pieceCtx = piece.getContext("2d");
  if (!shapeCtx || !pieceCtx) return null;
  shapeCtx.drawImage(cut.canvas, -cut.left, -cut.top);
  pieceCtx.drawImage(ink.canvas, -cut.left, -cut.top);
  pieceCtx.globalCompositeOperation = "destination-in";
  pieceCtx.drawImage(shape, 0, 0);
  ink.save();
  ink.setTransform(1, 0, 0, 1, 0, 0);
  ink.globalCompositeOperation = "destination-out";
  ink.drawImage(cut.canvas, 0, 0);
  ink.restore();
  return {
    ink: piece,
    shape,
    x: cut.left,
    y: cut.top,
    scratch: canvasOf(cut.width + ROOM * 2, cut.height + ROOM * 2),
  };
}

/**
 * Draws `piece` moved by `turns`, applied in order, onto `ctx` (which draws in leaf
 * units by `transform`). Wherever the piece moves off the hole it was cut from, the
 * ink that was there shows instead of bare paper; `under` paints beneath the moved
 * piece, in leaf units.
 */
function drawMoved(
  ctx: Context,
  transform: Transform,
  piece: Piece,
  turns: Turn[],
  under?: (ctx: Context) => void
) {
  const scratch = piece.scratch.getContext("2d");
  if (!scratch) return;
  const [scale, , , , x, y] = transform;
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.clearRect(0, 0, piece.scratch.width, piece.scratch.height);
  scratch.drawImage(piece.ink, ROOM, ROOM);
  scratch.setTransform(scale, 0, 0, scale, x - piece.x + ROOM, y - piece.y + ROOM);
  for (const { about, angle, lift = 0, shift = 0 } of turns) {
    scratch.translate(about[0] + shift, about[1] + lift);
    scratch.rotate(angle);
    scratch.translate(-about[0], -about[1]);
  }
  const place = (image: HTMLCanvasElement) =>
    scratch.drawImage(
      image,
      (piece.x - x) / scale,
      (piece.y - y) / scale,
      image.width / scale,
      image.height / scale
    );
  scratch.globalCompositeOperation = "destination-out";
  place(piece.shape);
  scratch.globalCompositeOperation = "source-over";
  under?.(scratch);
  place(piece.ink);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(piece.scratch, piece.x - ROOM, piece.y - ROOM);
  ctx.restore();
}

function drawLeaf(ctx: Context, image: ImageBitmap) {
  ctx.drawImage(image, 0, 0, (image.width * LEAF_HEIGHT) / image.height, LEAF_HEIGHT);
}

/** Paper the size of the canvas: an even ground, mottled where it took up its size unevenly, with fibres and darker edges. */
function paper(ctx: Context) {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgb(${PAPER})`;
  ctx.fillRect(0, 0, width, height);
  const random = seeded(3);
  for (let i = 0; i < 40; i++) {
    const x = random() * width;
    const y = random() * height;
    const radius = (0.05 + random() * 0.2) * Math.max(width, height);
    const blot = ctx.createRadialGradient(x, y, 0, x, y, radius);
    blot.addColorStop(0, `rgba(120,105,85,${0.015 + random() * 0.025})`);
    blot.addColorStop(1, "rgba(120,105,85,0)");
    ctx.fillStyle = blot;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const fibers = Math.round((width * height) / 3000);
  ctx.lineWidth = 1;
  for (let i = 0; i < fibers; i++) {
    const x = random() * width;
    const y = random() * height;
    const angle = random() * Math.PI;
    const length = 6 + random() * 40;
    ctx.strokeStyle =
      random() < 0.3
        ? `rgba(255,255,255,${0.25 + random() * 0.3})`
        : `rgba(130,115,90,${0.03 + random() * 0.05})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * length * 0.5 + (random() - 0.5) * 8,
      y + Math.sin(angle) * length * 0.5 + (random() - 0.5) * 8,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length
    );
    ctx.stroke();
  }
  const edge = ctx.createRadialGradient(
    width / 2,
    height * 0.45,
    Math.min(width, height) * 0.4,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.8
  );
  edge.addColorStop(0, "rgba(110,95,70,0)");
  edge.addColorStop(1, "rgba(110,95,70,0.12)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, width, height);
}

/** A painted place: how its leaf sits on the canvas, and the parts of it that move. */
export interface Scene {
  region: CountryCode;
  transform: Transform;
  /** The leaf's ink on the canvas's grid, without its moving parts: what light at night falls behind. */
  ink: HTMLCanvasElement;
  head: Piece;
  jaw?: Piece;
  partner?: Piece;
}

/**
 * Paints `region`'s leaf onto `canvas`, sized to `width`×`height` CSS pixels:
 * paper, or the `ground` given instead, and the leaf without its moving parts,
 * which it returns for `drawListener` to draw, its ink laid `inkStrength` deep.
 * Without `image` it is bare ground, and nothing moves.
 */
export function paintScene(
  canvas: HTMLCanvasElement,
  {
    region,
    width,
    height,
    pixelRatio,
    image,
    ground = paper,
    inkStrength = 1,
    erased,
  }: {
    region: CountryCode;
    width: number;
    height: number;
    pixelRatio: number;
    image?: ImageBitmap;
    ground?: (ctx: Context) => void;
    inkStrength?: number;
    /** A part of the leaf left out, its edges fading over `feather` units, because something live is drawn there instead. */
    erased?: { box: [number, number, number, number]; feather: number } | null;
  }
): Scene | null {
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ground(ctx);
  if (!image) return null;
  const ink = document.createElement("canvas");
  ink.width = canvas.width;
  ink.height = canvas.height;
  const layer = ink.getContext("2d");
  if (!layer) return null;
  const { part, jaw, partner, focus } = LEAVES[region];
  const transform = leafTransform(width, height, pixelRatio, image, focus);
  layer.setTransform(...transform);
  drawLeaf(layer, image);
  if (inkStrength > 1) {
    layer.globalAlpha = inkStrength - 1;
    drawLeaf(layer, image);
    layer.globalAlpha = 1;
  }
  const fade = layer.createLinearGradient(0, TOP_FADE, 0, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  layer.globalCompositeOperation = "destination-out";
  layer.fillStyle = fade;
  layer.fillRect(-10, -10, fit(width, height, image).units + 20, TOP_FADE + 10);
  if (erased)
    layer.drawImage(
      featheredBox(erased),
      erased.box[0],
      erased.box[1],
      erased.box[2] - erased.box[0],
      erased.box[3] - erased.box[1]
    );
  layer.globalCompositeOperation = "source-over";

  const piece = (keep: Point[], drop?: Point[]) => {
    const cut = mask(ink.width, ink.height, transform, keep, drop);
    return cut ? (cutPiece(layer, cut) ?? undefined) : undefined;
  };
  const jawPiece = jaw && piece(jaw.part);
  const head = piece(part, jaw?.part);
  const partnerPiece = partner && piece(partner.part);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(ink, 0, 0);
  if (!head) return null;
  return { region, transform, ink, head, jaw: jawPiece, partner: partnerPiece };
}

/** A box, at a pixel for every two units, opaque but for edges fading out over `feather` units. */
function featheredBox({
  box: [left, top, right, bottom],
  feather,
}: {
  box: [number, number, number, number];
  feather: number;
}) {
  const width = Math.max(1, Math.ceil((right - left) / 2));
  const height = Math.max(1, Math.ceil((bottom - top) / 2));
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width, height });
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const pixels = ctx.createImageData(width, height);
  const ramp = (distance: number) => {
    const t = clamp(distance / feather);
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) * 2;
      const v = (y + 0.5) * 2;
      const edge = Math.min(u, v, right - left - u, bottom - top - v);
      pixels.data[(y * width + x) * 4 + 3] = Math.round(255 * ramp(edge));
    }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/** Puts `scene`'s moving parts back, still, into the holes `paintScene` cut for them on `canvas`. */
export function restScene(canvas: HTMLCanvasElement, scene: Scene) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const piece of [scene.jaw, scene.head, scene.partner]) {
    if (piece) ctx.drawImage(piece.ink, piece.x, piece.y);
  }
  ctx.restore();
}

function scroll(ctx: Context, random: Random, time: number) {
  ctx.fillStyle = `rgba(${PAPER},1)`;
  ctx.fillRect(334, 262, 20, 8);
  ctx.strokeStyle = `rgba(${INK},0.8)`;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(334, 262, 20, 8);
  for (let k = 0; k < 3; k++) {
    brush(
      ctx,
      random,
      [
        [351 - k * 5, 263.5],
        [351 - k * 5, 268.5],
      ],
      { width: 0.7, ink: 0.5, dry: 0, taper: [0, 0] }
    );
  }
  const x = 342 + Math.sin(time * 5) * 4;
  const y = 262 + Math.cos(time * 7) * 1.2;
  brush(
    ctx,
    random,
    [
      [x, y],
      [x + 5, y - 11],
    ],
    { width: 1.2, ink: 0.95, dry: 0, taper: [0, 0] }
  );
}

/** Where subtitles are written from in `region`'s leaf: the listener's mouth and the way he faces, above his crown, or on the water. */
export function captionAnchor(region: CountryCode): CaptionAnchor {
  const { caption, facing, jaw, crown } = LEAVES[region];
  if (caption === "above") return { above: crown };
  if (caption && "beside" in caption) return { at: caption.beside, facing };
  if (caption) return caption;
  return { at: jaw?.mouth ?? crown, facing };
}

/**
 * The moving parts of `scene`, on a context drawing in leaf units: each head held as `figures`
 * say, turned about its neck (a pitch of 1 lifts the chin as far as the leaf allows) and moved
 * the way it faces by its lean, or a boat rocking on the water; the listener's jaw open as
 * he speaks; a sleeping partner woken to join in; and, while `writing`, a scroll at the
 * listener's hands.
 */
export function drawListener(
  ctx: Context,
  scene: Scene,
  { figures: [listener, other], awake, writing, time }: ListenerPose
) {
  const { pivot, turn, afloat, hands, jaw, partner, facing } = LEAVES[scene.region];
  const { transform } = scene;
  // Lifting the chin turns the head away from the way it faces.
  const pitched = (pitch: number, most: number, way: 1 | -1) => -way * clamp(pitch, -1, 1) * most;
  const nod: Turn = {
    about: pivot,
    angle:
      (afloat ? Math.sin(time * 0.8) * turn * 0.6 : 0) +
      pitched(listener.pitch, turn, facing) * (afloat ? 0.5 : 1),
    lift: afloat ? Math.sin(time * 1.1) * 3 : 0,
    shift: facing * listener.lean,
  };
  const speaking = listener.jaw;
  drawMoved(ctx, transform, scene.head, [nod]);
  if (jaw && scene.jaw) {
    const mouth = (on: Context) => {
      if (speaking <= 0) return;
      on.save();
      on.translate(...jaw.mouth);
      on.scale(1, 0.3);
      const dark = on.createRadialGradient(0, 0, 0, 0, 0, 16);
      dark.addColorStop(0, `rgba(${INK},${0.8 * speaking})`);
      dark.addColorStop(1, `rgba(${INK},0)`);
      on.fillStyle = dark;
      on.beginPath();
      on.arc(0, 0, 16, 0, Math.PI * 2);
      on.fill();
      on.restore();
    };
    drawMoved(
      ctx,
      transform,
      scene.jaw,
      [nod, { about: jaw.hinge, angle: -speaking * jaw.open }],
      mouth
    );
  }
  if (partner && scene.partner) {
    // He has no jaw to work, so his chin dips with each syllable instead.
    const pitch = other.pitch - other.jaw * 0.3;
    drawMoved(ctx, transform, scene.partner, [
      {
        about: partner.pivot,
        angle: awake * partner.wake + pitched(pitch, partner.turn, partner.facing),
        shift: partner.facing * other.lean * awake,
      },
    ]);
  }
  if (writing) {
    ctx.save();
    ctx.translate(...hands);
    ctx.scale(3.6, 3.6);
    ctx.translate(-344, -266);
    scroll(ctx, seeded(77), time);
    ctx.restore();
  }
}

/** A drift of mist across the leaf, `phase` seconds into its slow swing. */
export function drawDrift(ctx: Context, phase: number, tone: Tone) {
  ctx.save();
  ctx.translate(500 + Math.sin(phase / 40) * 140, 640);
  ctx.scale(1, 0.14);
  const drift = ctx.createRadialGradient(0, 0, 0, 0, 0, 560);
  drift.addColorStop(0, `rgba(${tone.mist},${0.5 * tone.mistAlpha})`);
  drift.addColorStop(1, `rgba(${tone.mist},0)`);
  ctx.fillStyle = drift;
  ctx.beginPath();
  ctx.arc(0, 0, 560, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The part of the leaf on screen, in leaf units. */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How subtitles are written, in leaf units: their size, how far beside the mouth or above the crown, how far above the mouth, and how far from the screen's edge. */
const CAPTION = { size: 40, gap: 60, above: 40, lift: 170, margin: 30 } as const;
/** The blurs, as fractions of the glyph size, of the paper shadows laid behind a caption: a tight one for edges, wider ones for the glow. */
const CAPTION_SHADOW = [0.15, 0.4, 0.8] as const;
/** The width, as a fraction of the glyph size, of the paper stroke that thickens each glyph's halo so its glow spreads past the thin brush lines. */
const CAPTION_HALO = 0.22;
/** A reflection on the water: how strong it starts, the height of each rippling slice, and how far and fast they sway. */
const REFLECTION = { ink: 0.32, slice: 3, sway: 2.5, ripples: 0.3, speed: 2.4 } as const;

export type CaptionAnchor = { at: Point; facing: 1 | -1 } | { above: Point } | { water: Point };

/**
 * A subtitle written beside its speaker, the way he faces, centred above his
 * crown, or in lines on the water above its rippling reflection: each cell of
 * `layout` with as much ink as `inks` gives it, haloed in paper so the painting never runs
 * through them, kept within `bounds`, in `tone`'s writing. `time` (seconds) moves the ripples.
 */
export function drawCaption(
  ctx: Context,
  layout: Layout,
  inks: readonly number[],
  anchor: CaptionAnchor,
  { alpha, bounds, time, tone }: { alpha: number; bounds: Bounds; time: number; tone: Tone }
) {
  const { size, gap, above, lift, margin } = CAPTION;
  ctx.save();
  const latin = size * 0.7;
  ctx.font = layout.vertical
    ? `700 ${size}px "LXGW WenKai", "LXGW WenKai TC", serif`
    : `700 ${latin}px "LXGW WenKai", serif`;
  // On the water even Chinese runs in lines, as long as the screen is wide: a column's reflection would sink off the screen.
  const inLines = "water" in anchor && layout.vertical;
  const column = size * 1.3;
  const advance = size * 1.05;
  const row = layout.vertical ? size * 1.12 : latin * 1.35;
  const perLine = Math.max(1, Math.floor((bounds.right - bounds.left - 2 * margin) / advance));
  const lines = Math.ceil(layout.cells.length / perLine);
  const width = inLines
    ? Math.min(layout.cells.length, perLine) * advance
    : layout.vertical
      ? layout.columns * column
      : Math.max(...layout.cells.map((cell) => ctx.measureText(cell.glyph).width));
  const height = inLines ? lines * column : layout.rows * row;
  const between = (value: number, low: number, high: number) =>
    Math.min(Math.max(value, low), Math.max(low, high));
  const [x, y] =
    "water" in anchor
      ? [anchor.water[0] - width / 2, anchor.water[1]]
      : "above" in anchor
        ? [anchor.above[0] - width / 2, anchor.above[1] - above - height]
        : [
            anchor.facing > 0 ? anchor.at[0] + gap : anchor.at[0] - gap - width,
            anchor.at[1] - lift,
          ];
  const left = between(x, bounds.left + margin, bounds.right - margin - width);
  // Writing on the water never climbs over what floats on it.
  const top =
    "water" in anchor
      ? Math.max(y, bounds.top + margin)
      : between(y, bounds.top + margin, bounds.bottom - margin - height);
  ctx.textBaseline = "top";
  ctx.textAlign = layout.vertical && !inLines ? "center" : "left";
  const write = (halo = false) => {
    const base = ctx.globalAlpha;
    layout.cells.forEach((cell, index) => {
      const ink = inks[index] ?? 0;
      if (ink <= 0) return;
      ctx.globalAlpha = base * ink;
      const [cellX, cellY] = inLines
        ? [left + (index % perLine) * advance, top + Math.floor(index / perLine) * column]
        : [
            layout.vertical ? left + width - column * (cell.column + 0.5) : left,
            top + cell.row * row,
          ];
      if (halo) ctx.strokeText(cell.glyph, cellX, cellY);
      ctx.fillText(cell.glyph, cellX, cellY);
    });
    ctx.globalAlpha = base;
  };
  // A soft wash of paper behind the words lifts them off the painting without a hard outline.
  ctx.save();
  ctx.fillStyle = `rgba(${tone.paper},${0.6 * alpha})`;
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = size * CAPTION_HALO;
  ctx.lineJoin = "round";
  ctx.shadowColor = `rgba(${tone.paper},${alpha})`;
  // Shadows ignore the transform, so the blur is scaled to the screen by hand.
  const scale = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
  for (const blur of CAPTION_SHADOW) {
    ctx.shadowBlur = size * blur * scale;
    write(true);
  }
  ctx.restore();
  ctx.fillStyle = `rgba(${tone.writing},${0.92 * alpha})`;
  write();
  if ("water" in anchor) {
    // Mirrored about the surface in thin slices, each swaying on its own ripple, fading with depth.
    const { ink, slice, sway, ripples, speed } = REFLECTION;
    const surface = top + height;
    for (let depth = 0; depth < height; depth += slice) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left - margin, surface + depth, width + 2 * margin, slice + 0.5);
      ctx.clip();
      ctx.globalAlpha = ink * (1 - depth / height);
      const shift = Math.sin(depth * ripples - time * speed) * sway * (1 + depth / height);
      ctx.translate(shift, 2 * surface);
      ctx.scale(1, -1);
      write();
      ctx.restore();
    }
  }
  ctx.restore();
}
