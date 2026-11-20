import { describe, expect, it } from "vitest";

import { wrap } from "@/pages/radio/lib/ink-painter.ts";

describe("wrap", () => {
  const glyphs = (text: string) => Array.from(text);
  const lengths = (lines: number[][]) => lines.map((line) => line.length);

  it("fills each line across the width before starting the next", () => {
    const text = glyphs("哦第三题第三题搞错了不好意思啊");
    expect(
      lengths(
        wrap(
          text.map(() => 10),
          text,
          70
        )
      )
    ).toEqual([7, 7, 1]);
  });

  it("never starts a line with a closing mark", () => {
    const text = glyphs("前途茫茫，这天");
    const lines = wrap(
      text.map(() => 10),
      text,
      40
    );
    expect(lines.map((line) => line.map((index) => text[index]).join(""))).toEqual([
      "前途茫茫，",
      "这天",
    ]);
  });

  it("fits wide cells by their own width", () => {
    const text = glyphs("想和我");
    expect(lengths(wrap([30, 10, 10], text, 30))).toEqual([1, 2]);
  });
});
