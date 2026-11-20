import { describe, expect, it } from "vitest";

import { captionAnchor, LEAVES } from "@/pages/radio/lib/ink-painter.ts";

describe("captionAnchor", () => {
  it("writes beside the mouth when the leaf says nothing", () => {
    expect(captionAnchor("CN")).toEqual({ at: LEAVES.CN.jaw?.mouth, facing: -1 });
  });

  it("writes beside a point clear of the scholar's robe", () => {
    expect(captionAnchor("MO")).toEqual({ at: [285, 770], facing: 1 });
  });

  it("writes above the crown or on the water when the leaf says so", () => {
    expect(captionAnchor("HK")).toEqual({ above: LEAVES.HK.crown });
    expect(captionAnchor("TW")).toEqual({ water: [230, 1150] });
  });
});
