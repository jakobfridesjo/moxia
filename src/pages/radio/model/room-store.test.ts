import { describe, expect, it } from "vitest";
import { makeStation } from "@/shared/test/fixtures.ts";
import { applyRoomEvent, type RoomState } from "@/pages/radio/model/room-store.ts";

const joining: RoomState = {
  status: "joining",
  invite: null,
  count: 1,
  lines: [],
  onAir: null,
  following: false,
  follow: null,
  error: null,
};

describe("applyRoomEvent", () => {
  it("follows each station someone tunes to, counting them so the radio plays each once", () => {
    const beijing = makeStation({ id: "bj", name: "中国之声" });
    const hongKong = makeStation({ id: "hk", name: "香港电台" });

    const first = applyRoomEvent(joining, { kind: "tuned", name: "Lin", station: beijing }, 1);
    const second = applyRoomEvent(first, { kind: "tuned", name: "Mei", station: hongKong }, 2);

    expect(first.follow).toEqual({ station: beijing, name: "Lin", seq: 1 });
    expect(second).toMatchObject({
      onAir: hongKong,
      follow: { station: hongKong, name: "Mei", seq: 2 },
    });
    expect(second.lines).toMatchObject([
      { kind: "tuned", name: "Lin", station: "中国之声", at: 1 },
      { kind: "tuned", name: "Mei", station: "香港电台", at: 2 },
    ]);
  });

  it("starts passing on this listener's stations once it is counted in", () => {
    const counted = applyRoomEvent(joining, { kind: "listeners", count: 2 });
    expect(counted).toMatchObject({ count: 2, following: true });
  });

  it("keeps who came, went and what they said, in order", () => {
    const events = [
      { kind: "joined", name: "Mei" },
      { kind: "said", name: "Mei", text: "你好" },
      { kind: "left", name: "Mei" },
    ] as const;
    const state = events.reduce((room, event) => applyRoomEvent(room, event), joining);
    expect(state.lines.map((line) => line.kind)).toEqual(["joined", "said", "left"]);
    expect(new Set(state.lines.map((line) => line.id)).size).toBe(3);
  });

  it("leaves the room when it closes, keeping what was said", () => {
    const talked = applyRoomEvent(
      { ...joining, status: "in", count: 2 },
      { kind: "said", name: "Mei", text: "再见" }
    );
    const closed = applyRoomEvent(talked, { kind: "closed" });
    expect(closed).toMatchObject({ status: "out", count: 1, error: "The room closed" });
    expect(closed.lines).toEqual(talked.lines);
  });
});
