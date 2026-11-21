import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { renderPage } from "@/shared/test/render.tsx";
import { InkScene } from "@/pages/radio/ui/InkScene.tsx";

const SKY = { weather: null, glow: 0, moon: 1 };

describe("InkScene", () => {
  it("rests while covered and moves again once uncovered", async () => {
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const [covered, setCovered] = createSignal(true);
    renderPage(() => (
      <InkScene
        region="CN"
        station={null}
        listening={false}
        writing={false}
        move={null}
        sky={SKY}
        covered={covered()}
      />
    ));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frames).not.toHaveBeenCalled();

    setCovered(false);
    await expect.poll(() => frames.mock.calls.length).toBeGreaterThan(1);
  });
});
