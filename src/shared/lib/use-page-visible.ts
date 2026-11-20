import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

const isVisible = () => document.visibilityState === "visible";

/** Whether the window shows, so animations can rest while it is minimized or in the background. */
export function usePageVisible() {
  return useSyncExternalStore(subscribe, isVisible);
}
