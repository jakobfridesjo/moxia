import { describe, expect, it } from "vitest";
import { stationClock } from "@/shared/lib/station-time.ts";

describe("station time", () => {
  it("reads the clock in UTC+8", () => {
    expect(stationClock(new Date("2026-11-12T00:30:00Z"))).toEqual({ hour: 8, minute: 30 });
    expect(stationClock(new Date("2026-11-12T16:05:00Z"))).toEqual({ hour: 0, minute: 5 });
  });
});
