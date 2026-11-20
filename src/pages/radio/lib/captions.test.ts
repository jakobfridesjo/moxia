import { describe, expect, it } from "vitest";
import { inkIn, inkLeft, isChinese, layOut } from "@/pages/radio/lib/captions.ts";

const caption = (at: number, duration: number, said: number[] = []) => ({
  text: "",
  duration,
  said,
  at,
  emotion: "neutral" as const,
  emotionSure: 0,
  readings: [] as string[],
  burst: null,
});

describe("layOut", () => {
  it("puts Chinese a character to a cell", () => {
    const layout = layOut("六个星期嘅课程");
    expect(layout.chinese).toBe(true);
    expect(layout.cells.map((cell) => cell.glyph).join("")).toBe("六个星期嘅课程");
    expect(layout.cells[1]).toEqual({ glyph: "个", reading: "", from: 1 });
  });

  it("puts other scripts a word to a cell", () => {
    const layout = layOut("The tribal chieftain.");
    expect(layout.chinese).toBe(false);
    expect(layout.cells.map((cell) => cell.glyph)).toEqual(["The", "tribal", "chieftain."]);
    expect(layout.cells.map((cell) => cell.from)).toEqual([0, 4, 11]);
  });

  it("keeps each character's place in the text past the spaces it drops", () => {
    expect(layOut("早上 好").cells.map((cell) => cell.from)).toEqual([0, 1, 3]);
    expect(
      layOut("早上 好", ["zǎo", "shang", "", "hǎo"]).cells.map((cell) => cell.reading)
    ).toEqual(["zǎo", "shang", "hǎo"]);
  });

  it("goes by what most of the letters are", () => {
    expect(isChinese("开放时间早上9点")).toBe(true);
    expect(isChinese("OK 好")).toBe(false);
    expect(isChinese("。")).toBe(false);
  });
});

describe("inkIn", () => {
  it("fades each character in as it is said", () => {
    const spoken = { ...caption(1000, 2, [0, 0.1, 1]), text: "早上好" };
    const layout = layOut(spoken.text);
    expect(inkIn(spoken, layout, 1000)).toEqual([0, 0, 0]);
    const soon = inkIn(spoken, layout, 1300);
    expect(soon[0]).toBeCloseTo(0.75);
    expect(soon[1]).toBeCloseTo(0.5);
    expect(soon[2]).toBe(0);
    expect(inkIn(spoken, layout, 9000)).toEqual([1, 1, 1]);
  });
});

describe("inkLeft", () => {
  it("holds once written, then fades", () => {
    const shown = caption(0, 2);
    expect(inkLeft(shown, 4000, null)).toBe(1);
    expect(inkLeft(shown, 2000 + 3500 + 750, null)).toBeCloseTo(0.5);
    expect(inkLeft(shown, 60_000, null)).toBe(0);
  });

  it("gives way quickly to what is said next", () => {
    const shown = caption(0, 2);
    expect(inkLeft(shown, 1250, 1000)).toBeCloseTo(0.5);
  });
});
