import { afterEach, describe, expect, it } from "vitest";
import type { CountryCode } from "@/shared/api/commands.ts";
import type { Air } from "@/pages/radio/lib/air.ts";
import { leafSize, paintScene, type Scene } from "@/pages/radio/lib/ink-painter.ts";
import { makeNight, NIGHT_LOOK } from "@/pages/radio/lib/ink-night.ts";
import { makeWeather } from "@/pages/radio/lib/ink-weather.ts";
import { DAY_TONE } from "@/pages/radio/lib/ink-tone.ts";
import { bloomer } from "@/pages/radio/lib/ink-bloom.ts";
import { makeDay } from "@/pages/radio/lib/ink-day.ts";
import { createInkGL, type InkGL } from "@/pages/radio/lib/ink-gl.ts";

/*
 * The GPU draws what the 2D canvas would, so either may run: each is drawn both ways, and
 * the two compared pixel by pixel. They differ only in how mist is resampled and rounded.
 */

const REGIONS: CountryCode[] = ["CN", "TW", "HK", "MO"];
const WIDTHS: Record<CountryCode, number> = { CN: 1023, TW: 1011, HK: 1004, MO: 715 };
const PLAYING: Air = { life: 1, time: 4.2 };
const STOPPED: Air = { life: 0, time: 4.2 };
const [WIDTH, HEIGHT] = [215, 430];

const made: InkGL[] = [];
afterEach(() => made.splice(0).forEach((gl) => gl.dispose()));

function renderer() {
  const gl = createInkGL();
  if (!gl) throw new Error("no WebGL2");
  made.push(gl);
  return gl;
}

/** A leaf of `region`'s size, bare but for a few strokes of solid ink. */
async function leaf(region: CountryCode) {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: WIDTHS[region], height: 1600 });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#000";
  for (const [x, y, w, h] of [
    [120, 300, 40, 600],
    [400, 900, 300, 30],
    [600, 1300, 60, 200],
  ])
    ctx.fillRect(x, y, w, h);
  return createImageBitmap(canvas);
}

async function sceneOf(region: CountryCode, night: boolean) {
  const image = await leaf(region);
  const scene = paintScene(document.createElement("canvas"), {
    region,
    width: WIDTH,
    height: HEIGHT,
    pixelRatio: 1,
    image,
    ground: night ? NIGHT_LOOK[region].paint : undefined,
    inkStrength: night ? NIGHT_LOOK[region].inkStrength : undefined,
  }) as Scene;
  return { image, scene };
}

/** What `paint` draws on a clear canvas, in the scene's units. */
function drawn(scene: Scene, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  ctx.setTransform(...scene.transform);
  paint(ctx);
  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
}

/** A channel as it shows: its colour weighed by its alpha, as the canvas composites it. */
const shown = (pixels: Uint8ClampedArray, i: number) =>
  i % 4 === 3 ? pixels[i] : (pixels[i] * pixels[i - (i % 4) + 3]) / 255;

/**
 * How far apart two drawings are, channel by channel, out of 255: on average, and at worst but
 * for the odd edge pixel. Compared as they show, since a nearly clear pixel's colour rounds wildly.
 */
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  const gaps = a.map((_, i) => Math.abs(shown(a, i) - shown(b, i)));
  const sorted = Uint8Array.from(gaps).sort();
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  return { mean, nearlyWorst: sorted[Math.floor(sorted.length * 0.999)] };
}

/** Also that something was drawn at all, so two blank canvases do not pass. */
function inked(pixels: Uint8ClampedArray) {
  return pixels.some((value, i) => i % 4 === 3 && value > 8);
}

describe("mist on the GPU", () => {
  for (const region of REGIONS)
    it(`lies over ${region} as the 2D canvas lays it`, async () => {
      const { image, scene } = await sceneOf(region, false);
      const paint = (gl: InkGL | null) => (ctx: CanvasRenderingContext2D) => {
        const weather = makeWeather(region, image, leafSize(image), DAY_TONE, gl);
        weather.draw(ctx, PLAYING, 0, true);
        weather.veil(ctx, STOPPED);
        weather.gust(ctx, 0.5, 1);
        gl?.flush(ctx);
      };
      const flat = drawn(scene, paint(null));
      const gpu = drawn(scene, paint(renderer()));

      expect(inked(gpu)).toBe(true);
      const { mean, nearlyWorst } = difference(flat, gpu);
      expect(mean).toBeLessThan(2.5);
      expect(nearlyWorst).toBeLessThan(16);
    });
});

describe("without the GPU", () => {
  it("draws in 2D once the renderer is let go", async () => {
    const { image, scene } = await sceneOf("CN", false);
    const gl = renderer();
    const weather = makeWeather("CN", image, leafSize(image), DAY_TONE, gl);
    gl.dispose();
    const after = drawn(scene, (ctx) => {
      weather.draw(ctx, PLAYING, 0, true);
      gl.flush(ctx);
    });
    const flat = drawn(scene, (ctx) =>
      makeWeather("CN", image, leafSize(image), DAY_TONE).draw(ctx, PLAYING, 0, true)
    );

    expect(gl.ready).toBe(false);
    expect(after).toEqual(flat);
  });
});

describe("night on the GPU", () => {
  for (const region of REGIONS)
    it(`lights ${region} as the 2D canvas lights it`, async () => {
      const { image, scene } = await sceneOf(region, true);
      const moment = { scene, air: PLAYING, time: 1.3, seconds: 0, still: false };
      const paint = (gl: InkGL | null) => (ctx: CanvasRenderingContext2D) => {
        const night = makeNight(region, image, gl);
        night.under(ctx, moment);
        gl?.flush(ctx);
        night.over(ctx, moment);
        gl?.flush(ctx);
      };
      const flat = drawn(scene, paint(null));
      const gpu = drawn(scene, paint(renderer()));

      expect(inked(gpu)).toBe(true);
      const { mean, nearlyWorst } = difference(flat, gpu);
      expect(mean).toBeLessThan(2);
      expect(nearlyWorst).toBeLessThan(12);
    });

  it("leaves the light behind the ink", async () => {
    const { image, scene } = await sceneOf("CN", true);
    const gpu = drawn(scene, (ctx) => {
      const gl = renderer();
      makeNight("CN", image, gl).under(ctx, {
        scene,
        air: PLAYING,
        time: 0,
        seconds: 0,
        still: true,
      });
      gl.flush(ctx);
    });
    const ink = scene.ink.getContext("2d")?.getImageData(0, 0, WIDTH, HEIGHT).data;
    if (!ink) throw new Error("no ink");
    const inkedPixel = ink.findIndex((value, i) => i % 4 === 3 && value === 255);
    expect(inkedPixel).toBeGreaterThan(0);
    expect(gpu[inkedPixel]).toBe(0);
  });
});

describe("the bloom on the GPU", () => {
  it("soaks the new place in as the 2D canvas does", async () => {
    const { scene } = await sceneOf("CN", false);
    const incoming = document.createElement("canvas");
    Object.assign(incoming, { width: WIDTH, height: HEIGHT });
    const g = incoming.getContext("2d");
    if (!g) throw new Error("no canvas");
    const wash = g.createLinearGradient(0, 0, WIDTH, HEIGHT);
    wash.addColorStop(0, "rgb(230,220,200)");
    wash.addColorStop(1, "rgb(40,40,40)");
    g.fillStyle = wash;
    g.fillRect(0, 0, WIDTH, HEIGHT);
    const paint = (gl: InkGL | null) => (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      bloomer({ origin: [0.3, 0.7], seed: 17 }, gl)(ctx, incoming, 0.45);
    };
    const flat = drawn(scene, paint(null));
    // The test browser's WebGL runs on the CPU, where the bloom would take the 2D path.
    const gpu = drawn(scene, paint({ ...renderer(), ready: true, software: false }));

    expect(inked(gpu)).toBe(true);
    const { mean, nearlyWorst } = difference(flat, gpu);
    expect(mean).toBeLessThan(2);
    expect(nearlyWorst).toBeLessThan(8);
  });
});

describe("the day on the GPU", () => {
  /** The renderer as a real GPU would report it: the test browser's WebGL runs on the CPU. */
  const gpu = (): InkGL => ({ ...renderer(), ready: true, software: false });

  for (const region of ["TW", "MO", "HK"] as const)
    it(`lays ${region}'s weather and light over the leaf`, async () => {
      const { scene } = await sceneOf(region, false);
      const gl = gpu();
      const day = makeDay(region, gl);
      if (!day) throw new Error(`no day for ${region}`);
      const pixels = drawn(scene, (ctx) => {
        day.draw(ctx, { scene, air: PLAYING, still: false });
        gl.flush(ctx);
      });

      expect(inked(pixels)).toBe(true);
    });

  it("draws only Hong Kong's dust over the figures, and only while it moves", async () => {
    for (const region of ["TW", "MO", "HK"] as const) {
      const { scene } = await sceneOf(region, false);
      const gl = gpu();
      const day = makeDay(region, gl);
      const over = (still: boolean) =>
        drawn(scene, (ctx) => {
          day?.over(ctx, { scene, air: PLAYING, still });
          gl.flush(ctx);
        });
      expect(inked(over(false))).toBe(region === "HK");
      expect(inked(over(true))).toBe(false);
    }
  });

  it("is left out where there is no day, or the GPU is the CPU", () => {
    expect(makeDay("CN", gpu())).toBeNull();
    expect(makeDay("HK", renderer())).toBeNull();
    expect(makeDay("HK", null)).toBeNull();
  });

  it("takes the painted smoke out of the leaf where the live smoke rises", async () => {
    const day = makeDay("HK", gpu());
    const image = await leaf("HK");
    const paint = (erased?: { box: [number, number, number, number]; feather: number } | null) =>
      paintScene(document.createElement("canvas"), {
        region: "HK",
        width: WIDTH,
        height: HEIGHT,
        pixelRatio: 1,
        image,
        erased,
      }) as Scene;
    const alphaAt = (scene: Scene, [x, y]: [number, number]) => {
      const [a, , , d, e, f] = scene.transform;
      const ctx = scene.ink.getContext("2d");
      return ctx?.getImageData(Math.round(a * x + e), Math.round(d * y + f), 1, 1).data[3];
    };
    // The test leaf's first stroke runs through the painted smoke, and on below the hands.
    expect(alphaAt(paint(), [140, 600])).toBe(255);
    expect(alphaAt(paint(day?.erased), [140, 600])).toBe(0);
    expect(alphaAt(paint(day?.erased), [140, 880])).toBe(255);
  });
});
