import { createEffect, createSignal, type Accessor } from "solid-js";

/** `performance.now()`, refreshed every `interval` milliseconds while `running`. */
export function useNow(interval: number, running: Accessor<boolean> = () => true) {
  const [now, setNow] = createSignal(performance.now());
  createEffect(running, (on) => {
    if (!on) return;
    const timer = setInterval(() => setNow(performance.now()), interval);
    return () => clearInterval(timer);
  });
  return now;
}
