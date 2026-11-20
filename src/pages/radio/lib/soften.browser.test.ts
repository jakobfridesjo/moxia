import { describe, expect, it } from "vitest";
import { paintSoft, type Tint } from "@/pages/radio/lib/soften.ts";

const [WIDTH, HEIGHT] = [160, 120];
const TINT: Tint = [224, 233, 248];

/** A wedge of fading light in one colour, softened by 6 pixels, as its pixels. */
function wedge(tint?: Tint) {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  paintSoft(
    ctx,
    new DOMMatrix(),
    6,
    (g) => {
      const light = g.createLinearGradient(0, 0, 0, HEIGHT);
      light.addColorStop(0, `rgba(${TINT.join(",")},0.9)`);
      light.addColorStop(1, `rgba(${TINT.join(",")},0)`);
      g.fillStyle = light;
      g.beginPath();
      g.moveTo(40, 10);
      g.lineTo(120, 100);
      g.lineTo(60, 110);
      g.fill();
    },
    tint
  );
  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
}

describe("paintSoft", () => {
  it("softens one colour by its alpha alone as it softens every channel", () => {
    const every = wedge();
    const alone = wedge(TINT);

    expect(alone.some((value, i) => i % 4 === 3 && value > 100)).toBe(true);
    // Compared as they show: colour weighed by alpha.
    const shown = (pixels: Uint8ClampedArray, i: number) =>
      i % 4 === 3 ? pixels[i] : (pixels[i] * pixels[i - (i % 4) + 3]) / 255;
    const worst = every.reduce(
      (most, _, i) => Math.max(most, Math.abs(shown(every, i) - shown(alone, i))),
      0
    );
    expect(worst).toBeLessThanOrEqual(2);
  });
});
