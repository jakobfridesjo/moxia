import { page as screen } from "vitest/browser";
import { describe, expect, it } from "vitest";
import type { ModelStatus } from "@/shared/api/commands.ts";
import { subtitleScriptAtom, subtitlesAtom } from "@/shared/config/preferences.ts";
import { renderPage } from "@/shared/test/render.tsx";
import { callsTo, mockCommands, sendToChannel } from "@/shared/test/tauri.ts";
import { SubtitlesCard } from "@/pages/settings/ui/SubtitlesCard.tsx";

const BYTES = 268_368_686;

const status = (downloaded: boolean): ModelStatus => ({
  model: "subtitles",
  bytes: BYTES,
  downloaded,
});

describe("SubtitlesCard", () => {
  it("keeps subtitles off until the speech models are downloaded", async () => {
    mockCommands({ list_models: () => [status(false)] });
    await renderPage(<SubtitlesCard />);

    await expect
      .element(screen.getByText("Download the speech models to turn subtitles on."))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "On" })).toBeDisabled();
    await expect.element(screen.getByText(/FireRedVAD · 268 MB/)).toBeVisible();
  });

  it("downloads the speech models, showing how far it has got, then turns subtitles on", async () => {
    let downloaded = false;
    let finish: (finished: boolean) => void = () => {};
    const calls = mockCommands({
      list_models: () => [status(downloaded)],
      download_model: (args) => {
        sendToChannel(args.onProgress, { downloaded: 100_000_000, total: BYTES });
        return new Promise((resolve) => {
          finish = (finished) => {
            downloaded = finished;
            resolve(finished);
          };
        });
      },
      set_subtitles: () => null,
    });
    await renderPage(<SubtitlesCard />);

    await screen.getByRole("button", { name: "Download" }).click();
    const bar = screen.getByRole("progressbar", { name: "Speech models" });
    await expect.element(bar).toHaveAttribute("aria-valuenow", "37");
    await expect.element(screen.getByText("100 MB of 268 MB")).toBeVisible();

    finish(true);
    await expect.element(screen.getByText("On this device")).toBeVisible();
    await expect
      .poll(() => callsTo(calls, "set_subtitles"))
      .toEqual([{ enabled: true, script: "simplified" }]);
    await expect
      .element(screen.getByRole("button", { name: "On" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(subtitlesAtom.get()).toBe(true);
  });

  it("writes subtitles in Hong Kong's traditional forms, telling Rust at once while they are on", async () => {
    subtitlesAtom.set(true);
    const calls = mockCommands({
      list_models: () => [status(true)],
      set_subtitles: () => null,
    });
    await renderPage(<SubtitlesCard />);

    const hongKong = screen
      .getByRole("group", { name: "Characters" })
      .getByRole("button", { name: "繁體（香港）" });
    await hongKong.click();

    await expect.element(hongKong).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => callsTo(calls, "set_subtitles"))
      .toEqual([{ enabled: true, script: "hongKong" }]);
    expect(subtitleScriptAtom.get()).toBe("hongKong");
    expect(localStorage.getItem("subtitleScript")).toBe("hongKong");
  });

  it("says where a download stopped, and tries again from there", async () => {
    mockCommands({
      list_models: () => [status(false)],
      download_model: (args) => {
        sendToChannel(args.onProgress, { downloaded: 50_000_000, total: BYTES });
        throw new Error("Connection reset");
      },
    });
    await renderPage(<SubtitlesCard />);

    await screen.getByRole("button", { name: "Download" }).click();

    await expect
      .poll(() => screen.getByRole("alert").element().textContent)
      .toContain("The download stopped at 50");
    await expect.element(screen.getByText("Connection reset")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("deletes the speech models once asked twice, turning subtitles off", async () => {
    subtitlesAtom.set(true);
    let downloaded = true;
    const calls = mockCommands({
      list_models: () => [status(downloaded)],
      delete_model: () => {
        downloaded = false;
        return null;
      },
    });
    await renderPage(<SubtitlesCard />);

    await screen.getByRole("button", { name: "Delete", exact: true }).click();
    await screen.getByRole("button", { name: "Delete 268 MB" }).click();

    await expect.poll(() => callsTo(calls, "delete_model")).toEqual([{ model: "subtitles" }]);
    await expect.element(screen.getByRole("button", { name: "Download" })).toBeVisible();
    expect(subtitlesAtom.get()).toBe(false);
  });
});
