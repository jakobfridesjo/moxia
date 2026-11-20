import { useRef, useState } from "react";

/** How long a seal is held before it counts as held rather than pressed. */
const HOLD_MS = 650;
/** How far a pointer moves before a press becomes a drag, in px. */
export const MOVE_PX = 10;

/**
 * Press and hold for a button: `onPress` on a short press, `onHold` once it has
 * been held for `HOLD_MS`. Moving away by `MOVE_PX` makes it a drag, which is neither.
 * Spread the result on the button; `holding` lights it meanwhile.
 */
export function useHold(onPress: (event: React.MouseEvent) => void, onHold: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const skipClick = useRef(false);
  const [holding, setHolding] = useState(false);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
    setHolding(false);
  };
  return {
    holding,
    handlers: {
      onPointerDown: (event: React.PointerEvent) => {
        skipClick.current = false;
        start.current = { x: event.clientX, y: event.clientY };
        setHolding(true);
        timer.current = setTimeout(() => {
          skipClick.current = true;
          start.current = null;
          setHolding(false);
          onHold();
        }, HOLD_MS);
      },
      onPointerMove: (event: React.PointerEvent) => {
        const from = start.current;
        if (!from || Math.hypot(event.clientX - from.x, event.clientY - from.y) < MOVE_PX) return;
        skipClick.current = true;
        cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
      onClick: (event: React.MouseEvent) => {
        if (skipClick.current) {
          skipClick.current = false;
          return;
        }
        onPress(event);
      },
    },
  };
}
