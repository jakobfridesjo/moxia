import { page as screen } from "vitest/browser";
import { describe, expect, it } from "vitest";
import type { ModelStatus } from "@/shared/api/commands.ts";
import { renderPage } from "@/shared/test/render.tsx";
import { callsTo, mockCommands, sendToChannel } from "@/shared/test/tauri.ts";
import type { RoomState } from "@/pages/radio/model/room-store.ts";
import { RoomChat } from "@/pages/radio/ui/RoomChat.tsx";

const BYTES = 336_501_087;

const translator = (downloaded: boolean): ModelStatus => ({
  model: "translator",
  bytes: BYTES,
  downloaded,
});

const room: RoomState = {
  status: "in",
  invite: null,
  count: 2,
  lines: [
    { id: 1, at: 0, kind: "said", name: "小明", text: "今天的新闻很有意思" },
    { id: 2, at: 0, kind: "said", name: null, text: "agreed" },
  ],
  onAir: null,
  following: true,
  follow: null,
  error: null,
};

const renderChat = () =>
  renderPage(() => <RoomChat room={room} onSay={() => {}} onLeave={() => {}} onClose={() => {}} />);

describe("RoomChat", () => {
  it("translates a message into English when it is pressed", async () => {
    const calls = mockCommands({
      list_models: () => [translator(true)],
      translate: () => "Today's news is interesting",
    });
    renderChat();

    const translate = screen.getByRole("button", { name: "Translate" });
    await translate.click();

    await expect.element(screen.getByText("Today's news is interesting")).toBeVisible();
    expect(callsTo(calls, "translate")).toEqual([{ text: "今天的新闻很有意思" }]);
    await expect.element(translate).toHaveAttribute("aria-pressed", "true");
  });

  it("downloads the translator first, then translates the message", async () => {
    let downloaded = false;
    let finish: () => void = () => {};
    mockCommands({
      list_models: () => [translator(downloaded)],
      download_model: (args) => {
        sendToChannel(args.onProgress, { downloaded: 100_000_000, total: BYTES });
        return new Promise((resolve) => {
          finish = () => {
            downloaded = true;
            resolve(true);
          };
        });
      },
      translate: () => "Today's news is interesting",
    });
    renderChat();

    await screen.getByRole("button", { name: "Translate" }).click();
    await expect
      .element(screen.getByText(/downloaded once from Hugging Face \(337 MB\)/))
      .toBeVisible();
    await screen.getByRole("button", { name: "Download" }).click();
    await expect
      .element(screen.getByRole("progressbar", { name: "Translator" }))
      .toHaveAttribute("aria-valuenow", "30");

    finish();
    await expect.element(screen.getByText("Today's news is interesting")).toBeVisible();
  });
});
