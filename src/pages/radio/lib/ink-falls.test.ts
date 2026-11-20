import { describe, expect, it } from "vitest";
import {
  fallsAt,
  fallsBox,
  sheetAt,
  type FallsLook,
  type Rows,
} from "@/pages/radio/lib/ink-falls.ts";

const sheet: Rows = [
  [100, 0, 4],
  [90, 100, 8],
  [90, 200, 20],
];

describe("sheetAt", () => {
  it("follows the sheet's centre and widens with it", () => {
    expect(sheetAt(sheet, 50)).toEqual([95, 6]);
    expect(sheetAt(sheet, 150)).toEqual([90, 14]);
  });

  it("holds its ends above the top and below the foot", () => {
    expect(sheetAt(sheet, -20)).toEqual([100, 4]);
    expect(sheetAt(sheet, 260)).toEqual([90, 20]);
  });
});

describe("fallsAt", () => {
  /** Noise that is the same everywhere, so only the shape of the falls shows. */
  const even = (value: number) => new Float32Array(256 * 256).fill(value);
  const look: FallsLook = {
    rows: sheet,
    flow: 0,
    time: 0,
    light: [255, 255, 255],
    alpha: { sheet: 0.3, steam: 0.3 },
  };

  it("mists down the middle of the sheet and hardly at all far beside it", () => {
    expect(fallsAt(even(0.7), look, 90, 100)).toBeGreaterThan(0.4);
    expect(fallsAt(even(0.7), look, 90 + 14 * 5, 100)).toBeLessThan(0.001);
  });

  it("fades into mist toward its foot", () => {
    expect(fallsAt(even(0.7), look, 90, 190)).toBeLessThan(fallsAt(even(0.7), look, 90, 100));
  });

  it("keeps all it draws inside its box", () => {
    const [left, top, width, height] = fallsBox(sheet);
    expect(left).toBeLessThan(90 - 20 * 1.5);
    expect(left + width).toBeGreaterThan(100 + 20 * 1.5);
    expect(top).toBeLessThan(0);
    expect(top + height).toBeGreaterThan(200);
  });
});
