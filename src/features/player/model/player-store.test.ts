import { describe, expect, it } from "vitest";
import { makeStation, makeTape } from "@/shared/test/fixtures.ts";
import {
  applyPlayerEvent,
  deckPosition,
  isActive,
  type PlayerState,
} from "@/features/player/model/player-store.ts";

const connecting: PlayerState = {
  station: makeStation(),
  source: "station",
  status: "connecting",
  nowPlaying: null,
  error: null,
  deck: null,
  recording: null,
};

describe("applyPlayerEvent", () => {
  it("follows a stream from connecting to playing what is on air", () => {
    const playing = applyPlayerEvent(connecting, { kind: "playing" });
    expect(playing.status).toBe("playing");

    const titled = applyPlayerEvent(playing, { kind: "nowPlaying", title: " 周杰伦 - 晴天 " });
    expect(titled).toMatchObject({ status: "playing", nowPlaying: "周杰伦 - 晴天" });

    const buffering = applyPlayerEvent(titled, { kind: "buffering" });
    expect(buffering).toMatchObject({ status: "buffering", nowPlaying: "周杰伦 - 晴天" });
  });

  it("drops an empty title", () => {
    const titled = applyPlayerEvent(connecting, { kind: "nowPlaying", title: "  " });
    expect(titled.nowPlaying).toBeNull();
  });

  it("keeps the station but forgets the title once it stops or fails", () => {
    const titled = { ...connecting, status: "playing" as const, nowPlaying: "新闻" };

    expect(applyPlayerEvent(titled, { kind: "stopped" })).toMatchObject({
      station: connecting.station,
      status: "stopped",
      nowPlaying: null,
    });
    expect(applyPlayerEvent(titled, { kind: "error", message: "No such host" })).toMatchObject({
      station: connecting.station,
      status: "error",
      nowPlaying: null,
      error: "No such host",
    });
  });

  it("clears an error when the stream connects again", () => {
    const failed = applyPlayerEvent(connecting, { kind: "error", message: "Timed out" });
    expect(applyPlayerEvent(failed, { kind: "connecting" }).error).toBeNull();
  });
});

describe("the tape deck", () => {
  const tape = makeTape({ duration: 100 });
  const loaded: PlayerState = {
    ...connecting,
    source: "tape",
    deck: { tape, from: 10, speed: 0, since: null },
  };

  it("runs the tape while it plays and holds it where it got to when it stops", () => {
    const playing = applyPlayerEvent(loaded, { kind: "playing" }, 1000);
    expect(deckPosition(playing.deck!, 5000)).toBe(14);

    const stopped = applyPlayerEvent(playing, { kind: "stopped" }, 6000);
    expect(stopped.deck).toMatchObject({ from: 15, since: null });
    expect(deckPosition(stopped.deck!, 99_000)).toBe(15);
  });

  it("pauses the tape while buffering", () => {
    const playing = applyPlayerEvent(loaded, { kind: "playing" }, 0);
    const buffering = applyPlayerEvent(playing, { kind: "buffering" }, 2000);
    expect(buffering.deck).toMatchObject({ from: 12, since: null });
  });

  it("leaves the deck alone while a station plays", () => {
    const live = { ...loaded, source: "station" as const };
    expect(applyPlayerEvent(live, { kind: "playing" }, 1000).deck).toBe(live.deck);
  });

  it("notes what is on air while recording, and stops recording when the stream ends", () => {
    const recording = {
      ...connecting,
      status: "playing" as const,
      recording: { since: 1000, notes: [] },
    };
    const noted = applyPlayerEvent(recording, { kind: "nowPlaying", title: "新闻" }, 4000);
    expect(noted.recording?.notes).toEqual([{ at: 3, title: "新闻" }]);
    expect(applyPlayerEvent(noted, { kind: "error", message: "Gone" }).recording).toBeNull();
  });

  it("ignores levels", () => {
    expect(applyPlayerEvent(connecting, { kind: "level", left: 0.5, right: 0.4 })).toBe(connecting);
  });
});

describe("isActive", () => {
  it("holds a stream open while connecting, playing or buffering", () => {
    expect(["connecting", "playing", "buffering"].every((s) => isActive(s as never))).toBe(true);
    expect(["idle", "stopped", "error"].some((s) => isActive(s as never))).toBe(false);
  });
});
