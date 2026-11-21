import { describe, expect, it } from "vitest";
import { inscribedRuns, lunarDate, timeOfDay } from "@/pages/radio/lib/inscription.ts";

describe("inscription", () => {
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

  it("leaves brackets and other marks out", () => {
    expect(inscribedRuns("好家庭廣播電台（Classical 台中古典音樂台）")).toEqual([
      { text: "好家庭廣播電台", set: "characters" },
      { text: "Classical", set: "sideways" },
      { text: "台中古典音樂台", set: "characters" },
    ]);
    expect(inscribedRuns("上海纪实频道《文化中国》广播版")).toEqual([
      { text: "上海纪实频道文化中国广播版", set: "characters" },
    ]);
    expect(inscribedRuns("91.5 HIT FM MACAU (成都)")).toEqual([
      { text: "91.5 HIT FM MACAU", set: "sideways" },
      { text: "成都", set: "characters" },
    ]);
  });
});
