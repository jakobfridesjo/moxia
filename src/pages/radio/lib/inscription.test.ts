import { describe, expect, it } from "vitest";
import {
  chineseNumerals,
  lunarDate,
  splitFrequency,
  stationInitial,
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

  it("takes a station's first Chinese character for its preset key", () => {
    expect(stationInitial("澳門電台 FM100.7")).toBe("澳");
    expect(stationInitial("RTHK 香港電台第一台")).toBe("香");
    expect(stationInitial("Radio Free Asia")).toBeNull();
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

  it("only shrinks a title too long for two columns", () => {
    expect(titleSize("中国之声")).toBe("clamp(1.2rem, calc(110svh / 4.00), 1.9rem)");
  });
});
