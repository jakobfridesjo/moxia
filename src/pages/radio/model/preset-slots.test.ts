import { describe, expect, it } from "vitest";
import { makeStation } from "@/shared/test/fixtures.ts";
import { presetSlots } from "@/pages/radio/model/preset-slots.ts";

const a = makeStation({ id: "a" });
const b = makeStation({ id: "b" });
const c = makeStation({ id: "c" });

describe("presetSlots", () => {
  it("fills the keys nothing is stored on with the other favourites", () => {
    const slots = presetSlots([{ key: 2, station: a }], [c, a, b]);
    expect(slots.map((slot) => slot.station?.id ?? null)).toEqual([
      "c",
      "a",
      "b",
      null,
      null,
      null,
    ]);
  });
});
