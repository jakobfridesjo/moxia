import { describe, expect, it } from "vitest";
import { makeStation } from "@/shared/test/fixtures.ts";
import { glowAt, isNightAt, placeOf, sunAltitude } from "@/pages/radio/lib/sun.ts";

const TAIPEI = [25.03, 121.56] as const;

describe("sunAltitude", () => {
  it("is high at noon and under the horizon at midnight in Taipei", () => {
    // Noon and midnight in Taipei (UTC+8) at the June solstice: the sun is all but overhead.
    expect(sunAltitude(new Date("2026-06-21T04:00:00Z"), ...TAIPEI)).toBeGreaterThan(85);
    expect(sunAltitude(new Date("2026-06-21T16:00:00Z"), ...TAIPEI)).toBeLessThan(-30);
  });

  it("crosses the horizon at Beijing's sunset", () => {
    // Beijing's sun set at 16:51 local time on 2026-11-20.
    expect(Math.abs(sunAltitude(new Date("2026-11-20T08:51:00Z"), 39.9, 116.4))).toBeLessThan(1.2);
  });
});

describe("the light of the sun", () => {
  it("is night only once dusk has passed, and warmest at the horizon", () => {
    expect(isNightAt(-1)).toBe(false);
    expect(isNightAt(-5)).toBe(true);
    expect(glowAt(1)).toBe(1);
    expect(glowAt(30)).toBe(0);
    expect(glowAt(-10)).toBe(0);
  });
});

describe("placeOf", () => {
  it("uses the station's own place, else its region's city", () => {
    const station = makeStation({ countryCode: "TW", latitude: 22.6, longitude: 120.3 });
    expect(placeOf("TW", station)).toEqual([22.6, 120.3]);
    expect(placeOf("TW", makeStation({ countryCode: "TW" }))).toEqual(TAIPEI);
    expect(placeOf("HK", null)).toEqual([22.3, 114.17]);
  });
});
