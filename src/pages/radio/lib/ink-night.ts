import type { CountryCode } from "@/shared/api/commands.ts";
import type { Air } from "@/pages/radio/lib/air.ts";
import type { Scene } from "@/pages/radio/lib/ink-painter.ts";
import { NIGHT_TONE, type Tone } from "@/pages/radio/lib/ink-tone.ts";
import { blurred, paintSoft, type Tint } from "@/pages/radio/lib/soften.ts";
import type { InkGL } from "@/pages/radio/lib/ink-gl.ts";

/*
 * The radio's paintings at night. The ink stays black, never inverted, on a dark
 * ground, and each leaf is lit by something in it: Lu Tong's tea stove, the
 * boat's lamp, the ember of Su Dongpo's incense, the moon over Luo Ping's
 * waterfall. Light falls on the paper behind the ink (drawn, then cut away
 * wherever the leaf has ink), so the strokes stay dark against it; glints of
 * moonlight on water, and fog, lie on top. Points are in leaf units.
 */

type Point = [number, number];
type Context = CanvasRenderingContext2D;

const TAU = Math.PI * 2;
const WHITE: Tint = [255, 255, 255];
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const pathOf = (points: Point[]) => {
  const path = new Path2D();
  points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  return path;
};

/**
 * A dark ground the size of the canvas: `base`, and moonlight falling from the top as
 * [stop, alpha] pairs.
 */
function ground(base: string, moon: [number, number][]) {
  return (ctx: Context) => {
    const { width, height } = ctx.canvas;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);
    if (moon.length) {
      const light = ctx.createLinearGradient(0, 0, 0, height);
      for (const [stop, alpha] of moon) light.addColorStop(stop, `rgba(150,168,190,${alpha})`);
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, width, height);
    }
  };
}

/**
 * How each place looks at night before its lights: its paper, how deep its ink is laid and the
 * colours over it.
 */
export const NIGHT_LOOK: Record<
  CountryCode,
  { paint: (ctx: Context) => void; inkStrength: number; tone: Tone }
> = {
  // Lit by the fire, a little moonlight on the open sky above: its haze glows faintly warm.
  CN: {
    paint: ground("#0c0704", []),
    inkStrength: 1,
    tone: {
      ...NIGHT_TONE,
      paper: "12,7,4",
      mist: "104,66,34",
      mistAlpha: 0.35,
      mistSoftness: 3,
      // The kettle's steam, and the needles falling, lit by the fire.
      smoke: { ...NIGHT_TONE.smoke, puff: "204,132,74", alpha: 1.6 },
      fallen: "216,148,88",
    },
  },
  TW: {
    paint: ground("#080b0d", [
      [0, 0.6],
      [0.35, 0.56],
      [0.6, 0.22],
      [1, 0],
    ]),
    inkStrength: 1,
    tone: NIGHT_TONE,
  },
  // Almost dark: what mist there is barely shows.
  HK: {
    paint: ground("#060403", [
      [0, 0.14],
      [0.5, 0.1],
      [1, 0.05],
    ]),
    inkStrength: 1,
    tone: { ...NIGHT_TONE, paper: "6,4,3", mist: "70,72,78", mistAlpha: 0.5 },
  },
  // Its own banks of fog drift over the leaf's mist, so that lies thinner.
  MO: {
    paint: ground("#080b0d", [
      [0, 0.48],
      [0.4, 0.34],
      [0.7, 0.15],
      [1, 0.02],
    ]),
    inkStrength: 1.4,
    tone: { ...NIGHT_TONE, mistAlpha: 0.12 },
  },
};

/** What a frame of night is drawn from: the painting on show, what plays (only the fog heeds it), and the clock. */
interface Moment {
  scene: Scene;
  air: Air;
  /** Seconds of real time: lights flicker and glint on it alone, never on the sound. */
  time: number;
  seconds: number;
  still: boolean;
  /** While one painting gives way to the next, its figures are drawn into it rather than over the light: this draws them (in leaf units), so the light can fall behind them too. */
  held?: (ctx: Context) => void;
}

export interface Night {
  /** Light on the paper behind the ink, under the weather; `ctx` draws in leaf units. */
  under: (ctx: Context, moment: Moment) => void;
  /** Night settling over the weather, and moonlight catching on water. */
  over: (ctx: Context, moment: Moment) => void;
}

/** Light painted by `paint` (in leaf units) onto `ctx`, cut away wherever the scene has ink, its held figures too, as if it lay behind it. */
function behindInk(
  ctx: Context,
  { scene, held }: Pick<Moment, "scene" | "held">,
  scratch: HTMLCanvasElement,
  paint: (g: Context) => void
) {
  const { width, height } = ctx.canvas;
  if (scratch.width !== width || scratch.height !== height)
    Object.assign(scratch, { width, height });
  const g = scratch.getContext("2d");
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  g.filter = "none";
  g.clearRect(0, 0, width, height);
  g.setTransform(...scene.transform);
  paint(g);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.filter = "none";
  g.globalCompositeOperation = "destination-out";
  g.drawImage(scene.ink, 0, 0);
  if (held) {
    g.setTransform(...scene.transform);
    held(g);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

/** Night closing over everything drawn so far, to `alpha`. */
function dim(ctx: Context, alpha: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** A soft round glow of `color` at `at`, `radius` units, through `stops` of [offset, alpha]. */
function glow(g: Context, [x, y]: Point, radius: number, color: string, stops: [number, number][]) {
  const light = g.createRadialGradient(x, y, 0, x, y, radius);
  for (const [stop, alpha] of stops) light.addColorStop(stop, `rgba(${color},${clamp(alpha)})`);
  g.fillStyle = light;
  g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

const rgbOf = (color: string) => color.split(",").map(Number) as [number, number, number];

/**
 * As `glow`, queued on the GPU: `at` and `radius` in leaf units through `ctx`'s transform,
 * `stretch` times as wide as tall, and with `cover`, filling the whole canvas past its edge.
 */
function glGlow(
  gl: InkGL,
  ctx: Context,
  [x, y]: Point,
  radius: number,
  color: string,
  stops: [number, number][],
  { stretch = 1, cover = false } = {}
) {
  const m = ctx.getTransform();
  const center: [number, number] = [m.a * x + m.e, m.d * y + m.f];
  const r = radius * m.d;
  gl.glow({
    rect: cover
      ? [0, 0, ctx.canvas.width, ctx.canvas.height]
      : [center[0] - r * stretch, center[1] - r, 2 * r * stretch, 2 * r],
    center,
    radius: r,
    stretch,
    color: rgbOf(color),
    stops: stops.map(([stop, alpha]) => [stop, clamp(alpha)]),
  });
}

/** A layer worked out for the whole screen, queued on the GPU at `alpha`; `soft` where nothing in it is sharp. */
function glLayer(gl: InkGL, layer: HTMLCanvasElement, alpha: number, soft = false) {
  gl.image({ source: layer, rect: [0, 0, layer.width, layer.height], alpha: clamp(alpha), soft });
}

/** Where the leaf has no ink, to tell open water from rock and reed: its alpha, read once. */
function bareOf(image: ImageBitmap) {
  const canvas = canvasOf(image.width, image.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return () => false;
  ctx.drawImage(image, 0, 0);
  const alpha = ctx.getImageData(0, 0, image.width, image.height).data;
  const ratio = image.height / 1600;
  return ([x, y]: Point) => {
    const px = Math.round(x * ratio);
    const py = Math.round(y * ratio);
    return (
      px >= 0 &&
      py >= 0 &&
      px < image.width &&
      py < image.height &&
      alpha[(py * image.width + px) * 4 + 3] < 24
    );
  };
}

interface Glint {
  x: number;
  y: number;
  /** How long it is, against the usual. */
  length: number;
  phase: number;
  rate: number;
  /** A glint on falling water runs down it, upright. */
  falling?: boolean;
}

/**
 * `count` glints of moonlight inside `water`, each whole streak (of `reach`
 * units each way, times its length) on open water: inside the shape and over
 * no brushstroke.
 */
function glintsIn(
  water: Path2D,
  bare: (point: Point) => boolean,
  {
    count,
    box,
    reach,
    rates,
    seed,
    falling,
  }: {
    count: number;
    box: [number, number, number, number];
    reach: number;
    rates: [number, number];
    seed: number;
    falling?: boolean;
  }
) {
  const probe = canvasOf(1, 1).getContext("2d");
  if (!probe) return [];
  const random = seeded(seed);
  const open = ([x, y]: Point) => probe.isPointInPath(water, x, y) && bare([x, y]);
  const glints: Glint[] = [];
  const [left, top, right, bottom] = box;
  for (let tries = 0; glints.length < count && tries < count * 200; tries++) {
    const x = left + random() * (right - left);
    const y = top + random() * (bottom - top);
    const length = 0.7 + random() * 1.4;
    const ends: Point[] = falling
      ? [
          [x, y - reach * length],
          [x, y + reach * length + 60],
        ]
      : [
          [x - reach * length, y],
          [x + reach * length, y],
        ];
    if (!open([x, y]) || !ends.every(open)) continue;
    glints.push({
      x,
      y,
      length,
      phase: random() * TAU,
      rate: rates[0] + random() * (rates[1] - rates[0]),
      falling,
    });
  }
  return glints;
}

/** A short streak of light lying on water, `length` units long, `thickness` units thick. */
function sparkle(
  ctx: Context,
  [x, y]: Point,
  {
    alpha,
    length,
    thickness,
    color,
    upright = false,
  }: {
    alpha: number;
    length: number;
    thickness: number;
    color: string;
    upright?: boolean;
  }
) {
  if (alpha < 0.02) return;
  ctx.save();
  ctx.translate(x, y);
  if (upright) ctx.rotate(Math.PI / 2);
  ctx.scale(length / thickness, 1);
  const light = ctx.createRadialGradient(0, 0, 0, 0, 0, thickness);
  light.addColorStop(0, `rgba(${color},${clamp(alpha)})`);
  light.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = light;
  ctx.fillRect(-thickness, -thickness, thickness * 2, thickness * 2);
  ctx.restore();
}

/** How far the moving part has lifted, as `drawListener` floats the boat. */
const boatLift = (time: number) => Math.sin(time * 1.1) * 3;

/** One device pixel, in leaf units. */
const pixel = (ctx: Context) => 1 / Math.hypot(ctx.getTransform().a, ctx.getTransform().b);

// Lu Tong's tea stove: the fire under the kettle lights the leaf around it, flickering.
const FIRE: Point = [775, 1448];
/** Where its light is thrown: up onto the poet, off the foot of the leaf. */
const FIRELIT: Point = [735, 1270];
/** How far the firelight reaches, in units. */
const REACH = 1250;

/** The night over the whole leaf, thin in the firelight and closing beyond its reach, as [offset, alpha] of black. */
const BEYOND_FIRE: [number, number][] = [
  [0, 0.2],
  [0.42, 0.24],
  [0.72, 0.48],
  [1, 0.66],
];

/** The stove's own shadow along the foot of the leaf, left of it: where, how tall, and how many times as wide. */
const FOOT = { at: [300, 1700] as Point, reach: 300, stretch: 3 };
const FOOT_SHADOW: [number, number][] = [
  [0, 0.7],
  [0.6, 0.45],
  [1, 0],
];

/**
 * Where the fireflies keep to, as [left, top, right, bottom], how many, and how near they are (0 far
 * off to 1 close by): most among the pine's needles and branches, fewer below it, a few far off over the slope.
 */
const FIREFLY_HAUNTS: [[number, number, number, number], number, [number, number]][] = [
  // The great canopy, top left, and its lowest boughs.
  [[100, 20, 660, 300], 14, [0.15, 0.4]],
  [[120, 280, 400, 420], 5, [0.15, 0.4]],
  // The boughs coming in from the right edge, and the needles at the top right.
  [[860, 220, 1020, 560], 5, [0.15, 0.4]],
  [[600, 0, 1000, 160], 4, [0.15, 0.4]],
  // Thinning out below the pine, down to the figures' heads.
  [[100, 420, 1020, 900], 5, [0.25, 0.5]],
  // Far off, over the slope beyond.
  [[300, 380, 900, 620], 3, [0, 0.1]],
];
const FIREFLY = "222,236,150";

interface Firefly {
  home: Point;
  /** How far it wanders each way, and how fast, on two slow loops. */
  wander: [number, number, number, number];
  phase: number;
  /** How often it flashes, in radians a second. */
  rate: number;
  /** How near it is, from 0 far off to 1 close by: nearer ones are bigger, brighter and wander wider. */
  near: number;
}

function firefliesIn(seed: number): Firefly[] {
  const random = seeded(seed);
  return FIREFLY_HAUNTS.flatMap(([[left, top, right, bottom], count, [farthest, nearest]]) =>
    Array.from({ length: count }, () => {
      const home: Point = [left + random() * (right - left), top + random() * (bottom - top)];
      const near = farthest + random() * (nearest - farthest);
      const reach = 0.35 + 0.65 * near;
      return {
        home,
        wander: [
          (30 + random() * 40) * reach,
          (20 + random() * 30) * reach,
          0.08 + random() * 0.1,
          0.11 + random() * 0.1,
        ],
        phase: random() * TAU,
        rate: 0.5 + random() * 0.6,
        near,
      };
    })
  );
}

/** Where a firefly is at `time`, and how bright, 0 between flashes. */
function fireflyAt({ home, wander, phase, rate, near }: Firefly, time: number) {
  const [rx, ry, fx, fy] = wander;
  const at: Point = [
    home[0] + rx * Math.sin(time * fx + phase) + 0.4 * rx * Math.sin(time * fx * 2.3 + phase * 3),
    home[1] + ry * Math.sin(time * fy + phase * 2) + 0.4 * ry * Math.cos(time * fy * 1.7 + phase),
  ];
  return {
    at,
    flash: Math.max(0, Math.sin(time * rate + phase)) ** 6 * (0.5 + 0.5 * near),
    size: 0.4 + 0.6 * near,
  };
}

/** The flashing fireflies at `time`, none while motion is stilled. */
const flashing = (fireflies: Firefly[], time: number, still: boolean) =>
  still ? [] : fireflies.map((fly) => fireflyAt(fly, time)).filter(({ flash }) => flash > 0.02);

/** A little moonlight from above: brightest where the leaf is open sky, at the top, darkening downward. */
const MOON = {
  color: "176,190,214",
  /** How bright the open sky at the very top gets. */
  peak: 0.4,
  /** How far down the moonlight reaches, as a share of the leaf's height. */
  depth: 0.6,
  /** How much light still falls where the leaf is thick with ink, against open sky. */
  under: 0.3,
  /** One cell of the map, and how far it is softened, in cells. */
  cell: 8,
  soften: 6,
};

/**
 * Where the moonlight falls on `image`, at one pixel a cell: open paper (the sky between the pine's
 * boughs and above the far slope) lit most, falling off toward the bottom.
 */
function moonlightOver(image: ImageBitmap) {
  const width = Math.ceil(image.width / MOON.cell);
  const height = Math.ceil(image.height / MOON.cell);
  const open = canvasOf(width, height);
  const o = open.getContext("2d");
  if (!o) return open;
  o.imageSmoothingQuality = "high";
  o.drawImage(image, 0, 0, width, height);
  o.globalCompositeOperation = "source-out";
  o.fillStyle = "#fff";
  o.fillRect(0, 0, width, height);
  const soft = blurred(open, MOON.soften);
  const g = soft.getContext("2d", { willReadFrequently: true });
  if (!g) return soft;
  const pixels = g.getImageData(0, 0, width, height);
  const [r, gr, b] = rgbOf(MOON.color);
  for (let y = 0; y < height; y++) {
    const fall = clamp(1 - y / (height * MOON.depth)) ** 1.6;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const sky = pixels.data[i + 3] / 255;
      pixels.data.set(
        [r, gr, b, 255 * MOON.peak * fall * (MOON.under + (1 - MOON.under) * sky)],
        i
      );
    }
  }
  g.putImageData(pixels, 0, 0);
  return soft;
}

function teaStove(image: ImageBitmap, gl: InkGL | null, moon: () => number): Night {
  const scratch = canvasOf(1, 1);
  const fireflies = firefliesIn(83);
  const moonlight = moonlightOver(image);
  /** The whole leaf, in units. */
  const leaf = [0, 0, (image.width * 1600) / image.height, 1600] as const;
  return {
    under: (ctx, { scene, held, time, still }) => {
      const t = still ? 0 : time;
      const flick =
        0.88 +
        0.06 * Math.sin(t * 7.3) +
        0.04 * Math.sin(t * 13.7 + 1.3) +
        0.03 * Math.sin(t * 23.1);
      const fires = [
        {
          at: FIRELIT,
          radius: REACH * (0.85 + 0.15 * flick),
          color: "255,142,46",
          stops: [
            [0, 0.85 * flick],
            [0.06, 0.8 * flick],
            [0.16, 0.71 * flick],
            [0.3, 0.47 * flick],
            [0.5, 0.24 * flick],
            [0.75, 0.09 * flick],
            [1, 0],
          ] as [number, number][],
        },
        {
          at: FIRE,
          radius: 230,
          color: "255,142,46",
          stops: [
            [0, 0.6 * flick],
            [0.35, 0.3 * flick],
            [1, 0],
          ] as [number, number][],
        },
        {
          at: FIRE,
          radius: 72,
          color: "255,132,36",
          stops: [
            [0, 0.9 * flick],
            [0.4, 0.5 * flick],
            [1, 0],
          ] as [number, number][],
        },
      ];
      // Each firefly lights the paper among the branches around it as it flashes.
      const pools = flashing(fireflies, t, still).map(({ at, flash, size }) => ({
        at,
        radius: 110 * size,
        stops: [
          [0, 0.4 * flash],
          [0.3, 0.22 * flash],
          [0.65, 0.07 * flash],
          [1, 0],
        ] as [number, number][],
      }));
      if (gl?.ready && !held)
        gl.behindInk(scene.ink, () => {
          const m = ctx.getTransform();
          gl.image({
            source: moonlight,
            rect: [m.e, m.f, leaf[2] * m.a, leaf[3] * m.d],
            alpha: moon(),
            soft: true,
          });
          for (const fire of fires) glGlow(gl, ctx, fire.at, fire.radius, fire.color, fire.stops);
          for (const pool of pools) glGlow(gl, ctx, pool.at, pool.radius, FIREFLY, pool.stops);
        });
      else
        behindInk(ctx, { scene, held }, scratch, (g) => {
          g.globalAlpha = moon();
          g.drawImage(moonlight, ...leaf);
          g.globalAlpha = 1;
          for (const fire of fires) glow(g, fire.at, fire.radius, fire.color, fire.stops);
          for (const pool of pools) glow(g, pool.at, pool.radius, FIREFLY, pool.stops);
        });
    },
    // Out of the fire's reach the night closes again over the mist and the needles, so they too are
    // lit only near it; the fireflies glow through it, catching the needles and branches nearest them.
    over: (ctx, { time, still }) => {
      const sparks = flashing(fireflies, time, still).flatMap(({ at, flash, size }) => [
        {
          at,
          radius: 70 * size,
          stops: [
            [0, 0.11 * flash],
            [0.5, 0.035 * flash],
            [1, 0],
          ] as [number, number][],
        },
        {
          at,
          radius: 16 * size,
          stops: [
            [0, 0.25 * flash],
            [1, 0],
          ] as [number, number][],
        },
        {
          at,
          // Never under a couple of pixels, or the farthest vanish on a small screen.
          radius: Math.max(3.5 * size, 2.5 * pixel(ctx)),
          stops: [
            [0, 0.8 * flash],
            [0.5, 0.45 * flash],
            [1, 0],
          ] as [number, number][],
        },
      ]);
      if (gl?.ready) {
        glGlow(gl, ctx, FIRELIT, REACH, "0,0,0", BEYOND_FIRE, { cover: true });
        glGlow(gl, ctx, FOOT.at, FOOT.reach, "0,0,0", FOOT_SHADOW, { stretch: FOOT.stretch });
        for (const spark of sparks) glGlow(gl, ctx, spark.at, spark.radius, FIREFLY, spark.stops);
        return;
      }
      const reach = ctx.createRadialGradient(...FIRELIT, 0, ...FIRELIT, REACH);
      for (const [stop, alpha] of BEYOND_FIRE) reach.addColorStop(stop, `rgba(0,0,0,${alpha})`);
      ctx.fillStyle = reach;
      ctx.fillRect(-1000, -1000, 4000, 4000);
      ctx.save();
      ctx.translate(...FOOT.at);
      ctx.scale(FOOT.stretch, 1);
      glow(ctx, [0, 0], FOOT.reach, "0,0,0", FOOT_SHADOW);
      ctx.restore();
      for (const spark of sparks) glow(ctx, spark.at, spark.radius, FIREFLY, spark.stops);
    },
  };
}

// The boat poled home: a lamp in its cabin pools warm light on the water, and moonlight glints on the river around it.
const LAMP: Point = [205, 1082];
const RIVER: Point[] = [
  [0, 1118],
  [420, 1098],
  [560, 965],
  [1011, 925],
  [1011, 1415],
  [0, 1415],
];
/** Where the lamp's reflection starts below the hull, and how far down it breaks up. */
const REFLECTION = { top: 1138, depth: 240 };

function boatLamp(image: ImageBitmap, gl: InkGL | null, moon: () => number): Night {
  const scratch = canvasOf(1, 1);
  const bare = bareOf(image);
  const glints = glintsIn(pathOf(RIVER), bare, {
    count: 300,
    box: [0, 920, 1011, 1415],
    reach: 9.6,
    rates: [0.25, 0.85],
    seed: 61,
  });
  const lamp = (time: number, still: boolean) => {
    const t = still ? 0 : time;
    const at: Point = [LAMP[0], LAMP[1] + (still ? 0 : boatLift(time))];
    return { at, flick: 0.92 + 0.04 * Math.sin(t * 6.1) + 0.03 * Math.sin(t * 11.3 + 2) };
  };
  return {
    under: (ctx, { scene, held, time, still }) => {
      const { at, flick } = lamp(time, still);
      // The pool on the water, half again as wide as tall.
      const pool: [number, number][] = [
        [0, flick],
        [0.12, 0.82 * flick],
        [0.35, 0.48 * flick * 0.8],
        [0.65, 0.22 * flick * 0.5],
        [1, 0],
      ];
      const flame: [number, number][] = [
        [0, 0.95 * flick],
        [0.45, 0.5 * flick],
        [1, 0],
      ];
      if (gl?.ready && !held) {
        gl.behindInk(scene.ink, () => {
          glGlow(gl, ctx, at, 400 / 1.5, "255,138,42", pool, { stretch: 1.5 });
          glGlow(gl, ctx, at, 24, "255,176,86", flame);
        });
        return;
      }
      behindInk(ctx, { scene, held }, scratch, (g) => {
        g.save();
        g.translate(...at);
        g.scale(1.5, 1);
        glow(g, [0, 0], 400 / 1.5, "255,138,42", pool);
        g.restore();
        glow(g, at, 24, "255,176,86", flame);
      });
    },
    over: (ctx, { time, still }) => {
      if (gl?.ready) {
        gl.fill([0, 0, 0], 0.25);
        gl.flush(ctx);
      } else dim(ctx, 0.25);
      const { at, flick } = lamp(time, still);
      const t = still ? 0 : time;
      const thickness = Math.max(pixel(ctx), 1.9);
      for (const glint of glints) {
        const pulse = Math.max(0, Math.sin(t * glint.rate + glint.phase)) ** 10;
        if (pulse < 0.02) continue;
        const near = Math.exp(-(((glint.x - at[0]) / 240) ** 2 + ((glint.y - at[1]) / 160) ** 2));
        const warm = [236 + 19 * near, 244 - 100 * near, 252 - 200 * near]
          .map(Math.round)
          .join(",");
        sparkle(ctx, [glint.x, glint.y], {
          alpha: pulse * (0.18 * (1 - near) * moon() + 0.35 * flick * near),
          length: 8 * glint.length,
          thickness: thickness * (1 + near),
          color: warm,
        });
      }
      // The lamp's reflection: warm glimmers in a broken column under the boat, swaying with it.
      const sway = still ? 0 : time;
      for (let i = 0; i < 12; i++) {
        const k = i / 11;
        const y = REFLECTION.top + k * REFLECTION.depth;
        const x = at[0] + Math.sin(sway * 1.3 + i * 1.7) * 11 * (0.3 + k);
        if (!bare([x, y])) continue;
        const alpha =
          flick * (1 - k * 0.8) * Math.max(0, 0.22 + 0.11 * Math.sin(sway * 1.4 + i * 2.3));
        sparkle(ctx, [x, y], {
          alpha,
          length: 8 * (1.3 + k * 2),
          thickness: thickness * 2.2,
          color: "255,156,70",
        });
        sparkle(ctx, [x, y], {
          alpha: alpha * 0.3,
          length: 8 * (3.5 + k * 3),
          thickness: thickness * 3.5,
          color: "228,108,32",
        });
      }
    },
  };
}

// Su Dongpo's incense: its ember the only warm light, on his face and hands and spilling down his sleeves.
const EMBER: Point = [337, 818];
const LIT = {
  face: [
    [396, 681],
    [423, 684],
    [445, 698],
    [464, 690],
    [473, 709],
    [467, 758],
    [451, 791],
    [429, 810],
    [412, 823],
    [407, 818],
    [404, 780],
    [399, 747],
    [396, 714],
  ],
  hands: [
    [281, 848],
    [303, 837],
    [347, 828],
    [385, 806],
    [412, 818],
    [407, 834],
    [374, 851],
    [330, 867],
    [303, 867],
    [284, 856],
  ],
  // From his hands and beard down his sleeves and across to the shoulder.
  body: [
    [398, 800],
    [440, 790],
    [480, 760],
    [530, 745],
    [585, 775],
    [625, 860],
    [625, 960],
    [560, 1010],
    [460, 1015],
    [370, 985],
    [300, 925],
    [285, 870],
    [330, 850],
  ],
} satisfies Record<string, Point[]>;

function incense(gl: InkGL | null): Night {
  const scratch = canvasOf(1, 1);
  let light: { canvas: HTMLCanvasElement; key: string } | null = null;
  /** What the ember lights, worked out once for the screen: feathered shapes, warm near the tip. */
  const lightFor = (ctx: Context) => {
    const m = ctx.getTransform();
    const key = `${ctx.canvas.width}x${ctx.canvas.height}:${m.a},${m.e},${m.f}`;
    if (light?.key === key) return light.canvas;
    const scale = m.a;
    const canvas = canvasOf(ctx.canvas.width, ctx.canvas.height);
    const c = canvas.getContext("2d");
    if (!c) return canvas;
    paintSoft(
      c,
      m,
      40 * scale,
      (s) => {
        const fall = s.createRadialGradient(400, 820, 0, 400, 820, 256);
        fall.addColorStop(0, "rgba(255,255,255,0.5)");
        fall.addColorStop(0.5, "rgba(255,255,255,0.18)");
        fall.addColorStop(1, "rgba(255,255,255,0)");
        s.fillStyle = fall;
        s.fill(pathOf(LIT.body));
        s.fillStyle = "rgba(255,255,255,0.45)";
        s.fill(pathOf(LIT.hands));
      },
      WHITE
    );
    paintSoft(
      c,
      m,
      Math.max(1, 8.8 * scale),
      (n) => {
        n.fillStyle = "rgba(255,255,255,0.7)";
        n.fill(pathOf(LIT.face));
        n.fillStyle = "rgba(255,255,255,0.95)";
        n.fill(pathOf(LIT.hands));
        n.fillStyle = "rgba(255,255,255,0.6)";
        n.beginPath();
        n.arc(...EMBER, 9.6, 0, TAU);
        n.fill();
      },
      WHITE
    );
    c.globalCompositeOperation = "source-in";
    c.setTransform(m);
    const warm = c.createRadialGradient(...EMBER, 0, ...EMBER, 400);
    warm.addColorStop(0, "rgb(246,126,46)");
    warm.addColorStop(0.45, "rgb(214,98,32)");
    warm.addColorStop(1, "rgb(160,70,30)");
    c.fillStyle = warm;
    c.fillRect(-2000, -2000, 6000, 6000);
    light = { canvas, key };
    return canvas;
  };
  const emberOf = (time: number, still: boolean) =>
    0.86 + 0.14 * Math.sin((still ? 0 : time) * 1.1);
  return {
    under: (ctx, { scene, held, time, still }) => {
      const ember = emberOf(time, still);
      const lit = lightFor(ctx);
      const warmth: [number, number][] = [
        [0, 0.35 * ember],
        [1, 0],
      ];
      if (gl?.ready && !held) {
        gl.behindInk(scene.ink, () => {
          glLayer(gl, lit, ember, true);
          glGlow(gl, ctx, EMBER, 28, "255,120,32", warmth);
        });
        return;
      }
      behindInk(ctx, { scene, held }, scratch, (g) => {
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = Math.min(1, ember);
        g.drawImage(lit, 0, 0);
        g.restore();
        glow(g, EMBER, 28, "255,120,32", warmth);
      });
    },
    over: (ctx, { time, still }) => {
      const ember = emberOf(time, still);
      const tip: [number, number][] = [
        [0, 0.9 * ember],
        [0.4, 0.6 * ember],
        [1, 0],
      ];
      if (gl?.ready) glGlow(gl, ctx, EMBER, 6.4, "255,142,56", tip);
      else glow(ctx, EMBER, 6.4, "255,142,56", tip);
    },
  };
}

// The scholar at the waterfall: the sky glows faintly, moonbeams fall through the top branch, the
// stream has a faint sheen, the fall gleams, and fog drifts low, from the figures' waists down and over the river.
/** The stream from the foot of the fall, round the stone, and out past the near bank to the bottom left. */
const STREAM: Point[] = [
  [591, 1155],
  [581, 1165],
  [579, 1185],
  [551, 1199],
  [541, 1215],
  [556, 1234],
  [570, 1245],
  [528, 1249],
  [500, 1256],
  [479, 1268],
  [460, 1288],
  [456, 1312],
  [471, 1331],
  [488, 1349],
  [496, 1368],
  [462, 1375],
  [387, 1386],
  [312, 1397],
  [246, 1412],
  [181, 1425],
  [87, 1443],
  [-11, 1473],
  [-11, 1605],
  [298, 1605],
  [256, 1537],
  [246, 1495],
  [270, 1462],
  [307, 1432],
  [350, 1420],
  [406, 1424],
  [462, 1435],
  [509, 1439],
  [560, 1435],
  [593, 1418],
  [610, 1382],
  [619, 1331],
  [619, 1270],
  [614, 1204],
  [604, 1155],
];
const FALL: Point[] = [
  [608, 85],
  [652, 85],
  [648, 300],
  [641, 450],
  [636, 560],
  [600, 560],
  [606, 450],
  [612, 300],
];
/** Where the sky glows from, above the cliff, and how far. */
const SKY_GLOW = { at: [200, -1] as Point, reach: 686 };
/** Where the moonbeams come in over the cliff top, and the way they fall. */
const BEAMS = { from: [315, -15] as Point, angle: [1.66, 2.12], count: 22 };
/** Banks of fog, as fractions of the screen's height, each drifting at its own pace (screen widths a second). */
const FOG_BANKS = [
  { y: 0.66, speed: 0.024, alpha: 0.26 },
  { y: 0.74, speed: -0.018, alpha: 0.34 },
  { y: 0.83, speed: 0.03, alpha: 0.38 },
  { y: 0.93, speed: -0.022, alpha: 0.45 },
];

/** Fog is soft, so a bank is worked out at this share of the screen's resolution and drawn up. */
const BANK_RESOLUTION = 0.5;

/** A strip of fog to lie twice `width` wide and `height` tall, that tiles with itself sideways. */
function fogBank(width: number, height: number, seed: number) {
  const canvas = canvasOf(
    Math.ceil(width * 2 * BANK_RESOLUTION),
    Math.ceil(height * BANK_RESOLUTION)
  );
  const g = canvas.getContext("2d");
  if (!g) return canvas;
  const span = width * 2;
  g.scale(canvas.width / span, canvas.height / height);
  const random = seeded(seed);
  for (let i = 0; i < 64; i++) {
    const x = random() * span;
    const y = height * (0.38 + random() * 0.24);
    const rx = width * (0.18 + random() * 0.34);
    const ry = height * (0.14 + random() * 0.24);
    const alpha = 0.07 + random() * 0.12;
    for (const dx of [-span, 0, span]) {
      g.save();
      g.translate(x + dx, y);
      g.scale(rx / ry, 1);
      const puff = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      puff.addColorStop(0, `rgba(205,214,228,${alpha})`);
      puff.addColorStop(0.6, `rgba(205,214,228,${alpha * 0.45})`);
      puff.addColorStop(1, "rgba(205,214,228,0)");
      g.fillStyle = puff;
      g.fillRect(-ry, -ry, ry * 2, ry * 2);
      g.restore();
    }
  }
  return canvas;
}

const wrap = (value: number, span: number) => ((value % span) + span) % span;

function moonlitFalls(image: ImageBitmap, gl: InkGL | null, moon: () => number): Night {
  const scratch = canvasOf(1, 1);
  const stream = pathOf(STREAM);
  const fall = pathOf(FALL);
  const bare = bareOf(image);
  // Only the fall gleams: the stream is left without glints.
  const glints = glintsIn(fall, bare, {
    count: 24,
    box: [595, 85, 655, 560],
    reach: 8.6,
    rates: [0.6, 2],
    seed: 78,
    falling: true,
  });
  let drift = 0;
  /** What is worked out once for the screen and the painting: the beams through the branch, the water's sheen, the fog. */
  let made: {
    key: string;
    beams: HTMLCanvasElement[];
    inlet: HTMLCanvasElement;
    sheen: HTMLCanvasElement;
    river: HTMLCanvasElement;
    banks: HTMLCanvasElement[];
    riverBank: HTMLCanvasElement;
    /** How wide and tall a bank lies on the screen, in its pixels. */
    bank: [number, number];
    /** Room to cut the river's mist in, without the GPU. */
    mist: HTMLCanvasElement;
  } | null = null;

  const make = (ctx: Context, scene: Scene) => {
    const m = ctx.getTransform();
    const { width, height } = ctx.canvas;
    const key = `${width}x${height}:${m.a},${m.e},${m.f}`;
    // The painting's ink is the same whenever its leaf lies the same on the same screen.
    if (made?.key === key) return made;
    const scale = m.a;
    const layer = () => {
      const canvas = canvasOf(width, height);
      const g = canvas.getContext("2d");
      g?.setTransform(m);
      return { canvas, g };
    };
    /** `paint`, which draws only in `tint`, softened by `units` onto `target`. */
    const soft = (target: Context, units: number, tint: Tint, paint: (g: Context) => void) =>
      paintSoft(target, m, Math.max(1, units * scale), paint, tint);

    // Moonbeams of mixed widths fanning from over the cliff top, broken up by thin mist,
    // the branch's leaves blocking them and leaving shadows trailing down them.
    const random = seeded(53);
    const beams = [layer(), layer(), layer()];
    const [sx, sy] = BEAMS.from;
    for (let i = 0; i < BEAMS.count; i++) {
      const { g } = beams[i % 3];
      if (!g) continue;
      const angle = BEAMS.angle[0] + random() * (BEAMS.angle[1] - BEAMS.angle[0]);
      const half = 0.007 + random() ** 2 * 0.026;
      const reach = 430 + random() * 370;
      const peak = (0.3 + random() * 0.3) * (half > 0.018 ? 0.7 : 1);
      soft(g, 715 * (0.003 + half * 0.3), [224, 233, 248], (b) => {
        b.beginPath();
        b.moveTo(sx, sy);
        b.lineTo(sx + Math.cos(angle - half) * reach, sy + Math.sin(angle - half) * reach);
        b.lineTo(sx + Math.cos(angle + half) * reach, sy + Math.sin(angle + half) * reach);
        b.closePath();
        const light = b.createRadialGradient(sx, sy, 0, sx, sy, reach);
        light.addColorStop(0, "rgba(224,233,248,0)");
        light.addColorStop(0.18, `rgba(224,233,248,${peak})`);
        light.addColorStop(0.45, `rgba(224,233,248,${peak * 0.7})`);
        light.addColorStop(0.75, `rgba(224,233,248,${peak * 0.25})`);
        light.addColorStop(1, "rgba(224,233,248,0)");
        b.fillStyle = light;
        b.fill();
      });
    }
    const haze = layer();
    if (haze.g) {
      haze.g.fillStyle = "rgba(255,255,255,0.6)";
      haze.g.fillRect(-200, -200, 1200, 1200);
      for (let i = 0; i < 70; i++) {
        const at: Point = [random() * 500, 85 + random() * 715];
        glow(haze.g, at, 29 + random() * 86, "255,255,255", [
          [0, 0.25 + random() * 0.35],
          [1, 0],
        ]);
      }
    }
    const [dx, dy] = [Math.cos(1.89), Math.sin(1.89)];
    for (const { g } of beams) {
      if (!g) continue;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(haze.canvas, 0, 0);
      g.globalCompositeOperation = "destination-out";
      const step = 8.6 * scale;
      for (let s = 0; s < 10; s++) {
        g.globalAlpha = 0.5 * (1 - s / 10);
        g.drawImage(scene.ink, dx * s * step, dy * s * step);
      }
      g.globalAlpha = 1;
      g.drawImage(scene.ink, 0, 0);
      g.drawImage(scene.ink, 0, 0);
    }
    const inlet = layer();
    if (inlet.g) {
      inlet.g.save();
      inlet.g.translate(sx - 29, 85 + 14);
      inlet.g.scale(1.6, 1);
      glow(inlet.g, [0, 0], 129, "226,234,248", [
        [0, 0.4],
        [0.5, 0.15],
        [1, 0],
      ]);
      inlet.g.restore();
    }

    // A faint sheen on the stream and the fall.
    const SHEEN: Tint = [196, 212, 232];
    const sheen = layer();
    if (sheen.g) {
      soft(sheen.g, 21, SHEEN, (g) => {
        g.fillStyle = "rgba(196,212,232,0.16)";
        g.fill(stream);
      });
      soft(sheen.g, 8.6, SHEEN, (g) => {
        g.fillStyle = "rgba(196,212,232,0.2)";
        g.fill(fall);
      });
    }

    // Where mist lies on the river, and the fog.
    const river = layer();
    if (river.g)
      soft(river.g, 43, WHITE, (g) => {
        g.fillStyle = "#fff";
        g.fill(stream);
      });
    const bankHeight = Math.round(height * 0.3);
    made = {
      key,
      beams: beams.map(({ canvas }) => canvas),
      inlet: inlet.canvas,
      sheen: sheen.canvas,
      river: river.canvas,
      banks: FOG_BANKS.map((_, i) => fogBank(width, bankHeight, 100 + i)),
      riverBank: fogBank(width, bankHeight, 140),
      bank: [width * 2, bankHeight],
      mist: canvasOf(1, 1),
    };
    return made;
  };

  return {
    under: (ctx, { scene, held, time, still }) => {
      const parts = make(ctx, scene);
      const t = still ? 0 : time;
      // Cloud hides the moon: its beams and sheen go, and the sky glows less.
      const through = moon();
      const breathe = (0.92 + 0.08 * Math.sin(t * 0.21)) * (0.4 + 0.6 * through);
      const sky: [number, number][] = [
        [0, 0.62 * breathe],
        [0.35, 0.36 * breathe],
        [0.7, 0.1 * breathe],
        [1, 0],
      ];
      const inletAlpha = (0.85 + 0.15 * Math.sin(t * 0.17)) * through;
      const beamAlpha = (i: number) =>
        (0.72 + 0.28 * Math.sin(t * (0.22 + i * 0.07) + i * 2.1)) * through;
      if (gl?.ready && !held) {
        gl.behindInk(scene.ink, () => {
          glGlow(gl, ctx, SKY_GLOW.at, SKY_GLOW.reach, "226,234,248", sky);
          glLayer(gl, parts.sheen, through, true);
        });
        glLayer(gl, parts.inlet, inletAlpha);
        parts.beams.forEach((beam, i) => glLayer(gl, beam, beamAlpha(i)));
        return;
      }
      behindInk(ctx, { scene, held }, scratch, (g) => {
        glow(g, SKY_GLOW.at, SKY_GLOW.reach, "226,234,248", sky);
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = through;
        g.drawImage(parts.sheen, 0, 0);
        g.restore();
      });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = inletAlpha;
      ctx.drawImage(parts.inlet, 0, 0);
      parts.beams.forEach((beam, i) => {
        ctx.globalAlpha = beamAlpha(i);
        ctx.drawImage(beam, 0, 0);
      });
      ctx.restore();
    },
    over: (ctx, { scene, air, time, seconds, still }) => {
      const parts = make(ctx, scene);
      // The fog drifts with what plays, like the rest of the weather; the light never does.
      if (!still) drift += seconds * (0.15 + 0.85 * air.life);
      const { width, height } = ctx.canvas;
      const [bankWidth, bankHeight] = parts.bank;
      const banks = FOG_BANKS.map((bank, i) => {
        const phase = bank.y * 37;
        return {
          texture: parts.banks[i],
          x: -wrap(drift * bank.speed * width, bankWidth),
          y: bank.y * height - bankHeight / 2 + Math.sin(drift * 0.23 + phase) * height * 0.018,
          alpha: bank.alpha * (0.8 + 0.2 * Math.sin(drift * 0.31 + phase * 1.7)),
        };
      });
      const river = parts.riverBank;
      const riverAt = {
        x: -wrap(drift * 0.045 * width, bankWidth),
        y: height * 0.86 - bankHeight * 0.8,
      };
      if (gl?.ready) {
        for (const { texture, x, y, alpha } of banks)
          for (const left of [x, x + bankWidth])
            gl.image({
              source: texture,
              rect: [left, y, bankWidth, bankHeight],
              alpha,
              soft: true,
            });
        // More mist lying on the river, drifting with the current.
        for (const left of [riverAt.x, riverAt.x + bankWidth])
          gl.image({
            source: river,
            rect: [left, riverAt.y, bankWidth, bankHeight * 1.6],
            alpha: 0.55,
            within: parts.river,
            soft: true,
          });
        gl.fill([0, 0, 0], 0.3);
        gl.flush(ctx);
        sparkleGlints(ctx, time, still, moon());
        return;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const { texture, x, y, alpha } of banks) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(texture, x, y, bankWidth, bankHeight);
        ctx.drawImage(texture, x + bankWidth, y, bankWidth, bankHeight);
      }
      // More mist lying on the river, drifting with the current.
      if (parts.mist.width !== width || parts.mist.height !== height)
        Object.assign(parts.mist, { width, height });
      const mist = parts.mist.getContext("2d");
      if (mist) {
        mist.globalCompositeOperation = "source-over";
        mist.clearRect(0, 0, width, height);
        for (const left of [riverAt.x, riverAt.x + bankWidth])
          mist.drawImage(river, left, riverAt.y, bankWidth, bankHeight * 1.6);
        mist.globalCompositeOperation = "destination-in";
        mist.drawImage(parts.river, 0, 0);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(parts.mist, 0, 0);
      }
      ctx.restore();
      dim(ctx, 0.3);
      sparkleGlints(ctx, time, still, moon());
    },
  };

  /** Moonlight catching on the water: each glint flares and fades. */
  function sparkleGlints(ctx: Context, time: number, still: boolean, through: number) {
    const t = still ? 0 : time;
    const thickness = Math.max(pixel(ctx), 1.7);
    for (const glint of glints) {
      const rise = Math.max(0, Math.sin(t * glint.rate + glint.phase));
      if (glint.falling) {
        // On the falling water a glint is only a soft gleam sliding down it, never a flash: it
        // fades in and out over each slide, so it is gone when it starts again from the top.
        const slid = wrap(t * 20 + glint.phase * 30, 60);
        sparkle(ctx, [glint.x, glint.y + slid], {
          alpha: rise ** 3 * Math.sin((Math.PI * slid) / 60) ** 2 * 0.26 * through,
          length: 9 * glint.length,
          thickness: thickness * 2.2,
          color: "226,234,248",
          upright: true,
        });
        continue;
      }
      const alpha = rise ** 10 * 0.56 * through;
      if (alpha < 0.02) continue;
      sparkle(ctx, [glint.x, glint.y], {
        alpha,
        length: 7.2 * glint.length,
        thickness,
        color: "240,246,255",
      });
      if (alpha > 0.46)
        glow(ctx, [glint.x, glint.y], 2.1, "255,255,255", [
          [0, (alpha - 0.46) * 1.5],
          [1, 0],
        ]);
    }
  }
}

/**
 * How `region`'s painting is lit at night, its weather drawn from `image`. With `gl`, light and
 * dark lie on the GPU and may still wait in it after `under` and `over`: flush `gl` onto the
 * canvas before drawing anything else there.
 */
export function makeNight(
  region: CountryCode,
  image: ImageBitmap,
  gl: InkGL | null = null,
  moon: () => number = () => 1
): Night {
  switch (region) {
    case "CN":
      return teaStove(image, gl, moon);
    case "TW":
      return boatLamp(image, gl, moon);
    case "HK":
      return incense(gl);
    case "MO":
      return moonlitFalls(image, gl, moon);
  }
}

/** `scene`'s night light laid once into its painted `canvas`, held still: without shaders it isn't lit live. */
export function lightOnce(canvas: HTMLCanvasElement, scene: Scene, image: ImageBitmap) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const night = makeNight(scene.region, image);
  const moment = { scene, air: { life: 0, time: 0 }, time: 0, seconds: 0, still: true };
  ctx.save();
  ctx.setTransform(...scene.transform);
  night.under(ctx, moment);
  night.over(ctx, moment);
  ctx.restore();
}
