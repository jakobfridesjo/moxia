import { useMessages } from "@/shared/i18n/messages.ts";
import { useNow } from "@/shared/lib/use-now.ts";
import type { RoomLine } from "@/pages/radio/model/room-store.ts";

/** How many of the latest messages show over the painting, and for how long, in ms. */
const SHOWN = 3;
const SHOWN_MS = 45_000;
/** Older lines fade, the oldest most. */
const FADES = [0.5, 0.78, 1];

/** The latest messages, written over the painting above the presets, fading as they age. */
export function ChatDrift({ lines }: { lines: RoomLine[] }) {
  const t = useMessages().together;
  const said = lines.filter((line) => line.kind === "said").slice(-SHOWN);
  const now = performance.timeOrigin + useNow(5000, said.length > 0);
  const shown = said.filter((line) => now - line.at < SHOWN_MS);
  if (shown.length === 0) return null;
  return (
    <ol
      aria-hidden
      className="pointer-events-none absolute bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+10.5rem)] left-[max(1.1rem,env(safe-area-inset-left))] flex max-w-[75%] flex-col gap-2.5 [text-shadow:0_0_1px_var(--paper),0_0_2px_var(--paper),0_0_3px_var(--paper),0_0_6px_var(--paper),0_0_12px_var(--paper),0_0_20px_var(--paper)]"
    >
      {shown.map((line, index) => (
        <li
          key={line.id}
          style={{ opacity: FADES[FADES.length - shown.length + index] }}
          className="flex items-baseline gap-2 transition-opacity duration-700"
        >
          <span className="shrink-0 text-sm font-bold text-seal">{line.name ?? t.you}</span>
          <span className="font-brush text-lg leading-snug font-bold break-words">
            {line.kind === "said" && line.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
