import type { CountryCode } from "@/shared/api/commands.ts";
import type { Air } from "@/pages/radio/lib/air.ts";
import type { Tone } from "@/pages/radio/lib/ink-tone.ts";
import { blurred, blurredTile } from "@/pages/radio/lib/soften.ts";
import type { InkGL, InkLayers } from "@/pages/radio/lib/ink-gl.ts";
import { fallsBox, pour, type FallsLook, type Rows } from "@/pages/radio/lib/ink-falls.ts";

/*
 * The weather over each painting: fog, mist, clouds, smoke and falling water and
 * leaves, drawn on top of the leaf and never moving or stretching it. What falls
 * is cut out of the painting it falls from: the boxes below hold isolated marks
 * (one needle stroke, one leaf, one cloud) in the layer's units. Nothing here
 * follows the sound: it moves at its own steady pace while something plays, and
 * once nothing plays it slows and mist closes over the whole painting. Mist and
 * falling water are worked out on the GPU, on the layer under the figures (the
 * veil and the gust on the one over them); what is cut out of the painting is
 * drawn in 2D, over that mist.
 */

type Point = [number, number];
/** x, y, width and height, in layer units. */
type Box = [number, number, number, number];
/** Left, top, right and bottom as fractions of the layer. */
type Area = [number, number, number, number];
type Context = CanvasRenderingContext2D;

export type WeatherPlace = CountryCode | "path";

const CN_NEEDLES: Box[] = [
  [293, 27, 6, 24],
  [891, 256, 6, 14],
  [864, 298, 34, 17],
  [810, 375, 20, 11],
  [779, 391, 27, 14],
  [333, 405, 6, 24],
  [351, 418, 3, 16],
  [382, 460, 4, 16],
];
const TW_CLOUDS: Box[] = [
  [416, 393, 590, 190],
  [6, 583, 534, 155],
];
/** Su Dongpo's painted incense: the box it lies in. */
const HK_SMOKE_BOX: Box = [0, 356, 374, 439];
const MO_LEAVES: Box[] = [
  [120, 81, 11, 7],
  [123, 91, 10, 6],
  [109, 93, 11, 7],
  [268, 139, 10, 7],
  [248, 158, 10, 7],
  [283, 255, 12, 7],
  [265, 262, 7, 7],
  [295, 295, 10, 7],
  [262, 301, 7, 7],
  [294, 304, 9, 9],
  [269, 311, 9, 8],
  [279, 314, 10, 9],
  [254, 315, 10, 8],
  [220, 316, 12, 9],
  [235, 316, 8, 7],
  [233, 325, 9, 9],
  [218, 327, 11, 9],
  [209, 338, 8, 8],
  [202, 348, 10, 8],
  [181, 352, 9, 8],
  [232, 365, 10, 7],
  [183, 377, 9, 8],
  [191, 390, 9, 6],
  [240, 393, 8, 7],
  [228, 401, 9, 5],
  [226, 410, 11, 5],
];
/** Luo Ping's waterfall, as rows of centre x, y and half width, top to bottom: narrow where it pours over, misting wider down the cliff, then gathering to a point behind the trees above the rock ledge. */
const MO_FALLS: Rows = [
  [621, 0, 21],
  [632, 120, 40],
  [640, 220, 55],
  [638, 360, 50],
  [634, 480, 46],
  [622, 620, 38],
  [608, 720, 20],
  [603, 800, 4],
];
/** The river through the gorge, from the foot of the cliff downstream, as fractions of the leaf. */
const MO_RIVER: Point[] = [
  [0.78, 0.869],
  [0.625, 0.885],
  [0.417, 0.894],
  [0.208, 0.912],
  [0.028, 0.937],
];
/** The waterfall below the monastery, following the painted sheet as it bends and widens. */
const PATH_FALLS: Rows = [
  [1171, 1024, 9],
  [1162, 1109, 12],
  [1143, 1174, 14],
  [1136, 1239, 14],
  [1136, 1311, 18],
];

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const random = (low = 0, high = 1) => low + Math.random() * (high - low);

/** Tiling noise, 256 square, in five octaves. */
function tileNoise(size: number, seed: number) {
  const hash = (x: number, y: number, s: number) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let sum = 0;
  for (let octave = 0; octave < 5; octave++) {
    const period = 4 << octave;
    const cell = size / period;
    for (let y = 0; y < size; y++) {
      const gy = y / cell;
      const iy = Math.floor(gy);
      const fy = (gy - iy) ** 2 * (3 - 2 * (gy - iy));
      for (let x = 0; x < size; x++) {
        const gx = x / cell;
        const ix = Math.floor(gx);
        const fx = (gx - ix) ** 2 * (3 - 2 * (gx - ix));
        const corner = (cx: number, cy: number) => hash(cx % period, cy % period, seed + octave);
        const top = lerp(corner(ix, iy), corner(ix + 1, iy), fx);
        const bottom = lerp(corner(ix, iy + 1), corner(ix + 1, iy + 1), fx);
        out[y * size + x] += amplitude * lerp(top, bottom, fy);
      }
    }
    sum += amplitude;
    amplitude *= 0.5;
  }
  return out.map((value) => value / sum);
}

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

let noiseField: Float32Array | undefined;
/** The one tiling noise, 256 square, that mist and the ink bloom are made from. */
export function inkNoise() {
  noiseField ??= tileNoise(256, 7);
  return noiseField;
}

const fogTiles = new Map<string, HTMLCanvasElement>();
/** Mist of `color`: noise cut into soft clouds, transparent between, blurred by `softness` pixels. */
function fogTile(color: string, softness = 0) {
  const key = `${color}:${softness}`;
  const known = fogTiles.get(key);
  if (known) return known;
  const noise = inkNoise();
  const tile = canvasOf(256, 256);
  const ctx = tile.getContext("2d");
  if (!ctx) return tile;
  const pixels = ctx.createImageData(256, 256);
  const [r, g, b] = color.split(",").map(Number);
  noise.forEach((value, i) => {
    const t = clamp((value - 0.3) / 0.38);
    pixels.data.set([r, g, b, t * t * (3 - 2 * t) * 255], i * 4);
  });
  ctx.putImageData(pixels, 0, 0);
  const made = softness > 0 ? blurredTile(tile, softness) : tile;
  fogTiles.set(key, made);
  return made;
}

const puffSprites = new Map<string, HTMLCanvasElement>();
/** A soft round dab of thin `color`. */
function puff(color: string) {
  const known = puffSprites.get(color);
  if (known) return known;
  const sprite = canvasOf(64, 64);
  puffSprites.set(color, sprite);
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;
  const dab = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  dab.addColorStop(0, `rgba(${color},1)`);
  dab.addColorStop(0.45, `rgba(${color},0.45)`);
  dab.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = dab;
  ctx.fillRect(0, 0, 64, 64);
  return sprite;
}

/** What every effect over one painting shares: its layer, its size in units, what is on screen, and room to work in. */
interface Sky {
  image: CanvasImageSource;
  /** Image pixels per layer unit. */
  ratio: number;
  width: number;
  height: number;
  /** The part of the layer on screen, in units. */
  view: { left: number; top: number; right: number; bottom: number };
  time: number;
  /** How hard the wind blows, 1 as each painting was painted: more falls, and faster sideways. */
  gust: number;
  /** Effect seconds weighed by the wind, which mist drifts by, so a change of wind never makes it jump. */
  blown: number;
  tone: Tone;
  /** The layer mist and falling water are queued on now: under the figures, or over them. */
  gl: InkGL;
}

interface FogOptions {
  /** How far the mist drifts each second of effect time, in units. */
  drift?: Point;
  /** How big one tile of the noise is, in units. */
  grain: number;
  /** How much taller than wide the noise is drawn, for water falling. */
  stretch?: number;
  alpha: number;
  /** How much of the height, and of the width, fades in at each edge. */
  edge?: number;
  side?: number;
  /** How far the band slides with the screen's middle, as the camera moves past it. */
  parallax?: number;
  /** Paper instead of mist, for what closes over the painting once nothing plays. */
  paper?: boolean;
  /** How far the clouds are blurred, in pixels of the 256 tile, at least: high for an even fog with no shapes in it. */
  softness?: number;
}

/** The share of the screen's resolution mist's pattern is laid out at, which sets how its texels line up. */
const MIST_SCRATCH = 0.4;

/** Mist over `box`, faded at its edges, queued on the sky's layer; `ctx` says where layer units lie on the screen. */
function fog(ctx: Context, sky: Sky, [x, y, w, h]: Box, options: FogOptions) {
  const { drift = [6, 0], grain, stretch = 1, edge = 0.3, side = 0.18, parallax, paper } = options;
  const color = paper ? sky.tone.paper : sky.tone.mist;
  const alpha = options.alpha * (paper ? 1 : sky.tone.mistAlpha);
  const softness = Math.max(options.softness ?? 0, paper ? 0 : sky.tone.mistSoftness);
  const m = ctx.getTransform();
  const dw = w * m.a;
  const dh = h * m.d;
  const dx = m.a * x + m.e;
  let dy = m.d * y + m.f;
  if (parallax) dy += (dy + dh / 2 - ctx.canvas.height / 2) * parallax;
  const { width, height } = ctx.canvas;
  if (alpha <= 0.002 || dw <= 1 || dh <= 1 || !sky.gl.ready) return;
  if (dx + dw < 0 || dx > width || dy + dh < 0 || dy > height) return;
  // The tile is laid as a 2D canvas lays a pattern over a scratch of this share of the screen.
  const W = Math.ceil(dw * MIST_SCRATCH);
  const H = Math.ceil(dh * MIST_SCRATCH);
  const unit = m.a * MIST_SCRATCH;
  const tile = (grain * unit) / 256;
  const span = 256 * tile;
  sky.gl.mist({
    rect: [dx, dy, dw, dh],
    tile: fogTile(color, softness),
    scratch: [W, H],
    origin: [(sky.blown * drift[0] * unit) % span, (sky.time * drift[1] * unit) % (span * stretch)],
    cell: [tile, tile * stretch],
    alpha: Math.min(1, alpha),
    edge,
    side,
  });
}

/** Mist over an area given as fractions of the layer. */
function band(ctx: Context, sky: Sky, [u0, v0, u1, v1]: Area, options: FogOptions) {
  fog(
    ctx,
    sky,
    [u0 * sky.width, v0 * sky.height, (u1 - u0) * sky.width, (v1 - v0) * sky.height],
    options
  );
}

/** Copies each box of the layer to a canvas of its own; `soft` fades their edges, for washes. */
function cutouts(sky: Sky, boxes: Box[], soft = 0) {
  return boxes.map(([x, y, w, h]) => {
    const pad = 1;
    const W = Math.ceil((w + pad * 2) * sky.ratio);
    const H = Math.ceil((h + pad * 2) * sky.ratio);
    const canvas = canvasOf(W, H);
    const g = canvas.getContext("2d");
    if (!g) return canvas;
    g.drawImage(sky.image, (x - pad) * sky.ratio, (y - pad) * sky.ratio, W, H, 0, 0, W, H);
    if (soft) {
      g.globalCompositeOperation = "destination-in";
      for (const ramp of [g.createLinearGradient(0, 0, W, 0), g.createLinearGradient(0, 0, 0, H)]) {
        ramp.addColorStop(0, "rgba(0,0,0,0)");
        ramp.addColorStop(soft, "#000");
        ramp.addColorStop(1 - soft, "#000");
        ramp.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = ramp;
        g.fillRect(0, 0, W, H);
      }
    }
    return canvas;
  });
}

/** A painted wisp's ink laid `body` times over and softened, so its faint wash can carry a colour. */
function thickened(wisp: HTMLCanvasElement, body: number, ratio: number) {
  if (body <= 1) return wisp;
  const g = wisp.getContext("2d", { willReadFrequently: true });
  if (!g) return wisp;
  const pixels = g.getImageData(0, 0, wisp.width, wisp.height);
  for (let i = 3; i < pixels.data.length; i += 4)
    pixels.data[i] = Math.min(255, pixels.data[i] * body);
  g.putImageData(pixels, 0, 0);
  return blurred(wisp, 3 * ratio);
}

/** A point on a polyline at `t` (0 to 1 over its segments, carried on past 1), with the unit normal there. */
export function along(points: Point[], t: number): [number, number, number, number] {
  const f = Math.max(0, t) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(f));
  const k = f - i;
  const [x0, y0] = points[i];
  const [x1, y1] = points[i + 1];
  const length = Math.hypot(x1 - x0, y1 - y0) || 1;
  return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, -(y1 - y0) / length, (x1 - x0) / length];
}

interface Faller {
  x: number;
  y: number;
  sprite: HTMLCanvasElement;
  angle: number;
  spin: number;
  age: number;
  phase: number;
  pace: number;
}

/**
 * Cut-out marks coming loose from `from` and drifting down: each starts at the
 * angle it was painted, then turns, flutters and fades. Units are per second.
 * With `kindle`, each starts in the painting's ink and turns the tone's `fallen`
 * colour as it falls, as if dropping into firelight.
 */
function fallers(
  sky: Sky,
  sprites: HTMLCanvasElement[],
  {
    from,
    fall,
    sway,
    wind,
    spin,
    life,
    size = 1,
    kindle = false,
  }: {
    from: () => Point;
    fall: number;
    sway: number;
    wind: number;
    spin: number;
    life: number;
    size?: number;
    kindle?: boolean;
  }
) {
  const { fallen } = sky.tone;
  const lit = new Map<HTMLCanvasElement, HTMLCanvasElement>();
  if (fallen)
    for (const sprite of sprites) {
      const copy = kindle ? canvasOf(sprite.width, sprite.height) : sprite;
      const g = copy.getContext("2d");
      if (!g) continue;
      if (kindle) g.drawImage(sprite, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = `rgb(${fallen})`;
      g.fillRect(0, 0, copy.width, copy.height);
      if (kindle) lit.set(sprite, copy);
    }
  const falling: Faller[] = [];
  let owed = 0;
  return (ctx: Context, air: Air, seconds: number, rate: number) => {
    owed += seconds * rate * sky.gust;
    const count = Math.floor(owed);
    owed %= 1;
    for (let n = 0; n < count; n++) {
      const [x, y] = from();
      falling.push({
        x,
        y,
        sprite: sprites[Math.floor(Math.random() * sprites.length)],
        angle: 0,
        spin: random(-spin, spin),
        age: 0,
        phase: random(0, 6),
        pace: random(0.75, 1.25),
      });
    }
    const step = seconds * (0.25 + 0.75 * air.life);
    for (let i = falling.length - 1; i >= 0; i--) {
      const leaf = falling[i];
      leaf.age += step;
      if (leaf.age >= life) {
        falling.splice(i, 1);
        continue;
      }
      leaf.y += fall * leaf.pace * step;
      const blowing = wind * sky.gust + (Math.sign(wind) || 1) * (sky.gust - 1) * 25;
      leaf.x += (Math.sin(leaf.age * 1.7 + leaf.phase) * sway + blowing) * step;
      leaf.angle += leaf.spin * step * Math.abs(Math.sin(leaf.age * 1.3 + leaf.phase));
      if (leaf.y < sky.view.top - 50 || leaf.y > sky.view.bottom + 50) continue;
      const w = (leaf.sprite.width / sky.ratio) * size;
      const h = (leaf.sprite.height / sky.ratio) * size;
      ctx.save();
      ctx.globalAlpha = Math.min(1, leaf.age * 3) * Math.min(1, (life - leaf.age) / 1.5) * 0.9;
      ctx.translate(leaf.x, leaf.y);
      ctx.rotate(leaf.angle);
      ctx.scale(1, 0.3 + 0.7 * Math.abs(Math.cos(leaf.age * 2.2 * leaf.pace)));
      ctx.drawImage(leaf.sprite, -w / 2, -h / 2, w, h);
      const glowing = lit.get(leaf.sprite);
      if (glowing) {
        ctx.globalAlpha *= clamp(leaf.age / (life - 1.5)) ** 0.8;
        ctx.drawImage(glowing, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }
  };
}

/** Water misting down a painted sheet, worked out by the falls shader. */
function waterfall(sky: Sky, rows: Rows) {
  let fallen = 0;
  const [left, top, width, height] = fallsBox(rows);
  return (ctx: Context, air: Air, seconds: number) => {
    if (top + height < sky.view.top || top > sky.view.bottom) return;
    fallen += seconds * (24 + 80 * air.life);
    const look: FallsLook = {
      rows,
      flow: pour(fallen),
      time: sky.time,
      light: sky.tone.light.split(",").map(Number) as [number, number, number],
      alpha: { sheet: 0.3, steam: 0.3 },
    };
    const m = ctx.getTransform();
    sky.gl.falls({
      rect: [m.a * left + m.e, m.d * top + m.f, width * m.a, height * m.d],
      look,
      place: [m.e, m.f, m.a],
    });
  };
}

/** A thread of smoke rising `height` units from `base`, swaying more the higher it climbs. */
function ribbon(
  ctx: Context,
  sky: Sky,
  [x0, y0]: Point,
  height: number,
  {
    lean,
    sway,
    alpha,
    width,
    speed,
    seed = 0,
  }: { lean: number; sway: number; alpha: number; width: number; speed: number; seed?: number }
) {
  const steps = 24;
  const { time } = sky;
  let [px, py] = [x0, y0];
  ctx.lineCap = "butt";
  for (let i = 1; i <= steps; i++) {
    const h = i / steps;
    const y = y0 - h * height;
    const x =
      x0 +
      lean * h * height +
      Math.sin(h * 8.5 - time * speed + seed) * sway * h +
      Math.sin(h * 21 - time * speed * 2.1 + seed * 2) * sway * 0.3 * h;
    const a = alpha * (1 - h) ** 1.3 * Math.min(1, h * 8);
    for (const [shade, thick] of [
      [0.3, 2.5 + width * h * 2.4],
      [1, 1.5 + width * h * 0.5],
    ]) {
      ctx.strokeStyle = `rgba(${sky.tone.smoke.puff},${a * shade})`;
      ctx.lineWidth = thick;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    [px, py] = [x, y];
  }
}

const stopped = (air: Air) => 1 - air.life;

/** How tall each strip of the boat's wobbling reflection is, in units. */
const REFLECTION_ROW = 3;

interface Effect {
  /** Mist (and falling water) is queued on the GPU, and stays when motion is reduced; everything else is drawn in 2D, and stops. */
  mist?: boolean;
  /** Brings painted smoke to life: left out where the day draws the smoke live instead. */
  smoke?: boolean;
  draw: (ctx: Context, air: Air, seconds: number) => void;
}

const EFFECTS: Record<WeatherPlace, (sky: Sky) => Effect[]> = {
  // Lu Tong under his pine: mist on the far slope, steam from the kettle, needles falling.
  CN: (sky) => {
    const steam: { x: number; y: number; age: number; life: number; size: number }[] = [];
    let owed = 0;
    const needles = fallers(sky, cutouts(sky, CN_NEEDLES), {
      from: () => [random(0.18, 0.95) * sky.width, random(0.05, 0.28) * sky.height],
      fall: 62,
      sway: 31,
      wind: -8,
      spin: 2,
      life: 7,
      kindle: true,
    });
    return [
      {
        mist: true,
        draw: (ctx, air) => {
          const k = stopped(air);
          band(ctx, sky, [0.12, 0.26, 0.85, 0.43], {
            drift: [18, 0],
            grain: 730,
            alpha: 0.55 + 0.4 * k,
          });
          band(ctx, sky, [0.12, 0.26, 0.85, 0.43], {
            drift: [-10, 0],
            grain: 400,
            alpha: 0.35 + 0.3 * k,
            edge: 0.35,
          });
        },
      },
      {
        draw: (ctx, air, seconds) => {
          for (const [u, v, share] of [
            [0.717, 0.858, 1],
            [0.862, 0.879, 0.6],
          ]) {
            owed += seconds * 24 * (0.25 + 0.75 * air.life) * share;
            const count = Math.floor(owed);
            owed -= count;
            for (let n = 0; n < count; n++)
              steam.push({
                x: u * sky.width + random(-8, 8),
                y: v * sky.height,
                age: 0,
                life: random(2.2, 3.4),
                size: random(6.5, 12),
              });
          }
          const rise = 42 + 28 * air.life;
          for (let i = steam.length - 1; i >= 0; i--) {
            const wisp = steam[i];
            wisp.age += seconds;
            if (wisp.age >= wisp.life) {
              steam.splice(i, 1);
              continue;
            }
            wisp.y -= rise * seconds;
            wisp.x +=
              (Math.sin(wisp.y * 0.019 - sky.time * 1.3) * 23 +
                Math.sin(wisp.y * 0.046 + sky.time * 0.7) * 10 -
                5) *
              seconds *
              (0.4 + 0.6 * air.life);
            wisp.size += seconds * 16;
            ctx.globalAlpha =
              0.13 *
              sky.tone.smoke.alpha *
              (1 - wisp.age / wisp.life) ** 1.5 *
              Math.min(1, wisp.age * 4);
            ctx.drawImage(
              puff(sky.tone.smoke.puff),
              wisp.x - wisp.size,
              wisp.y - wisp.size,
              wisp.size * 2,
              wisp.size * 2
            );
          }
          ctx.globalAlpha = 1;
        },
      },
      {
        draw: (ctx, air, seconds) => {
          needles(ctx, air, seconds, air.life < 0.5 ? 0 : 0.25);
        },
      },
    ];
  },
  // The boat on the misty river: cloud copies drifting, the boat's reflection, river mist.
  TW: (sky) => {
    let drifted = 0;
    const clouds = cutouts(sky, TW_CLOUDS, 0.2);
    /** Which cloud, how high, how big, how fast, how dark, mirrored, and how far along it starts. */
    const lanes: [number, number, number, number, number, boolean, number][] = [
      [0, 0.165, 0.5, 1, 0.3, false, 0],
      [1, 0.235, 0.45, -0.7, 0.24, false, 364],
      [0, 0.785, 0.55, 0.5, 0.1, true, 156],
    ];
    const hull: Area = [0.02, 0.664, 0.41, 0.696];
    return [
      {
        draw: (ctx, air, seconds) => {
          drifted += seconds * 14.5 * (0.15 + 0.85 * air.life);
          const { left, right } = sky.view;
          for (const [i, v, scale, speed, alpha, mirrored, start] of lanes) {
            const cloud = clouds[i];
            const w = (cloud.width / sky.ratio) * scale;
            const h = (cloud.height / sky.ratio) * scale;
            const span = right - left + w;
            const x = left - w + ((((drifted * speed + start) % span) + span) % span);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(x + (mirrored ? w : 0), v * sky.height);
            ctx.scale(mirrored ? -1 : 1, 1);
            ctx.drawImage(cloud, 0, 0, w, h);
            ctx.restore();
          }
        },
      },
      {
        draw: (ctx, air) => {
          const [u0, v0, u1, v1] = hull;
          const x0 = u0 * sky.width;
          const width = (u1 - u0) * sky.width;
          const source = (v1 - v0) * sky.height;
          const waterline = v1 * sky.height - 2 + Math.sin(sky.time * 1.1) * 3;
          const depth = source * 0.85;
          const wobble = 4.5 * air.life + 0.5;
          for (let y = 0; y < depth; y += REFLECTION_ROW) {
            const f = y / depth;
            ctx.globalAlpha = 0.14 * (1 - f);
            ctx.drawImage(
              sky.image,
              x0 * sky.ratio,
              (v1 * sky.height - f * source - REFLECTION_ROW) * sky.ratio,
              width * sky.ratio,
              REFLECTION_ROW * sky.ratio,
              x0 + Math.sin((waterline + y) * 0.35 + sky.time * 3) * wobble * (0.4 + f),
              waterline + y,
              width,
              REFLECTION_ROW * 1.3
            );
          }
          ctx.globalAlpha = 1;
        },
      },
      {
        mist: true,
        draw: (ctx, air) => {
          const k = stopped(air);
          band(ctx, sky, [-0.05, 0.69, 1.05, 0.98], {
            drift: [26, 0],
            grain: 800,
            alpha: 0.45 + 0.45 * k,
            side: 0.05,
          });
          band(ctx, sky, [-0.05, 0.84, 1.05, 1], {
            drift: [-16, 0],
            grain: 470,
            alpha: 0.35 + 0.4 * k,
            side: 0.05,
          });
        },
      },
    ];
  },
  // Su Dongpo with incense: the painted smoke seems to rise, catkins drift, mist at his feet.
  HK: (sky) => {
    const shape = thickened(cutouts(sky, [HK_SMOKE_BOX])[0], sky.tone.smoke.body, sky.ratio);
    const layer = canvasOf(1, 1);
    let pattern: CanvasPattern | null = null;
    let risen = 0;
    const catkins: { x: number; y: number; size: number; phase: number }[] = [];
    return [
      {
        smoke: true,
        draw: (ctx, air, seconds) => {
          // Paper mist scrolls up through the painted wisp only, thinning and filling it in turn.
          const m = ctx.getTransform();
          const w = shape.width / sky.ratio;
          const h = shape.height / sky.ratio;
          const W = Math.ceil(w * m.a);
          const H = Math.ceil(h * m.d);
          if (layer.width !== W || layer.height !== H) {
            layer.width = W;
            layer.height = H;
            pattern = null;
          }
          const g = layer.getContext("2d");
          if (!g) return;
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.globalCompositeOperation = "source-over";
          g.clearRect(0, 0, W, H);
          risen += seconds * 54 * (0.15 + 0.85 * air.life);
          pattern ??= g.createPattern(
            fogTile(sky.tone.smoke.wisp, sky.tone.mistSoftness),
            "repeat"
          );
          if (!pattern) return;
          const tile = (266 * m.a) / 256;
          pattern.setTransform(
            new DOMMatrix()
              .translate(
                Math.sin(sky.time * 0.35) * 31 * m.a,
                -((risen * m.a) % (256 * tile * 1.8))
              )
              .scale(tile, tile * 1.8)
          );
          g.fillStyle = pattern;
          g.fillRect(0, 0, W, H);
          g.globalCompositeOperation = "destination-in";
          g.drawImage(shape, 0, 0, W, H);
          ctx.globalAlpha = 0.68 * (0.3 + 0.7 * air.life);
          ctx.drawImage(layer, HK_SMOKE_BOX[0] - 1, HK_SMOKE_BOX[1] - 1, w, h);
          ctx.globalAlpha = 1;
        },
      },
      {
        draw: (ctx, air, seconds) => {
          const { right, top, bottom } = sky.view;
          if (catkins.length < 9 && Math.random() < seconds * 1.2)
            catkins.push({
              x: right + 16,
              y: lerp(top, bottom, random(0.15, 0.85)),
              size: random(3, 7),
              phase: random(0, 6),
            });
          const speed = 55 * (0.15 + 0.85 * air.life);
          for (let i = catkins.length - 1; i >= 0; i--) {
            const catkin = catkins[i];
            catkin.x -= speed * seconds * (0.7 + catkin.size * 0.08);
            catkin.y += (Math.sin(sky.time * 0.9 + catkin.phase) * 16 + 4) * seconds;
            catkin.x += (sky.gust - 1) * 20 * seconds;
            if (catkin.x < sky.view.left - 26) {
              catkins.splice(i, 1);
              continue;
            }
            ctx.globalAlpha = 0.35;
            ctx.drawImage(
              puff(sky.tone.light),
              catkin.x - catkin.size * 2,
              catkin.y - catkin.size * 2,
              catkin.size * 4,
              catkin.size * 4
            );
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = `rgb(${sky.tone.ink})`;
            ctx.beginPath();
            ctx.arc(catkin.x, catkin.y, catkin.size * 0.35, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        },
      },
      {
        mist: true,
        draw: (ctx, air) => {
          const k = stopped(air);
          band(ctx, sky, [-0.05, 0.86, 1.05, 1.02], {
            drift: [16, 0],
            grain: 730,
            alpha: 0.5 + 0.3 * k,
            edge: 0.35,
            side: 0.05,
          });
          band(ctx, sky, [-0.05, 0.78, 1.05, 1], {
            drift: [-10, 0],
            grain: 470,
            alpha: 0.6 * k,
            edge: 0.35,
            side: 0.05,
          });
        },
      },
    ];
  },
  // The scholar at the waterfall: falling water, leaves falling, mist on the river and fog in the gorge.
  MO: (sky) => {
    const falls = waterfall(sky, MO_FALLS);
    const trees: Area[] = [
      [0.13, 0.03, 0.46, 0.27],
      [0.55, 0.3, 0.98, 0.43],
    ];
    const leaves = fallers(sky, cutouts(sky, MO_LEAVES), {
      from: () => {
        const [u0, v0, u1, v1] = trees[Math.random() < 0.6 ? 0 : 1];
        return [random(u0, u1) * sky.width, random(v0, v1) * sky.height];
      },
      fall: 52,
      sway: 47,
      wind: -10,
      spin: 4,
      life: 9,
      size: 1.3,
    });
    return [
      { draw: falls },
      {
        draw: (ctx, air, seconds) => {
          leaves(ctx, air, seconds, air.life < 0.5 ? 0 : 0.37);
        },
      },
      {
        mist: true,
        draw: (ctx, air) => {
          const k = stopped(air);
          const w = 235;
          for (let i = 0; i <= 8; i++) {
            const [u, v] = along(MO_RIVER, i / 8);
            fog(ctx, sky, [u * sky.width - w / 2, v * sky.height - w * 0.22, w, w * 0.36], {
              drift: [-13, 0],
              grain: 470,
              alpha: 0.28 + 0.35 * k,
              edge: 0.4,
              side: 0.3,
            });
          }
        },
      },
      {
        mist: true,
        draw: (ctx, air) => {
          const k = stopped(air);
          band(ctx, sky, [-0.05, 0.86, 1.05, 1.02], {
            drift: [16, 0],
            grain: 800,
            alpha: 0.55 + 0.35 * k,
            side: 0.05,
          });
          band(ctx, sky, [-0.05, 0.8, 1.05, 0.98], {
            drift: [-10, 0],
            grain: 400,
            alpha: 0.3 + 0.4 * k,
            edge: 0.35,
            side: 0.05,
          });
        },
      },
    ];
  },
  // Chen Chun's scroll: cloud belts the camera climbs through, the waterfall, smoke, and the river under the bridge.
  path: (sky) => {
    const falls = waterfall(sky, PATH_FALLS);
    return [
      {
        mist: true,
        draw: (ctx, air) => {
          const k = stopped(air);
          band(ctx, sky, [-0.05, 0.3, 0.62, 0.43], {
            drift: [18, 0],
            grain: 870,
            alpha: 0.7 + 0.3 * k,
            parallax: 0.25,
          });
          band(ctx, sky, [-0.05, 0.555, 0.72, 0.665], {
            drift: [-13, 0],
            grain: 730,
            alpha: 0.65 + 0.3 * k,
            parallax: 0.3,
          });
          band(ctx, sky, [0.5, 0.13, 1.05, 0.21], {
            drift: [10, 0],
            grain: 600,
            alpha: 0.5 + 0.4 * k,
            parallax: 0.15,
          });
        },
      },
      { draw: falls },
      {
        draw: (ctx, air) => {
          const sway = 8 + 10 * air.life;
          ribbon(ctx, sky, [0.285 * sky.width, 0.765 * sky.height], 183, {
            lean: 0.15,
            sway,
            alpha: 0.3,
            width: 7.5,
            speed: 1.1,
          });
          ribbon(ctx, sky, [0.675 * sky.width, 0.388 * sky.height], 146, {
            lean: -0.1,
            sway: sway * 0.8,
            alpha: 0.28,
            width: 6,
            speed: 1.4,
            seed: 1.7,
          });
        },
      },
      {
        draw: (ctx, air) => {
          band(ctx, sky, [-0.02, 0.952, 0.36, 0.976], {
            drift: [16, 0],
            grain: 400,
            alpha: 0.35 + 0.35 * stopped(air),
            edge: 0.35,
            side: 0.2,
          });
        },
      },
    ];
  },
};

export interface Weather {
  place: WeatherPlace;
  tone: Tone;
  /**
   * One frame of weather on `ctx`, which draws in the layer's units, `seconds`
   * after the last. With `still`, only mist is drawn, and it holds still.
   */
  draw: (ctx: Context, air: Air, seconds: number, still: boolean) => void;
  /** The mist that rolls in over the whole painting, figures and all, once nothing plays. */
  veil: (ctx: Context, air: Air) => void;
  /** A bank of soft, even fog blowing across the screen as the station changes, `progress` 0 to 1 of the way, toward `direction`. */
  gust: (ctx: Context, progress: number, direction: 1 | -1) => void;
}

/** The wind each painting was painted in, 0 to 1. */
const PAINTED_WIND = 0.2;

/** How much harder than painted `wind` (0 to 1, as Open-Meteo's at 50 km/h) blows: from 0.4 in a calm to 3.4 in a gale. */
const gustOf = (wind: number) => 0.4 + 3 * clamp(wind);

/**
 * The weather over `place`'s painting, cut from `image`, a layer `width`×`height` units, in
 * `tone`'s colours. `draw` queues its mist on `layers.under` and draws the rest on its canvas;
 * `veil` and `gust` queue theirs on `layers.over`. Flush the layers once all is queued.
 * `windOf` says how hard the wind blows there now, 0 to 1.
 */
export function makeWeather(
  place: WeatherPlace,
  image: CanvasImageSource & { width: number; height: number },
  { width, height }: { width: number; height: number },
  tone: Tone,
  layers: InkLayers,
  {
    liveSmoke = false,
    windOf = () => PAINTED_WIND,
  }: { liveSmoke?: boolean; windOf?: () => number } = {}
): Weather {
  const sky: Sky = {
    image,
    ratio: image.height / height,
    width,
    height,
    view: { left: 0, top: 0, right: width, bottom: height },
    time: 0,
    gust: gustOf(windOf()),
    blown: 0,
    tone,
    gl: layers.under,
  };
  let lastTime = 0;
  const effects = EFFECTS[place](sky).filter((effect) => !(liveSmoke && effect.smoke));
  const look = (ctx: Context) => {
    const m = ctx.getTransform();
    sky.view = {
      left: -m.e / m.a,
      top: -m.f / m.d,
      right: (ctx.canvas.width - m.e) / m.a,
      bottom: (ctx.canvas.height - m.f) / m.d,
    };
  };
  return {
    place,
    tone,
    draw: (ctx, air, seconds, still) => {
      look(ctx);
      sky.gl = layers.under;
      sky.time = still ? 0 : air.time;
      // The wind changes every half hour or so; the mist and leaves take a few seconds to follow.
      sky.gust += (gustOf(windOf()) - sky.gust) * Math.min(1, seconds * 0.4);
      sky.blown += still ? 0 : Math.max(0, air.time - lastTime) * sky.gust;
      lastTime = air.time;
      for (const effect of effects) {
        if (still && !effect.mist) continue;
        ctx.save();
        effect.draw(ctx, air, still ? 0 : seconds);
        ctx.restore();
      }
    },
    veil: (ctx, air) => {
      const k = stopped(air);
      if (k <= 0.01) return;
      look(ctx);
      sky.gl = layers.over;
      const { left, top, right, bottom } = sky.view;
      const [w, h] = [right - left, bottom - top];
      fog(ctx, sky, [left - 50, top - 50, w + 100, h + 100], {
        drift: [13, 0],
        grain: 1070,
        alpha: 0.75 * k,
        edge: 0.05,
        side: 0.02,
        paper: true,
      });
    },
    gust: (ctx, progress, direction) => {
      look(ctx);
      sky.gl = layers.over;
      const { left, top, right, bottom } = sky.view;
      const [w, h] = [right - left, bottom - top];
      const bank = w * 3;
      // Broad, blurred layers a little behind each other, so it comes on as an even, soft fog with no clouds in it.
      for (const [lag, grain, alpha] of [
        [0, 2600, 1],
        [0.12, 3400, 0.9],
      ]) {
        const p = clamp((progress - lag) / (1 - lag));
        if (p <= 0 || p >= 1) continue;
        const along = (w + bank) * (p * p * (3 - 2 * p));
        const x = direction > 0 ? left - bank + along : right - along;
        fog(ctx, sky, [x, top - h * 0.2, bank, h * 1.4], {
          drift: [direction * 40, -5],
          grain,
          alpha: alpha * Math.min(1, 1.6 * Math.sin(Math.PI * p)),
          edge: 0.2,
          side: 0.4,
          softness: 24,
        });
      }
    },
  };
}
