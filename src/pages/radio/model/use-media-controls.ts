import { useEffect, useRef } from "react";
import { media, type MediaAction, type MediaNow } from "@/shared/api/commands.ts";

interface Controls {
  /** Stops what plays, or plays again what was stopped. */
  toggle: () => void;
  seek: (step: -1 | 1) => void;
}

/**
 * Shows `now` on the system's media controls, and does what their buttons and the media keys
 * ask: play and pause toggle (a radio stops rather than pausing), next and previous change
 * station or recording.
 */
export function useMediaControls(now: MediaNow, controls: Controls & { playing: boolean }) {
  // The buttons are watched once; they reach whatever the radio can do at the time.
  const latest = useRef(controls);
  useEffect(() => {
    latest.current = controls;
  });
  useEffect(() => {
    const act = (action: MediaAction) => {
      const { toggle, seek, playing } = latest.current;
      if (action === "next") seek(1);
      else if (action === "previous") seek(-1);
      else if (action === "toggle" || (action === "play") !== playing) toggle();
    };
    media.watch(act).catch(() => undefined);
  }, []);
  const { title, artist, playing } = now;
  useEffect(() => {
    media.show({ title, artist, playing }).catch(() => undefined);
  }, [title, artist, playing]);
}
