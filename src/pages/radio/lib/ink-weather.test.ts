import { describe, expect, it } from "vitest";
import { along } from "@/pages/radio/lib/ink-weather.ts";

describe("along", () => {
  const line: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];

  it("walks the segments evenly by index, with the normal to the left of the way", () => {
    expect(along(line, 0)).toEqual([0, 0, -0, 1]);
    expect(along(line, 0.25)).toEqual([5, 0, -0, 1]);
    expect(along(line, 0.75)).toEqual([10, 5, -1, 0]);
  });

  it("carries on past the end the way the last segment goes", () => {
    expect(along(line, 1.5).slice(0, 2)).toEqual([10, 20]);
  });
});
