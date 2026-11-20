import { describe, expect, it } from "vitest";
import { formatTapeTime } from "@/shared/lib/duration.ts";

describe("formatTapeTime", () => {
  it("reads minutes and seconds, and hours once there are any", () => {
    expect(formatTapeTime(0)).toBe("0:00");
    expect(formatTapeTime(95.9)).toBe("1:35");
    expect(formatTapeTime(3725)).toBe("1:02:05");
    expect(formatTapeTime(-3)).toBe("0:00");
  });
});
