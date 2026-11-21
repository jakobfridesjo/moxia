import { createSignal, onCleanup, type Accessor } from "solid-js";

const isVisible = () => document.visibilityState === "visible";

/** Whether the window shows, so animations can rest while it is minimized or in the background. */
export function usePageVisible(): Accessor<boolean> {
  const [visible, setVisible] = createSignal(isVisible());
  const onChange = () => setVisible(isVisible());
  document.addEventListener("visibilitychange", onChange);
  onCleanup(() => document.removeEventListener("visibilitychange", onChange));
  return visible;
}
