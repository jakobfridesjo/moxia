import { describe, expect, it } from "vitest";
import { makeStation, makeTape } from "@/shared/test/fixtures.ts";
import type { PlayerState } from "@/features/player/model/player-store.ts";
import { noteAt, radioMode, stepThrough } from "@/pages/radio/model/radio-state.ts";

const player = (overrides: Partial<PlayerState>): PlayerState => ({
  station: null,
  source: "station",
  status: "idle",
  nowPlaying: null,
  error: null,
  deck: null,
  recording: null,
  ...overrides,
});

describe("radioMode", () => {
  it("is idle before anything played", () => {
    expect(radioMode(player({}))).toBe("idle");
  });

  it("is live while a station connects or plays, and stopped after", () => {
    const station = makeStation();
    expect(radioMode(player({ station, status: "connecting" }))).toBe("live");
    expect(radioMode(player({ station, status: "playing" }))).toBe("live");
    expect(radioMode(player({ station, status: "stopped" }))).toBe("stopped");
    expect(radioMode(player({ station, status: "error" }))).toBe("stopped");
  });

  it("plays back or pauses a recording", () => {
    const deck = { tape: makeTape(), from: 0, speed: 0, since: null };
    expect(radioMode(player({ source: "tape", deck, status: "playing" }))).toBe("playback");
    expect(radioMode(player({ source: "tape", deck, status: "stopped" }))).toBe("paused");
  });
});

describe("stepThrough", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("steps on and wraps around the ends", () => {
    expect(stepThrough(list, list[1], 1)?.id).toBe("c");
    expect(stepThrough(list, list[2], 1)?.id).toBe("a");
    expect(stepThrough(list, list[0], -1)?.id).toBe("c");
  });

  it("starts at an end when nothing is current", () => {
    expect(stepThrough(list, null, 1)?.id).toBe("a");
    expect(stepThrough(list, { id: "gone" }, -1)?.id).toBe("c");
    expect(stepThrough([], null, 1)).toBeNull();
  });
});

describe("noteAt", () => {
  it("finds the last note written before a time", () => {
    const notes = [
      { at: 0, title: "新闻" },
      { at: 60, title: "天气" },
    ];
    expect(noteAt(notes, 30)?.title).toBe("新闻");
    expect(noteAt(notes, 90)?.title).toBe("天气");
    expect(noteAt([], 10)).toBeNull();
  });
});
