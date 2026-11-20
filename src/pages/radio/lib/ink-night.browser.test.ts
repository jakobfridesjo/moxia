import { describe, expect, it } from "vitest";
import type { CountryCode } from "@/shared/api/commands.ts";
import type { Air } from "@/pages/radio/lib/air.ts";
import { paintScene, type Scene } from "@/pages/radio/lib/ink-painter.ts";
import { lightOnce, makeNight, NIGHT_LOOK } from "@/pages/radio/lib/ink-night.ts";

type Box = [number, number, number, number];

const WIDTHS: Record<CountryCode, number> = { CN: 1023, TW: 1011, HK: 1004, MO: 715 };
const PLAYING: Air = { life: 1, time: 0 };

/** A leaf of `region`'s size, bare but for solid ink over `inked` (in leaf units). */
async function leaf(region: CountryCode, inked: Box[]) {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: WIDTHS[region], height: 1600 });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#000";
  for (const box of inked) ctx.fillRect(...box);
  return createImageBitmap(canvas);
}

/** `region`'s leaf painted at night on a phone-sized screen, and a front canvas to light it on. */
async function night(region: CountryCode, inked: Box[] = []) {
  const image = await leaf(region, inked);
  const scene = paintScene(document.createElement("canvas"), {
    region,
    width: 215,
    height: 430,
    pixelRatio: 1,
    image,
    ground: NIGHT_LOOK[region].paint,
    inkStrength: NIGHT_LOOK[region].inkStrength,
  }) as Scene;
  const front = document.createElement("canvas");
  Object.assign(front, { width: 215, height: 430 });
  const ctx = front.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  ctx.setTransform(...scene.transform);
  const alphaAt = ([x, y]: [number, number]) => {
    const [a, , , d, e, f] = scene.transform;
    return ctx.getImageData(Math.round(a * x + e), Math.round(d * y + f), 1, 1).data[3];
  };
  return { scene, ctx, image, alphaAt };
}

const moment = (scene: Scene, air: Air = PLAYING) => ({
  scene,
  air,
  time: 1,
  seconds: 0.016,
  still: false,
});

describe("makeNight", () => {
  it.each(["CN", "TW", "HK", "MO"] as const)("lights %s's paper", async (region) => {
    const { scene, ctx, image } = await night(region);
    const lights = makeNight(region, image);
    lights.under(ctx, moment(scene));
    lights.over(ctx, moment(scene));
    const pixels = ctx.getImageData(0, 0, 215, 430).data;
    expect(pixels.some((value, i) => i % 4 === 3 && value > 0)).toBe(true);
  });

  it("lays the stove's light behind the ink, never over it", async () => {
    const { scene, ctx, image, alphaAt } = await night("CN", [[700, 1400, 150, 100]]);
    makeNight("CN", image).under(ctx, moment(scene));
    expect(alphaAt([775, 1448])).toBe(0);
    expect(alphaAt([775, 1300])).toBeGreaterThan(100);
  });

  it("feathers the ember's light on his face, without canvas filters", async () => {
    const { scene, ctx, image, alphaAt } = await night("HK");
    makeNight("HK", image).under(ctx, moment(scene));
    const across = Array.from({ length: 30 }, (_, i) => alphaAt([366 + i * 4, 740]));
    const steps = across.slice(1).map((alpha, i) => Math.abs(alpha - across[i]));
    expect(Math.max(...across)).toBeGreaterThan(60);
    expect(Math.max(...steps)).toBeLessThan(60);
  });

  it("keeps its lights steady whatever plays", async () => {
    const { scene, ctx, image } = await night("CN");
    const lights = makeNight("CN", image);
    const frame = (air: Air) => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 215, 430);
      ctx.restore();
      lights.under(ctx, moment(scene, air));
      return Array.from(ctx.getImageData(0, 0, 215, 430).data);
    };
    expect(frame({ life: 0, time: 0 })).toEqual(frame({ life: 1, time: 40 }));
  });

  it("never sets a glint on ink", async () => {
    const { scene, ctx, image } = await night("TW", [[0, 900, 1011, 520]]);
    const lights = makeNight("TW", image);
    for (let time = 0; time < 8; time += 0.25) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 215, 430);
      ctx.restore();
      lights.over(ctx, { ...moment(scene), time });
      // Only night closing over it: black, nothing lit.
      const pixels = ctx.getImageData(0, 0, 215, 430).data;
      expect(pixels.every((value, i) => i % 4 === 3 || value === 0)).toBe(true);
    }
  });

  it("glints on open water", async () => {
    const { scene, ctx, image } = await night("TW");
    const lights = makeNight("TW", image);
    let brightest = 0;
    for (let time = 0; time < 8; time += 0.25) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 215, 430);
      ctx.restore();
      lights.over(ctx, { ...moment(scene), time });
      const pixels = ctx.getImageData(0, 0, 215, 430).data;
      for (let i = 0; i < pixels.length; i += 4) brightest = Math.max(brightest, pixels[i + 2]);
    }
    expect(brightest).toBeGreaterThan(40);
  });
});

describe("lightOnce", () => {
  it("paints the stove's light into the painting itself", async () => {
    const image = await leaf("CN", []);
    const canvas = document.createElement("canvas");
    const scene = paintScene(canvas, {
      region: "CN",
      width: 215,
      height: 430,
      pixelRatio: 1,
      image,
      ground: NIGHT_LOOK.CN.paint,
      inkStrength: NIGHT_LOOK.CN.inkStrength,
    }) as Scene;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no canvas");
    const [a, , , d, e, f] = scene.transform;
    const brightness = () => {
      const [r, g, b] = ctx.getImageData(
        Math.round(a * 775 + e),
        Math.round(d * 1300 + f),
        1,
        1
      ).data;
      return r + g + b;
    };
    const dark = brightness();
    lightOnce(canvas, scene, image);
    expect(brightness()).toBeGreaterThan(dark + 60);
  });
});
