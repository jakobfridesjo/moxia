import { useEffect, useState } from "react";

/** `performance.now()`, refreshed every `interval` milliseconds while `running`. */
export function useNow(interval: number, running = true) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(performance.now()), interval);
    return () => clearInterval(timer);
  }, [interval, running]);
  return now;
}
