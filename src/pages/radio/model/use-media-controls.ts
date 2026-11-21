import { createEffect, createMemo, onSettled } from "solid-js";
import { media, type MediaAction, type MediaNow } from "@/shared/api/commands.ts";

interface Controls {
  /** Stops what plays, or plays again what was stopped. */
  toggle: () => void;
  seek: (step: -1 | 1) => void;
  /** Read when a button is pressed, so pass an object whose `playing` follows the radio. */
  playing: boolean;
}

/**
 * Shows `now` on the system's media controls, and does what their buttons and the media keys
 * ask: play and pause toggle (a radio stops rather than pausing), next and previous change
 * station or recording.
 */
export function useMediaControls(now: MediaNow, controls: Controls) {
  // The buttons are watched once; they reach whatever the radio can do at the time.
  onSettled(() => {
    const act = (action: MediaAction) => {
      if (action === "next") controls.seek(1);
      else if (action === "previous") controls.seek(-1);
      else if (action === "toggle" || (action === "play") !== controls.playing) controls.toggle();
    };
    media.watch(act).catch(() => undefined);
  });
  const title = createMemo(() => now.title);
  const artist = createMemo(() => now.artist);
  const playing = createMemo(() => now.playing);
  createEffect(
    () => ({ title: title(), artist: artist(), playing: playing() }),
    (shown) => {
      media.show(shown).catch(() => undefined);
    }
  );
}
