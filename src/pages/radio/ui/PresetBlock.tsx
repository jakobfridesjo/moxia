import { createMemo, createUniqueId, For, Show } from "solid-js";
import { ariaBoolean } from "@/shared/lib/aria.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { playKeyClick } from "@/shared/lib/key-sound.ts";
import type { PresetSlot } from "@/pages/radio/model/preset-slots.ts";
import { useHold } from "@/pages/radio/model/use-hold.ts";
import { glyphFilter, inkFilter, WASH_FILTER } from "@/pages/radio/lib/seal-ink.ts";
import { BLEED } from "@/pages/radio/ui/Seal.tsx";

const COLUMNS = 3;
/** One cell, and the margin from the stone's edge to the cells, in the seal's units (1 unit = 1 px). */
const CELL_WIDTH = 34;
const CELL_HEIGHT = 38;
const MARGIN = 5.4;
const EDGE = 3.2;
/** Every cell is cut from the same stone, so they share one wear. */
const STONE = "六";

type Ink = "carved" | "printed" | "half";

interface Cell {
  slot: PresetSlot;
  x: number;
  y: number;
  glyph: string;
  ink: Ink;
}

const inkOf = (slot: PresetSlot, onAirId: string | null): Ink =>
  !slot.station ? "half" : slot.station.id === onAirId ? "carved" : "printed";

/**
 * The six presets as one seal cut into a 3 × 2 block, like a many-character name seal. Each cell is
 * its formal numeral (壹貳參…): printed in full on a stored key, half translucent on an empty one, and
 * carved on the key on air.
 * Each cell is a key: a press plays it, holding stores the station on air.
 */
export function PresetBlock(props: {
  slots: PresetSlot[];
  onAirId: string | null;
  onPlay: (key: number) => void;
  onStore: (key: number) => void;
}) {
  const m = useMessages();
  const width = MARGIN * 2 + COLUMNS * CELL_WIDTH;
  const height = () => MARGIN * 2 + Math.ceil(props.slots.length / COLUMNS) * CELL_HEIGHT;
  const cells = createMemo(() =>
    props.slots.map((slot, index): Cell => ({
      slot,
      x: MARGIN + (index % COLUMNS) * CELL_WIDTH,
      y: MARGIN + Math.floor(index / COLUMNS) * CELL_HEIGHT,
      glyph: m.radio.seals.presets[slot.key - 1],
      ink: inkOf(slot, props.onAirId),
    }))
  );

  return (
    <div
      role="group"
      aria-label={m.presets.label}
      class="relative"
      style={{
        width: `${width + BLEED * 2}px`,
        height: `${height() + BLEED * 2}px`,
        margin: `${-BLEED}px`,
      }}
    >
      <BlockSeal width={width} height={height()} cells={cells()} />
      <For each={cells()} keyed={(cell) => cell.slot.key}>
        {(cell) => (
          <PresetKey
            slot={cell().slot}
            onAir={cell().ink === "carved"}
            left={cell().x + BLEED}
            top={cell().y + BLEED}
            onPlay={props.onPlay}
            onStore={props.onStore}
          />
        )}
      </For>
    </div>
  );
}

const placeOf = (cell: Cell) => `${cell.x},${cell.y}`;

function BlockSeal(props: { width: number; height: number; cells: Cell[] }) {
  const maskId = `block-${createUniqueId().replace(/\W/g, "")}`;
  const corner = 5;
  const outline = () => {
    const { width, height } = props;
    return (
      `M${EDGE + corner} ${EDGE}H${width - EDGE - corner}Q${width - EDGE} ${EDGE} ${width - EDGE} ${EDGE + corner}` +
      `V${height - EDGE - corner}Q${width - EDGE} ${height - EDGE} ${width - EDGE - corner} ${height - EDGE}` +
      `H${EDGE + corner}Q${EDGE} ${height - EDGE} ${EDGE} ${height - EDGE - corner}V${EDGE + corner}Q${EDGE} ${EDGE} ${EDGE + corner} ${EDGE}Z`
    );
  };
  const dividers = () => {
    const { width, height } = props;
    const rows = Math.round((height - MARGIN * 2) / CELL_HEIGHT);
    return [
      ...Array.from(
        { length: COLUMNS - 1 },
        (_, i) => `M${MARGIN + (i + 1) * CELL_WIDTH} ${MARGIN}V${height - MARGIN}`
      ),
      ...Array.from(
        { length: rows - 1 },
        (_, i) => `M${MARGIN} ${MARGIN + (i + 1) * CELL_HEIGHT}H${width - MARGIN}`
      ),
    ].join("");
  };
  const characters = (ink: Ink, paint: string) => (
    <For each={props.cells.filter((cell) => cell.ink === ink)} keyed={placeOf}>
      {(cell) => (
        <text
          x={cell().x + CELL_WIDTH / 2}
          y={cell().y + CELL_HEIGHT / 2}
          font-size="21"
          text-anchor="middle"
          dominant-baseline="central"
          class={`font-serif font-black ${paint}`}
        >
          {cell().glyph}
        </text>
      )}
    </For>
  );
  const box = () => ({
    width: props.width + BLEED * 2,
    height: props.height + BLEED * 2,
    viewBox: `${-BLEED} ${-BLEED} ${props.width + BLEED * 2} ${props.height + BLEED * 2}`,
  });

  return (
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 grid">
      <svg {...box()} class="col-start-1 row-start-1 overflow-visible dark:hidden">
        <path d={outline()} filter={WASH_FILTER} class="fill-paper opacity-75" />
      </svg>
      <svg
        {...box()}
        class="col-start-1 row-start-1 overflow-visible mix-blend-multiply dark:mix-blend-normal"
      >
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={-4}
          y={-4}
          width={props.width + 8}
          height={props.height + 8}
        >
          <rect x={-4} y={-4} width={props.width + 8} height={props.height + 8} fill="white" />
          <g filter={glyphFilter(STONE)}>{characters("carved", "fill-black")}</g>
        </mask>
        <g filter={inkFilter(STONE)}>
          <path d={outline()} fill="none" stroke-width={4.4} class="stroke-seal" />
          <path d={dividers()} fill="none" stroke-width={2.2} class="stroke-seal" />
        </g>
        <g mask={`url(#${maskId})`}>
          <g filter={inkFilter(STONE)}>
            <For each={props.cells.filter((cell) => cell.ink === "carved")} keyed={placeOf}>
              {(cell) => (
                <rect
                  x={cell().x}
                  y={cell().y}
                  width={CELL_WIDTH}
                  height={CELL_HEIGHT}
                  class="fill-seal"
                />
              )}
            </For>
          </g>
        </g>
        <g filter={glyphFilter(STONE)}>{characters("printed", "fill-seal")}</g>
        {/* Faded after the wear, not before: the wear cuts back anything printed too light. */}
        <g opacity={0.5}>
          <g filter={glyphFilter(STONE)}>{characters("half", "fill-seal")}</g>
        </g>
      </svg>
    </div>
  );
}

/** A cell of the block seal as a key: invisible over the print, with the ink rising while held. */
function PresetKey(props: {
  slot: PresetSlot;
  onAir: boolean;
  /** Where the key lies on the block, in px. */
  left: number;
  top: number;
  onPlay: (key: number) => void;
  onStore: (key: number) => void;
}) {
  const m = useMessages();
  const { holding, handlers } = useHold(
    (event) => {
      playKeyClick();
      if (event.shiftKey) props.onStore(props.slot.key);
      else props.onPlay(props.slot.key);
    },
    () => props.onStore(props.slot.key)
  );
  return (
    <button
      type="button"
      data-control
      aria-pressed={ariaBoolean(props.onAir)}
      aria-label={
        props.slot.station
          ? m.presets.key(props.slot.key, props.slot.station.name)
          : m.presets.emptyKey(props.slot.key)
      }
      class="absolute cursor-pointer outline-none select-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
      style={{
        left: `${props.left}px`,
        top: `${props.top}px`,
        width: `${CELL_WIDTH}px`,
        height: `${CELL_HEIGHT}px`,
      }}
      {...handlers}
    >
      <Show when={holding()}>
        <span
          aria-hidden="true"
          class="absolute inset-0 origin-bottom bg-seal/80 mix-blend-multiply dark:mix-blend-normal motion-safe:animate-[seal-rise_650ms_linear_forwards]"
          style={{ filter: inkFilter(STONE) }}
        />
      </Show>
    </button>
  );
}
