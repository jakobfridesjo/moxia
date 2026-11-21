import { describe, expect, it } from "vitest";
import { fallsBox, type Rows } from "@/pages/radio/lib/ink-falls.ts";

const sheet: Rows = [
  [100, 0, 4],
  [90, 100, 8],
  [90, 200, 20],
];

describe("fallsBox", () => {
  it("holds the sheet and the vapour spreading past it", () => {
    const [left, top, width, height] = fallsBox(sheet);
    expect(left).toBeLessThan(90 - 20 * 1.5);
    expect(left + width).toBeGreaterThan(100 + 20 * 1.5);
    expect(top).toBeLessThan(0);
    expect(top + height).toBeGreaterThan(200);
  });
});
