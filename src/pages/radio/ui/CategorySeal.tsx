import { CATEGORY_FILTERS, type CategoryFilter } from "@/shared/config/preferences.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { playKeyClick } from "@/shared/lib/key-sound.ts";
import { glyphFilter } from "@/pages/radio/lib/seal-ink.ts";
import { Seal } from "@/pages/radio/ui/Seal.tsx";

/** A faint character's key, in px. */
const WIDTH = 36;
const HEIGHT = 40;

const around = (category: CategoryFilter, step: -1 | 1) =>
  CATEGORY_FILTERS[
    (CATEGORY_FILTERS.indexOf(category) + step + CATEGORY_FILTERS.length) % CATEGORY_FILTERS.length
  ];

/**
 * The category seeking keeps to, as one seal: carved while a category is on, printed for every station.
 * A press turns it to the next; the ones either side wait as faint characters, and a press on one
 * goes straight there.
 */
export function CategorySeal({
  category,
  onPick,
}: {
  category: CategoryFilter;
  onPick: (category: CategoryFilter) => void;
}) {
  const m = useMessages();
  const next = around(category, 1);
  return (
    <div role="group" aria-label={m.radio.sealLabels.categories} className="flex items-center">
      <Neighbour category={around(category, -1)} onPick={onPick} />
      <Seal
        pressed={category !== "all"}
        aria-label={m.radio.sealLabels.category(
          m.radio.categories[category],
          m.radio.categories[next]
        )}
        onClick={() => onPick(next)}
      >
        {m.radio.seals.categories[category]}
      </Seal>
      <Neighbour category={next} onPick={onPick} />
    </div>
  );
}

/** A category beside the seal: its character alone, worn like a seal's but with no stone around it. */
function Neighbour({
  category,
  onPick,
}: {
  category: CategoryFilter;
  onPick: (category: CategoryFilter) => void;
}) {
  const m = useMessages();
  const glyph = m.radio.seals.categories[category];
  return (
    <button
      type="button"
      data-control
      aria-label={m.radio.categories[category]}
      className="shrink-0 cursor-pointer rounded-[3px] outline-none select-none focus-visible:ring-2 focus-visible:ring-ink"
      onClick={() => {
        playKeyClick();
        onPick(category);
      }}
    >
      <svg
        aria-hidden
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="opacity-40 mix-blend-multiply dark:mix-blend-normal"
      >
        <text
          x={WIDTH / 2}
          y={HEIGHT / 2}
          fontSize={19}
          textAnchor="middle"
          dominantBaseline="central"
          filter={glyphFilter(glyph)}
          className="fill-seal font-serif font-black"
        >
          {glyph}
        </text>
      </svg>
    </button>
  );
}
