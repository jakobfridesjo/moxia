import { describe, expect, it, vi } from "vitest";
import { renderPage } from "@/shared/test/render.tsx";
import { callsTo, mockCommands, sendToChannel } from "@/shared/test/tauri.ts";
import { useMediaControls } from "@/pages/radio/model/use-media-controls.ts";

function Radio(props: { playing: boolean; toggle: () => void; seek: (step: -1 | 1) => void }) {
  useMediaControls({ title: "中国之声", artist: "新闻", playing: props.playing }, props);
  return null;
}

describe("useMediaControls", () => {
  it("shows what plays and does what the media buttons ask", async () => {
    const calls = mockCommands({ watch_media: () => null, show_media: () => null });
    const toggle = vi.fn();
    const seek = vi.fn();
    await renderPage(<Radio playing toggle={toggle} seek={seek} />);

    await expect
      .poll(() => callsTo(calls, "show_media"))
      .toEqual([{ now: { title: "中国之声", artist: "新闻", playing: true } }]);
    const [{ onAction }] = callsTo(calls, "watch_media");
    sendToChannel(onAction, "next", "previous", "play", "pause");

    await expect.poll(() => seek.mock.calls).toEqual([[1], [-1]]);
    // Playing already, so only the pause stops it.
    await expect.poll(() => toggle.mock.calls.length).toBe(1);
  });
});
