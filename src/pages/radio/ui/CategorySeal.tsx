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
export function CategorySeal(props: {
  category: CategoryFilter;
  onPick: (category: CategoryFilter) => void;
}) {
  const m = useMessages();
  const next = () => around(props.category, 1);
  return (
    <div role="group" aria-label={m.radio.sealLabels.categories} class="flex items-center">
      <Neighbour category={around(props.category, -1)} onPick={props.onPick} />
      <Seal
        pressed={props.category !== "all"}
        aria-label={m.radio.sealLabels.category(
          m.radio.categories[props.category],
          m.radio.categories[next()]
        )}
        onClick={() => props.onPick(next())}
      >
        {m.radio.seals.categories[props.category]}
      </Seal>
      <Neighbour category={next()} onPick={props.onPick} />
    </div>
  );
}

/** A category beside the seal: its character alone, worn like a seal's but with no stone around it. */
function Neighbour(props: {
  category: CategoryFilter;
  onPick: (category: CategoryFilter) => void;
}) {
  const m = useMessages();
  const glyph = () => m.radio.seals.categories[props.category];
  return (
    <button
      type="button"
      data-control
      aria-label={m.radio.categories[props.category]}
      class="shrink-0 cursor-pointer rounded-[3px] outline-none select-none focus-visible:ring-2 focus-visible:ring-ink"
      onClick={() => {
        playKeyClick();
        props.onPick(props.category);
      }}
    >
      <svg
        aria-hidden="true"
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        class="opacity-40 mix-blend-multiply dark:mix-blend-normal"
      >
        <text
          x={WIDTH / 2}
          y={HEIGHT / 2}
          font-size="19"
          text-anchor="middle"
          dominant-baseline="central"
          filter={glyphFilter(glyph())}
          class="fill-seal font-serif font-black"
        >
          {glyph()}
        </text>
      </svg>
    </button>
  );
}
