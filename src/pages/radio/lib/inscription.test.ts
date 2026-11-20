import { describe, expect, it } from "vitest";
import {
  chineseNumerals,
  inscribedRuns,
  lunarDate,
  splitFrequency,
  timeOfDay,
  titleSize,
} from "@/pages/radio/lib/inscription.ts";

describe("inscription", () => {
  it("splits a trailing frequency off the station name", () => {
    expect(splitFrequency("澳門電台 FM100.7")).toEqual({
      title: "澳門電台",
      band: "FM",
      frequency: "100.7",
    });
    expect(splitFrequency("中国之声")).toEqual({ title: "中国之声", band: null, frequency: null });
    // A name that is nothing but a frequency keeps it.
    expect(splitFrequency("FM99.7").title).toBe("FM99.7");
  });

  it("writes numbers in Chinese numerals", () => {
    expect(chineseNumerals("100.7", "點")).toBe("一〇〇點七");
    expect(chineseNumerals("92.6", "点")).toBe("九二点六");
  });

  it("dates by the lunar calendar at the stations", () => {
    // 2026-11-12 21:00 in UTC+8 is the fourth day of the tenth lunar month of 丙午.
    expect(lunarDate(new Date("2026-11-12T13:00:00Z"), "zh-Hant")).toBe("丙午年十月初四");
    expect(lunarDate(new Date("2026-11-12T17:00:00Z"), "zh-Hans")).toBe("丙午年十月初五");
  });

  it("names the time of day", () => {
    expect(timeOfDay(6)).toBe("dawn");
    expect(timeOfDay(12)).toBe("day");
    expect(timeOfDay(18)).toBe("dusk");
    expect(timeOfDay(23)).toBe("night");
    expect(timeOfDay(2)).toBe("night");
  });

  it("shrinks a title to one column, then sets it smaller in two", () => {
    expect(titleSize("中国之声")).toBe(
      "clamp(1.2rem, calc(110svh / 4.00), min(1.9rem, max(1.5rem, 55svh / 4.00)))"
    );
  });

  it("sets ASCII brackets in the forms that turn with a vertical line", () => {
    expect(inscribedRuns("91.5 HIT FM MACAU (成都)")).toEqual([
      { text: "91.5 HIT FM MACAU", set: "sideways" },
      { text: "（成都）", set: "characters" },
    ]);
  });
});
