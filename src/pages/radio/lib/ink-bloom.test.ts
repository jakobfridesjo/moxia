import { describe, expect, it } from "vitest";
import { soaked } from "@/pages/radio/lib/ink-bloom.ts";

describe("soaked", () => {
  const bloom = { origin: [0.2, 0.8] as [number, number], seed: 11 };
  const at = (cells: Float32Array, x: number, y: number) => cells[y * 40 + x];

  it("starts dry and ends soaked through, corners and all", () => {
    expect(Math.max(...soaked(bloom, 0, 40, 80))).toBe(0);
    expect(Math.min(...soaked(bloom, 1, 40, 80))).toBe(1);
  });

  it("spreads from where the finger lifted", () => {
    const halfway = soaked(bloom, 0.45, 40, 80);
    expect(at(halfway, 8, 64)).toBe(1);
    expect(at(halfway, 39, 0)).toBe(0);
  });

  it("only ever soaks further in", () => {
    const early = soaked(bloom, 0.3, 40, 80);
    const later = soaked(bloom, 0.6, 40, 80);
    expect(later.every((value, i) => value >= early[i])).toBe(true);
  });
});
