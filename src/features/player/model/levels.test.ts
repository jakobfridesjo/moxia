import { describe, expect, it } from "vitest";
import { meterReading } from "@/features/player/model/levels.ts";

describe("meterReading", () => {
  it("reads decibels, from silence to full scale", () => {
    expect(meterReading(0)).toBe(0);
    expect(meterReading(1)).toBe(1);
    expect(meterReading(2)).toBe(1);
    expect(meterReading(0.5)).toBeCloseTo(1 - 6.02 / 36, 3);
    expect(meterReading(0.001)).toBe(0);
  });
});
