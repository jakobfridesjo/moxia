import { describe, expect, it } from "vitest";
import {
  PATH_LENGTH,
  SLOTS_TO_PEAK,
  TRAVELLER,
  CANE,
  travellerPart,
  clampToPath,
  pathData,
  pointAt,
  slotAt,
} from "./scroll-path.ts";

describe("the path up the scroll", () => {
  it("starts at the traveller's feet on the bridge and climbs to the peak", () => {
    const start = pointAt(0);
    expect(start.x).toBeCloseTo(TRAVELLER.feet[0]);
    expect(start.y).toBeCloseTo(TRAVELLER.feet[1]);
    expect(pointAt(PATH_LENGTH).y).toBeLessThan(100);
  });

  it("heads along a unit vector", () => {
    const { dx, dy } = pointAt(PATH_LENGTH / 3);
    expect(Math.hypot(dx, dy)).toBeCloseTo(1);
  });

  it("stays on the path when asked past either end", () => {
    expect(clampToPath(-10)).toBe(0);
    expect(clampToPath(PATH_LENGTH + 10)).toBe(PATH_LENGTH);
  });
});

describe("slotAt", () => {
  it("starts at the bridge and keeps an even pace up, so a few recordings stay low", () => {
    expect(slotAt(0, 3)).toBeLessThan(slotAt(1, 3));
    expect(slotAt(1, 3) - slotAt(0, 3)).toBeCloseTo(slotAt(2, 3) - slotAt(1, 3));
    expect(slotAt(2, 3)).toBeLessThan(PATH_LENGTH * 0.2);
  });

  it("reaches the peak with a full path and closes up past it", () => {
    const last = slotAt(SLOTS_TO_PEAK - 1, SLOTS_TO_PEAK);
    expect(last).toBeLessThan(PATH_LENGTH);
    expect(last).toBeGreaterThan(PATH_LENGTH * 0.9);
    expect(slotAt(59, 60)).toBeCloseTo(last);
  });
});

describe("travellerPart", () => {
  it("tells the dark cane from the old man and the bridge he stands on", () => {
    expect(travellerPart(CANE.tip[0], CANE.tip[1] - 2, 200)).toBe("cane");
    expect(travellerPart(CANE.hand[0], CANE.hand[1], 200)).toBe("cane");
    expect(travellerPart(210, 3310, 10)).toBe("body");
    expect(travellerPart(250, 3270, 200)).toBe("body");
    expect(travellerPart(250, TRAVELLER.deck + 4, 200)).toBeNull();
    expect(travellerPart(250, 3270, 0)).toBeNull();
  });
});

describe("pathData", () => {
  it("draws a stretch of the path, scaled", () => {
    const data = pathData(0, 40, 0.5);
    expect(data.startsWith(`M${(TRAVELLER.feet[0] * 0.5).toFixed(1)}`)).toBe(true);
    expect(data.split("L").length).toBeGreaterThan(2);
  });
});
