import { describe, expect, it } from "vitest";
import { isNight } from "@/shared/lib/night.ts";

describe("isNight", () => {
  it("follows the system on auto", () => {
    expect(isNight("auto", true)).toBe(true);
    expect(isNight("auto", false)).toBe(false);
  });

  it("follows the sun at the station's place on auto, over the system", () => {
    expect(isNight("auto", false, true)).toBe(true);
    expect(isNight("auto", true, false)).toBe(false);
    expect(isNight("day", true, true)).toBe(false);
  });

  it("holds day or night whatever the system", () => {
    expect(isNight("day", true)).toBe(false);
    expect(isNight("night", false)).toBe(true);
  });
});
