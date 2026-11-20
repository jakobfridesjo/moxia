import { describe, expect, it } from "vitest";
import { formatClockTime, formatShortDate } from "@/shared/lib/date.ts";

describe("date formatters", () => {
  it("uses explicit fallbacks for missing and invalid short dates", () => {
    expect(formatShortDate(null)).toBe("N/A");
    expect(formatShortDate("not-a-date")).toBe("Invalid Date");
  });

  it("writes a time of day as hours and minutes", () => {
    expect(formatClockTime(new Date(2026, 10, 14, 21, 4).getTime())).toMatch(/^(21|09):04/);
  });
});
