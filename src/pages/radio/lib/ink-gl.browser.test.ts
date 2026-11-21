import { afterEach, describe, expect, it } from "vitest";
import type { CountryCode } from "@/shared/api/commands.ts";
import type { Air } from "@/pages/radio/lib/air.ts";
import { leafSize, paintScene, type Scene } from "@/pages/radio/lib/ink-painter.ts";
import { makeNight, NIGHT_LOOK } from "@/pages/radio/lib/ink-night.ts";
import { makeWeather } from "@/pages/radio/lib/ink-weather.ts";
import { DAY_TONE } from "@/pages/radio/lib/ink-tone.ts";
import { makeDay } from "@/pages/radio/lib/ink-day.ts";
import { makeSky, weatherFor, type SkyNow } from "@/pages/radio/lib/ink-sky.ts";
import { createInkGL, type InkGL, type InkLayers } from "@/pages/radio/lib/ink-gl.ts";

/*
 * The GPU's layers over the painting: what each effect lays on which, and the night's light
 * matching the 2D canvas's, which lights a painting once when there are no shaders.
 */

const REGIONS: CountryCode[] = ["CN", "TW", "HK", "MO"];
const WIDTHS: Record<CountryCode, number> = { CN: 1023, TW: 1011, HK: 1004, MO: 715 };
const PLAYING: Air = { life: 1, time: 4.2 };
const STOPPED: Air = { life: 0, time: 4.2 };
const [WIDTH, HEIGHT] = [215, 430];

const made: InkGL[] = [];
afterEach(() => made.splice(0).forEach((gl) => gl.dispose()));

/** A layer the size of the test screen, cleared; the test browser's WebGL runs on the CPU. */
function renderer() {
  const gl = createInkGL(undefined, { allowSoftware: true });
  if (!gl) throw new Error("no WebGL2");
  made.push(gl);
  gl.clear(WIDTH, HEIGHT);
  return gl;
}

const layersOf = (): InkLayers => ({ under: renderer(), over: renderer() });

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
  return composed(scene, paint, []);
}

/**
 * What `paint` draws on a clear canvas in the scene's units, with `layers` flushed and laid
 * over and under it as the browser lays them: the first under, the rest over.
 */
function composed(
  scene: Scene,
  paint: (ctx: CanvasRenderingContext2D) => void,
  [under, ...over]: InkGL[]
) {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.setTransform(...scene.transform);
  paint(ctx);
  const out = document.createElement("canvas");
  Object.assign(out, { width: WIDTH, height: HEIGHT });
  const shown = out.getContext("2d", { willReadFrequently: true });
  if (!shown) throw new Error("no canvas");
  for (const gl of [under, ...over]) gl?.flush();
  if (under) shown.drawImage(under.canvas, 0, 0);
  shown.drawImage(canvas, 0, 0);
  for (const gl of over) shown.drawImage(gl.canvas, 0, 0);
  return shown.getImageData(0, 0, WIDTH, HEIGHT).data;
}

/** What a layer holds once flushed. */
function held(gl: InkGL) {
  gl.flush();
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(gl.canvas, 0, 0);
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
    it(`lies over ${region} under the figures, and the veil and gust over them`, async () => {
      const { image, scene } = await sceneOf(region, false);
      const layers = layersOf();
      const weather = makeWeather(region, image, leafSize(image), DAY_TONE, layers);
      drawn(scene, (ctx) => weather.draw(ctx, PLAYING, 0, true));
      expect(inked(held(layers.under))).toBe(true);
      expect(inked(held(layers.over))).toBe(false);

      drawn(scene, (ctx) => {
        weather.veil(ctx, STOPPED);
        weather.gust(ctx, 0.5, 1);
      });
      expect(inked(held(layers.over))).toBe(true);
    });

  it("lays nothing once the renderer is let go", async () => {
    const { image, scene } = await sceneOf("CN", false);
    const layers = layersOf();
    const weather = makeWeather("CN", image, leafSize(image), DAY_TONE, layers);
    layers.under.dispose();
    drawn(scene, (ctx) => weather.draw(ctx, PLAYING, 0, true));

    expect(layers.under.ready).toBe(false);
  });
});

describe("night on the GPU", () => {
  for (const region of REGIONS)
    it(`lights ${region} as the 2D canvas lights it`, async () => {
      const { image, scene } = await sceneOf(region, true);
      const moment = { scene, air: PLAYING, time: 1.3, seconds: 0, still: false };
      const flat = drawn(scene, (ctx) => {
        const night = makeNight(region, image);
        night.under(ctx, moment);
        night.over(ctx, moment);
      });
      const layers = layersOf();
      const night = makeNight(region, image, layers);
      const gpu = composed(
        scene,
        (ctx) => {
          night.under(ctx, moment);
          night.over(ctx, moment);
        },
        [layers.under, layers.over]
      );

      expect(inked(gpu)).toBe(true);
      const { mean, nearlyWorst } = difference(flat, gpu);
      expect(mean).toBeLessThan(2);
      expect(nearlyWorst).toBeLessThan(12);
    });

  it("leaves the light behind the ink", async () => {
    const { image, scene } = await sceneOf("CN", true);
    const layers = layersOf();
    drawn(scene, (ctx) =>
      makeNight("CN", image, layers).under(ctx, {
        scene,
        air: PLAYING,
        time: 0,
        seconds: 0,
        still: true,
      })
    );
    const gpu = held(layers.under);
    const ink = scene.ink.getContext("2d")?.getImageData(0, 0, WIDTH, HEIGHT).data;
    if (!ink) throw new Error("no ink");
    const inkedPixel = ink.findIndex((value, i) => i % 4 === 3 && value === 255);
    expect(inkedPixel).toBeGreaterThan(0);
    expect(gpu[inkedPixel]).toBe(0);
  });
});

describe("the day on the GPU", () => {
  /** Each painting's own weather, as it shows while the real one is not known. */
  const skyOf = (region: "CN" | "TW" | "MO" | "HK") => (): SkyNow => ({
    weather: weatherFor(region, null),
    glow: 0,
    night: false,
    moon: 1,
  });

  for (const region of ["TW", "MO", "HK"] as const)
    it(`lays ${region}'s weather and light under the figures`, async () => {
      const { scene } = await sceneOf(region, false);
      const layers = layersOf();
      const day = makeDay(region, layers, skyOf(region));
      if (!day) throw new Error(`no day for ${region}`);
      drawn(scene, (ctx) => day.draw(ctx, { scene, air: PLAYING, still: false }));

      expect(inked(held(layers.under))).toBe(true);
    });

  it("lays only Hong Kong's dust over the figures, and only while it moves", async () => {
    for (const region of ["TW", "MO", "HK"] as const) {
      const { scene } = await sceneOf(region, false);
      const layers = layersOf();
      const day = makeDay(region, layers, skyOf(region));
      const over = (still: boolean) => {
        layers.over.clear(WIDTH, HEIGHT);
        drawn(scene, (ctx) => day?.over(ctx, { scene, air: PLAYING, still }));
        return held(layers.over);
      };
      expect(inked(over(false))).toBe(region === "HK");
      expect(inked(over(true))).toBe(false);
    }
  });

  it("is left out where there is no day", () => {
    expect(makeDay("CN", layersOf(), skyOf("CN"))).toBeNull();
  });

  it("lays real rain, snow, fog and dusk over any painting", async () => {
    const { scene } = await sceneOf("CN", false);
    const clear = { rain: 0, snow: 0, cloud: 0, fog: 0, wind: 0, storm: false };
    const skyWith = (sky: Partial<SkyNow>) => {
      const gl = renderer();
      const overhead = makeSky(gl, () => ({
        weather: clear,
        glow: 0,
        night: false,
        moon: 1,
        ...sky,
      }));
      drawn(scene, (ctx) => overhead.draw(ctx, { scene, air: PLAYING, still: false }));
      return held(gl);
    };
    expect(inked(skyWith({}))).toBe(false);
    expect(inked(skyWith({ weather: { ...clear, cloud: 0.8 } }))).toBe(false);
    for (const weather of [{ rain: 1 }, { snow: 1 }, { fog: 1 }])
      expect(inked(skyWith({ weather: { ...clear, ...weather } }))).toBe(true);
    expect(inked(skyWith({ glow: 1 }))).toBe(true);
  });

  it("takes the painted smoke out of the leaf where the live smoke rises", async () => {
    const day = makeDay("HK", layersOf(), skyOf("HK"));
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
