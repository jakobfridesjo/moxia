import { describe, expect, it } from "vitest";
import { provinceCapital } from "@/pages/radio/lib/provinces.ts";

describe("provinceCapital", () => {
  it("knows a province by its pinyin, its postal spelling or its Chinese name", () => {
    expect(provinceCapital("Guangdong")).toEqual([23.13, 113.26]);
    expect(provinceCapital("Kwangtung")).toEqual([23.13, 113.26]);
    expect(provinceCapital("广东省")).toEqual([23.13, 113.26]);
    expect(provinceCapital("Shanghai Direct Administered Municipality")).toEqual([31.23, 121.47]);
    expect(provinceCapital("Inner Mongolia")).toEqual([40.84, 111.75]);
  });

  it("tells Shanxi from Shaanxi, and gives up on what is not a province", () => {
    expect(provinceCapital("Shaanxi")).toEqual([34.34, 108.94]);
    expect(provinceCapital("shansi")).toEqual([37.87, 112.55]);
    expect(provinceCapital("Music")).toBeNull();
    expect(provinceCapital(null)).toBeNull();
  });
});
