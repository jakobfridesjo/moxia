import { page as screen, userEvent } from "vitest/browser";
import { expect, it } from "vitest";
import { makeStation, makeTape } from "@/shared/test/fixtures.ts";
import { callsTo, mockCommands, sendToChannel } from "@/shared/test/tauri.ts";
import { renderRoute } from "@/app/testing/router.tsx";
import { measure, saveReport, type Measurement } from "@/app/testing/measure.ts";

/** How long each scenario is watched, in seconds. */
const SECONDS = 6;

const stations = [
  makeStation({
    id: "bj",
    name: "中国之声",
    countryCode: "CN",
    state: "北京",
    tags: ["news", "talk"],
  }),
  makeStation({ id: "hk", name: "香港电台", countryCode: "HK", tags: ["music"] }),
  makeStation({ id: "tw", name: "中廣新聞網", countryCode: "TW", tags: ["news"] }),
];
const tapes = Array.from({ length: 8 }, (_, index) =>
  makeTape({
    id: `20261112-0${index}0000-000`,
    station: stations[index % stations.length],
    recordedAt: `2026-11-1${index}T08:00:00Z`,
  })
);

const SAID = "各位听众早上好今天的天气";

/** As a key press reaches the radio, which listens on the window; synchronous, unlike `userEvent`. */
const press = (key: string) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, code: key }));
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("measures the radio as it is used", { timeout: 180_000 }, async () => {
  const calls = mockCommands({
    list_stations: () => stations,
    list_favourites: () => [],
    list_presets: () => [],
    list_tapes: () => tapes,
    list_recent: () => [],
    list_models: () => [{ model: "subtitles", bytes: 268_000_000, downloaded: true }],
    set_subtitles: () => null,
    set_volume: () => null,
    get_favicon: () => null,
    play: () => null,
    play_tape: () => 0,
    stop: () => null,
  });
  const playing = () => callsTo(calls, "play").at(-1)?.onEvent;
  const results: Measurement[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  const every = (ms: number, act: () => void) => timers.push(setInterval(act, ms));

  renderRoute("/");
  await expect.element(screen.getByRole("status")).toBeInTheDocument();
  // The first painting and its weather are made once; what is measured is what follows.
  await settle(3000);
  results.push(await measure("idle, nothing playing", SECONDS));
  // To check that a change made for speed leaves the look as it was.
  await screen.screenshot({ path: "../../../test-results/perf/idle.png" });

  await userEvent.keyboard(" ");
  await expect.poll(() => callsTo(calls, "play").length).toBe(1);
  sendToChannel(playing(), { kind: "playing" });
  // Levels arrive about 20 times a second, as from Rust: speech-like bursts and pauses.
  let tick = 0;
  every(50, () => {
    tick += 1;
    const level = tick % 40 < 28 ? 0.3 + 0.4 * Math.abs(Math.sin(tick / 3)) : 0.02;
    sendToChannel(playing(), { kind: "level", left: level, right: level * 0.9 });
  });
  results.push(await measure("playing, levels at 20 Hz", SECONDS));

  await screen.getByRole("button", { name: "Turn subtitles on" }).click();
  (document.activeElement as HTMLElement).blur();
  every(2500, () =>
    sendToChannel(playing(), {
      kind: "subtitle",
      text: SAID,
      duration: 2.4,
      said: Array.from({ length: SAID.length }, (_, index) => index * 0.2),
      emotion: tick % 3 ? "neutral" : "happy",
      emotionSure: 0.8,
      burst: null,
    })
  );
  results.push(await measure("playing with subtitles", SECONDS));

  every(2500, () => press("ArrowUp"));
  results.push(await measure("changing place every 2.5 s", SECONDS));
  clearInterval(timers.pop());

  every(2000, () => {
    press("ArrowRight");
    setTimeout(() => sendToChannel(playing(), { kind: "playing" }), 100);
  });
  results.push(await measure("changing station every 2 s", SECONDS));
  clearInterval(timers.pop());

  await screen.getByRole("button", { name: "Recordings" }).click();
  await expect.element(screen.getByRole("dialog")).toBeInTheDocument();
  results.push(await measure("mountain path open, playing", SECONDS));

  timers.forEach(clearInterval);
  await saveReport(results);
});
