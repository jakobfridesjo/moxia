import { createSignal } from "solid-js";

/** How long a seal is held before it counts as held rather than pressed. */
const HOLD_MS = 650;
/** How far a pointer moves before a press becomes a drag, in px. */
export const MOVE_PX = 10;

/**
 * Press and hold for a button: `onPress` on a short press, `onHold` once it has
 * been held for `HOLD_MS`. Moving away by `MOVE_PX` makes it a drag, which is neither.
 * Spread the handlers on the button; `holding` lights it meanwhile.
 */
export function useHold(onPress: (event: MouseEvent) => void, onHold: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | null = null;
  let skipClick = false;
  const [holding, setHolding] = createSignal(false);
  const cancel = () => {
    clearTimeout(timer);
    start = null;
    setHolding(false);
  };
  return {
    holding,
    handlers: {
      onPointerDown: (event: PointerEvent) => {
        skipClick = false;
        start = { x: event.clientX, y: event.clientY };
        setHolding(true);
        timer = setTimeout(() => {
          skipClick = true;
          start = null;
          setHolding(false);
          onHold();
        }, HOLD_MS);
      },
      onPointerMove: (event: PointerEvent) => {
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < MOVE_PX)
          return;
        skipClick = true;
        cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu: (event: MouseEvent) => event.preventDefault(),
      onClick: (event: MouseEvent) => {
        if (skipClick) {
          skipClick = false;
          return;
        }
        onPress(event);
      },
    },
  };
}
