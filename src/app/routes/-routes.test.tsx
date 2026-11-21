import { page as screen, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { makeStation, makeTape } from "@/shared/test/fixtures.ts";
import { callsTo, mockCommands, sendToChannel } from "@/shared/test/tauri.ts";
import type { Station } from "@/shared/api/commands.ts";
import { captionsAtom } from "@/features/player/model/subtitles.ts";
import { themeAtom } from "@/shared/config/preferences.ts";
import { renderRoute } from "@/app/testing/router.tsx";

const beijing = makeStation({ id: "bj", name: "中国之声", countryCode: "CN", state: "北京" });
const hongKong = makeStation({ id: "hk", name: "香港电台", countryCode: "HK" });

/** The radio's commands, with nothing stored yet; `overrides` replace any of them. */
function radioCommands(overrides: Parameters<typeof mockCommands>[0] = {}) {
  return mockCommands({
    list_stations: () => [hongKong, beijing],
    list_favourites: () => [],
    list_presets: () => [],
    list_tapes: () => [],
    list_recent: () => [],
    list_models: () => [{ model: "subtitles", bytes: 268_000_000, downloaded: false }],
    play: () => null,
    stop: () => null,
    ...overrides,
  });
}

const inscription = () => screen.getByRole("status");

/** Presses a button down and leaves it held. */
const hold = (button: Element) =>
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));

describe("subtitles", () => {
  it("sends the listener to settings for the speech models before they are downloaded", async () => {
    radioCommands();
    const { router } = renderRoute("/");

    await screen.getByRole("button", { name: "Turn subtitles on" }).click();

    await expect.poll(() => router.state.location.pathname).toBe("/settings");
  });

  it("turns subtitles on and off, and keeps what the station says", async () => {
    const calls = radioCommands({
      list_models: () => [{ model: "subtitles", bytes: 268_000_000, downloaded: true }],
      set_subtitles: () => null,
    });
    renderRoute("/");

    await screen.getByRole("button", { name: "Turn subtitles on" }).click();
    await expect
      .poll(() => callsTo(calls, "set_subtitles"))
      .toEqual([{ enabled: true, script: "simplified", reading: "none" }]);
    const seal = screen.getByRole("button", { name: "Turn subtitles off" });
    await expect.element(seal).toHaveAttribute("aria-pressed", "true");

    // Space on the focused seal would press it again, not play.
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard(" ");
    await expect.poll(() => callsTo(calls, "play").length).toBe(1);
    sendToChannel(
      callsTo(calls, "play")[0].onEvent,
      { kind: "playing" },
      {
        kind: "subtitle",
        text: "各位听众早上好",
        ahead: 0,
        duration: 2,
        said: [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8],
        readings: [],
        emotion: "happy",
        emotionSure: 0.8,
        burst: null,
      }
    );
    await expect
      .poll(() => captionsAtom.get().map((caption) => caption.text))
      .toEqual(["各位听众早上好"]);

    await seal.click();
    await expect
      .poll(() => callsTo(calls, "set_subtitles"))
      .toEqual([
        { enabled: true, script: "simplified", reading: "none" },
        { enabled: false, script: "simplified", reading: "none" },
      ]);
    expect(captionsAtom.get()).toEqual([]);
  });
});

describe("the radio", () => {
  it("opens on the painting, named after the first station on the dial", async () => {
    radioCommands();
    const { router } = renderRoute("/");

    await expect.element(screen.getByRole("main", { name: "Moxia radio" })).toBeVisible();
    await expect.poll(() => inscription().element().textContent).toContain("中国之声");
    expect(router.state.location.pathname).toBe("/");
  });

  it("plays and stops with the space bar, and steps through the stations with the arrows", async () => {
    const calls = radioCommands();
    renderRoute("/");
    await expect.poll(() => inscription().element().textContent).toContain("中国之声");

    await userEvent.keyboard(" ");
    await expect
      .poll(() => callsTo(calls, "play").map((args) => (args.station as Station).id))
      .toEqual(["bj"]);

    await userEvent.keyboard("{ArrowRight}");
    await expect
      .poll(() => callsTo(calls, "play").map((args) => (args.station as Station).id))
      .toEqual(["bj", "hk"]);
    await expect.poll(() => inscription().element().textContent).toContain("香港电台");

    await userEvent.keyboard(" ");
    await expect.poll(() => callsTo(calls, "stop").length).toBe(1);
  });

  it("plays a preset from its seal", async () => {
    const calls = radioCommands({ list_presets: () => [{ key: 2, station: hongKong }] });
    renderRoute("/");

    await screen.getByRole("button", { name: "Preset 2: 香港电台" }).click();
    await expect
      .poll(() => callsTo(calls, "play").map((args) => (args.station as Station).id))
      .toEqual(["hk"]);
  });

  it("records the station on air and adds it at the peak", async () => {
    const tape = makeTape({ id: "t1", station: beijing, duration: 65 });
    const calls = radioCommands({
      start_recording: () => null,
      stop_recording: () => tape,
    });
    renderRoute("/");
    await userEvent.keyboard(" ");
    await expect.poll(() => callsTo(calls, "play").length).toBe(1);
    sendToChannel(callsTo(calls, "play")[0].onEvent, { kind: "playing" });

    await screen.getByRole("button", { name: "Record the station on air" }).click();
    await expect.poll(() => callsTo(calls, "start_recording").length).toBe(1);
    await screen.getByRole("button", { name: "Stop recording" }).click();
    await expect.poll(() => callsTo(calls, "stop_recording").length).toBe(1);
    await expect
      .element(screen.getByText("A new recording at the peak · 1:05"))
      .toBeInTheDocument();
  });

  it("plays a recording on the mountain path, and the radio again once the path is left", async () => {
    const tape = makeTape({ id: "t1", station: hongKong, recordedAt: "2026-11-08T07:30:00Z" });
    const calls = radioCommands({ list_tapes: () => [tape], play_tape: () => 0 });
    renderRoute("/");

    await screen.getByRole("button", { name: "Recordings" }).click();
    await screen.getByRole("button", { name: /^Play 香港电台, recorded/ }).click();
    await expect.poll(() => callsTo(calls, "play_tape").map((args) => args.id)).toEqual(["t1"]);
    await expect
      .element(screen.getByRole("dialog", { name: "Recordings along a mountain path" }))
      .toBeVisible();

    await screen.getByRole("button", { name: "Roll up the scroll" }).click();
    await expect
      .poll(() => callsTo(calls, "play").map((args) => (args.station as Station).id))
      .toEqual(["bj"]);
    await expect.poll(() => inscription().element().textContent).toContain("中国之声");
  });

  it("opens the mountain path on its own screen and leaves it", async () => {
    const tapes = ["a", "b", "c"].map((id) => makeTape({ id, station: hongKong }));
    radioCommands({ list_tapes: () => tapes });
    renderRoute("/");

    await screen.getByRole("button", { name: "Recordings" }).click();
    const path = screen.getByRole("dialog", { name: "Recordings along a mountain path" });
    await expect.element(path).toBeVisible();
    await expect
      .poll(() => path.getByRole("button", { name: /^Play 香港电台/ }).all().length)
      .toBe(3);

    await screen.getByRole("button", { name: "Roll up the scroll" }).click();
    await expect.element(path).not.toBeInTheDocument();
  });

  it(
    "has the old man break a held recording with his cane, and deletes it once the scroll is rolled up",
    { timeout: 10_000 },
    async () => {
      // By day; at night he burns it instead.
      themeAtom.set("day");
      const tape = makeTape({ id: "t1", station: hongKong });
      const calls = radioCommands({ list_tapes: () => [tape], delete_tape: () => null });
      renderRoute("/");

      await screen.getByRole("button", { name: "Recordings" }).click();
      hold(screen.getByRole("button", { name: /^Play 香港电台/ }).element());
      await expect
        .element(screen.getByRole("button", { name: "Mend 香港电台" }), { timeout: 5000 })
        .toBeVisible();
      expect(callsTo(calls, "delete_tape")).toEqual([]);

      await screen.getByRole("button", { name: "Roll up the scroll" }).click();
      await expect.poll(() => callsTo(calls, "delete_tape").map((args) => args.id)).toEqual(["t1"]);
    }
  );

  it("deletes a held recording even when the scroll is rolled up before the cane lands", async () => {
    const tape = makeTape({ id: "t1", station: hongKong });
    const calls = radioCommands({ list_tapes: () => [tape], delete_tape: () => null });
    renderRoute("/");

    await screen.getByRole("button", { name: "Recordings" }).click();
    hold(screen.getByRole("button", { name: /^Play 香港电台/ }).element());
    // Held long enough to count, while the old man is still on his way.
    await new Promise((resolve) => setTimeout(resolve, 900));
    await screen.getByRole("button", { name: "Roll up the scroll" }).click();
    await expect.poll(() => callsTo(calls, "delete_tape").map((args) => args.id)).toEqual(["t1"]);
  });

  it(
    "mends a broken recording when its pieces are tapped, keeping it",
    { timeout: 10_000 },
    async () => {
      themeAtom.set("day");
      const tape = makeTape({ id: "t1", station: hongKong });
      const calls = radioCommands({ list_tapes: () => [tape], delete_tape: () => null });
      renderRoute("/");

      await screen.getByRole("button", { name: "Recordings" }).click();
      hold(screen.getByRole("button", { name: /^Play 香港电台/ }).element());
      const pieces = screen.getByRole("button", { name: "Mend 香港电台" });
      await expect.element(pieces, { timeout: 5000 }).toBeVisible();
      (pieces.element() as HTMLElement).click();
      await expect.element(pieces).not.toBeInTheDocument();
      await expect.element(screen.getByRole("button", { name: /^Play 香港电台/ })).toBeVisible();

      await screen.getByRole("button", { name: "Roll up the scroll" }).click();
      expect(callsTo(calls, "delete_tape")).toEqual([]);
    }
  );

  it(
    "at night has the old man set a held recording alight, and brings it back from the ashes when tapped",
    { timeout: 10_000 },
    async () => {
      themeAtom.set("night");
      const tape = makeTape({ id: "t1", station: hongKong });
      const calls = radioCommands({ list_tapes: () => [tape], delete_tape: () => null });
      renderRoute("/");

      await screen.getByRole("button", { name: "Recordings" }).click();
      hold(screen.getByRole("button", { name: /^Play 香港电台/ }).element());
      const ashes = screen.getByRole("button", { name: "Bring 香港电台 back from the ashes" });
      await expect.element(ashes, { timeout: 5000 }).toBeVisible();
      (ashes.element() as HTMLElement).click();
      await expect.element(ashes).not.toBeInTheDocument();
      await expect.element(screen.getByRole("button", { name: /^Play 香港电台/ })).toBeVisible();

      await screen.getByRole("button", { name: "Roll up the scroll" }).click();
      expect(callsTo(calls, "delete_tape")).toEqual([]);
    }
  );

  it("climbs the path when dragged over a recording, without playing it", async () => {
    const tapes = Array.from({ length: 20 }, (_, k) =>
      makeTape({ id: `t${k}`, station: hongKong })
    );
    const calls = radioCommands({ list_tapes: () => tapes, play_tape: () => 0 });
    renderRoute("/");

    await screen.getByRole("button", { name: "Recordings" }).click();
    const slip = screen.getByRole("button", { name: /^Play 香港电台/ }).first();
    const { x, y } = slip.element().getBoundingClientRect();
    const pointer = (type: string, at: number) =>
      slip.element().dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          clientX: x + 10,
          clientY: at,
        })
      );
    pointer("pointerdown", y + 10);
    pointer("pointermove", y + 30);
    pointer("pointermove", y + 400);
    pointer("pointerup", y + 400);

    await expect.poll(() => slip.element().getBoundingClientRect().y).toBeGreaterThan(y + 100);
    expect(callsTo(calls, "play_tape")).toEqual([]);
  });

  it("holds the painting still under a finger, so a tap lands on the slip it started on", async () => {
    const tapes = Array.from({ length: 20 }, (_, k) =>
      makeTape({ id: `t${k}`, station: hongKong })
    );
    radioCommands({ list_tapes: () => tapes });
    renderRoute("/");

    await screen.getByRole("button", { name: "Recordings" }).click();
    const slip = screen
      .getByRole("button", { name: /^Play 香港电台/ })
      .first()
      .element();
    slip.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 600 }));
    slip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
    const before = slip.getBoundingClientRect().top;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(slip.getBoundingClientRect().top).toBeCloseTo(before, 0);
  });

  it("opens the settings from its seal and comes back", async () => {
    radioCommands();
    const { router } = renderRoute("/");

    await screen.getByRole("button", { name: "Settings" }).click();
    await expect.poll(() => router.state.location.pathname).toBe("/settings");
    await screen.getByRole("button", { name: "Back to the radio" }).click();
    await expect.poll(() => router.state.location.pathname).toBe("/");
  });

  it("shows the not-found page for an unknown path", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCommands({});
    renderRoute("/does-not-exist");
    await expect.element(screen.getByText("Page not found")).toBeVisible();
  });
});

describe("listening together", () => {
  const invite = {
    text: "moxia:abc",
    qr: { width: 21, modules: "10".repeat(220) + "1" },
  };

  const playedIds = (calls: ReturnType<typeof radioCommands>) =>
    callsTo(calls, "play").map((args) => (args.station as Station).id);

  it("opens a room, follows what a friend tunes to and passes on what this listener tunes to", async () => {
    const calls = radioCommands({
      open_room: () => invite,
      tune_room: () => null,
      leave_room: () => null,
    });
    renderRoute("/");

    await screen.getByRole("button", { name: "Listen together" }).click();
    await screen.getByRole("textbox", { name: "Your name" }).fill("Lin");
    await screen.getByRole("button", { name: "Open a room" }).click();
    await expect.poll(() => callsTo(calls, "open_room").map((args) => args.name)).toEqual(["Lin"]);
    await expect
      .element(screen.getByRole("textbox", { name: "Invite", exact: true }))
      .toHaveValue("moxia:abc");
    await expect
      .element(screen.getByRole("img", { name: "The invite as a QR code" }))
      .toBeVisible();

    const room = callsTo(calls, "open_room")[0].onEvent;
    sendToChannel(room, { kind: "joined", name: "Mei" }, { kind: "listeners", count: 2 });
    await expect.element(screen.getByText("2 listening")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("button", { name: "Listening together, 2 listeners" }))
      .toHaveAttribute("aria-pressed", "true");

    sendToChannel(room, { kind: "tuned", name: "Mei", station: hongKong });
    await expect.poll(() => playedIds(calls)).toEqual(["hk"]);
    await expect.element(screen.getByText("Mei tuned to 香港电台")).toBeVisible();
    expect(callsTo(calls, "tune_room")).toEqual([]);

    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => playedIds(calls)).toEqual(["hk", "bj"]);
    await expect
      .poll(() => callsTo(calls, "tune_room").map((args) => (args.station as Station).id))
      .toEqual(["bj"]);
  });

  it("joins with a pasted invite and chats with the room", async () => {
    const calls = radioCommands({
      join_room: () => invite,
      say_to_room: () => null,
      leave_room: () => null,
    });
    renderRoute("/");

    await screen.getByRole("button", { name: "Listen together" }).click();
    await screen.getByRole("textbox", { name: "Your name" }).fill("Mei");
    await screen.getByRole("tab", { name: "Join" }).click();
    await screen.getByRole("textbox", { name: "Paste an invite" }).fill(" moxia:abc ");
    await screen.getByRole("button", { name: "Join", exact: true }).click();
    await expect
      .poll(() => callsTo(calls, "join_room"))
      .toMatchObject([{ invite: " moxia:abc ", name: "Mei" }]);
    await screen.getByRole("button", { name: "Close" }).click();

    await screen.getByRole("button", { name: "Chat with the room" }).click();
    await userEvent.keyboard("你好{Enter}");
    await expect.poll(() => callsTo(calls, "say_to_room")).toEqual([{ text: "你好" }]);
    const messages = screen.getByRole("list", { name: "Messages" });
    await expect.element(messages.getByText("你好")).toBeVisible();

    sendToChannel(callsTo(calls, "join_room")[0].onEvent, {
      kind: "said",
      name: "Lin",
      text: "欢迎",
    });
    await expect.element(messages.getByText("欢迎")).toBeVisible();

    await screen.getByRole("button", { name: "Leave" }).click();
    await expect.poll(() => callsTo(calls, "leave_room").length).toBe(1);
    await expect
      .element(screen.getByRole("button", { name: "Listen together" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("says why a room could not be joined", async () => {
    radioCommands({
      join_room: () => {
        throw new Error("No one answered the invite. Ask for a new one if they have left.");
      },
    });
    renderRoute("/");

    await screen.getByRole("button", { name: "Listen together" }).click();
    await screen.getByRole("textbox", { name: "Your name" }).fill("Mei");
    await screen.getByRole("tab", { name: "Join" }).click();
    await screen.getByRole("textbox", { name: "Paste an invite" }).fill("moxia:abc");
    await screen.getByRole("button", { name: "Join", exact: true }).click();
    await expect
      .element(screen.getByText("No one answered the invite. Ask for a new one if they have left."))
      .toBeVisible();
  });
});
