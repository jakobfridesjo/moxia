import { describe, expect, it } from "vitest";
import { listenToAir, type Air } from "@/pages/radio/lib/air.ts";

const FRAME = 1 / 60;

function listen(seconds: number, playing: boolean) {
  const hear = listenToAir();
  const frames: Air[] = [];
  for (let frame = 0; frame < seconds / FRAME; frame++)
    frames.push(hear({ playing, seconds: FRAME }));
  return frames;
}

describe("listenToAir", () => {
  it("stirs while something plays and settles once it stops", () => {
    expect(listen(5, true).at(-1)?.life).toBeGreaterThan(0.99);
    expect(listen(5, false).at(-1)?.life).toBe(0);
  });

  it("slows effect time to a quarter once nothing plays", () => {
    expect(listen(4, false).at(-1)?.time).toBeCloseTo(1, 1);
    expect(listen(4, true).at(-1)?.time).toBeGreaterThan(3);
  });
});
