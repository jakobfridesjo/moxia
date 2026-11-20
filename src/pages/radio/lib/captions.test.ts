import { describe, expect, it } from "vitest";
import { COLUMN_LENGTH, inkIn, inkLeft, isVertical, layOut } from "@/pages/radio/lib/captions.ts";

const caption = (at: number, duration: number, said: number[] = []) => ({
  text: "",
  duration,
  said,
  at,
  emotion: "neutral" as const,
  emotionSure: 0,
  burst: null,
});

describe("layOut", () => {
  it("writes Chinese in columns, read first on the right", () => {
    const layout = layOut("六个星期嘅课程，包括六堂课同两个测验。");
    expect(layout.vertical).toBe(true);
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(COLUMN_LENGTH);
    expect(layout.cells[0]).toEqual({ glyph: "六", column: 0, row: 0, from: 0 });
    expect(layout.cells[COLUMN_LENGTH]).toEqual({ glyph: "括", column: 1, row: 0, from: 9 });
  });

  it("writes other scripts in lines of whole words", () => {
    const layout = layOut("The tribal chieftain called for the boy.");
    expect(layout.vertical).toBe(false);
    expect(layout.cells.map((cell) => cell.glyph)).toEqual([
      "The tribal",
      "chieftain called",
      "for the boy.",
    ]);
    expect(layout.cells.map((cell) => cell.from)).toEqual([0, 11, 28]);
  });

  it("keeps each character's place in the text past the spaces it drops", () => {
    expect(layOut("早上 好").cells.map((cell) => cell.from)).toEqual([0, 1, 3]);
  });

  it("goes by what most of the letters are", () => {
    expect(isVertical("开放时间早上9点")).toBe(true);
    expect(isVertical("OK 好")).toBe(false);
    expect(isVertical("。")).toBe(false);
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
