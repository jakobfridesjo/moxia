import { memo, useId } from "react";
import { useMessages } from "@/shared/i18n/messages.ts";
import { playKeyClick } from "@/shared/lib/key-sound.ts";
import { stationInitial } from "@/pages/radio/lib/inscription.ts";
import type { PresetSlot } from "@/pages/radio/model/preset-slots.ts";
import { useHold } from "@/pages/radio/model/use-hold.ts";
import { glyphFilter, inkFilter } from "@/pages/radio/lib/seal-ink.ts";
import { BLEED } from "@/pages/radio/ui/Seal.tsx";

const COLUMNS = 3;
/** One cell, and the margin from the stone's edge to the cells, in the seal's units (1 unit = 1 px). */
const CELL_WIDTH = 34;
const CELL_HEIGHT = 38;
const MARGIN = 5.4;
const EDGE = 3.2;
/** Every cell is cut from the same stone, so they share one wear. */
const STONE = "六";

type Ink = "carved" | "printed" | "faint";

const inkOf = (slot: PresetSlot, onAirId: string | null): Ink =>
  !slot.station ? "faint" : slot.station.id === onAirId ? "carved" : "printed";

/**
 * The six presets as one seal cut into a 3 × 2 block, like a many-character name seal. A stored key
 * shows its station's first character; an empty one a faint numeral; the key on air is carved.
 * Each cell is a key: a press plays it, holding stores the station on air.
 */
export function PresetBlock({
  slots,
  onAirId,
  onPlay,
  onStore,
}: {
  slots: PresetSlot[];
  onAirId: string | null;
  onPlay: (key: number) => void;
  onStore: (key: number) => void;
}) {
  const m = useMessages();
  const rows = Math.ceil(slots.length / COLUMNS);
  const width = MARGIN * 2 + COLUMNS * CELL_WIDTH;
  const height = MARGIN * 2 + rows * CELL_HEIGHT;
  const cells = slots.map((slot, index) => ({
    slot,
    x: MARGIN + (index % COLUMNS) * CELL_WIDTH,
    y: MARGIN + Math.floor(index / COLUMNS) * CELL_HEIGHT,
    glyph:
      (slot.station && stationInitial(slot.station.name)) ?? m.radio.seals.presets[slot.key - 1],
    ink: inkOf(slot, onAirId),
  }));

  return (
    <div
      role="group"
      aria-label={m.presets.label}
      className="relative"
      style={{ width: width + BLEED * 2, height: height + BLEED * 2, margin: -BLEED }}
    >
      <BlockSeal width={width} height={height} cells={cells} />
      {cells.map((cell) => (
        <PresetKey
          key={cell.slot.key}
          slot={cell.slot}
          onAir={cell.ink === "carved"}
          left={cell.x + BLEED}
          top={cell.y + BLEED}
          onPlay={onPlay}
          onStore={onStore}
        />
      ))}
    </div>
  );
}

function BlockSeal({
  width,
  height,
  cells,
}: {
  width: number;
  height: number;
  cells: { x: number; y: number; glyph: string; ink: Ink }[];
}) {
  const maskId = `block-${useId().replace(/\W/g, "")}`;
  const rows = Math.round((height - MARGIN * 2) / CELL_HEIGHT);
  const corner = 5;
  const outline =
    `M${EDGE + corner} ${EDGE}H${width - EDGE - corner}Q${width - EDGE} ${EDGE} ${width - EDGE} ${EDGE + corner}` +
    `V${height - EDGE - corner}Q${width - EDGE} ${height - EDGE} ${width - EDGE - corner} ${height - EDGE}` +
    `H${EDGE + corner}Q${EDGE} ${height - EDGE} ${EDGE} ${height - EDGE - corner}V${EDGE + corner}Q${EDGE} ${EDGE} ${EDGE + corner} ${EDGE}Z`;
  const dividers = [
    ...Array.from(
      { length: COLUMNS - 1 },
      (_, i) => `M${MARGIN + (i + 1) * CELL_WIDTH} ${MARGIN}V${height - MARGIN}`
    ),
    ...Array.from(
      { length: rows - 1 },
      (_, i) => `M${MARGIN} ${MARGIN + (i + 1) * CELL_HEIGHT}H${width - MARGIN}`
    ),
  ].join("");
  const character = (cell: { x: number; y: number; glyph: string }, paint: string) => (
    <text
      key={`${cell.x},${cell.y}`}
      x={cell.x + CELL_WIDTH / 2}
      y={cell.y + CELL_HEIGHT / 2}
      fontSize={21}
      textAnchor="middle"
      dominantBaseline="central"
      className={`font-serif font-black ${paint}`}
    >
      {cell.glyph}
    </text>
  );
  const carved = cells.filter((cell) => cell.ink === "carved");
  const box = {
    width: width + BLEED * 2,
    height: height + BLEED * 2,
    viewBox: `${-BLEED} ${-BLEED} ${width + BLEED * 2} ${height + BLEED * 2}`,
  };

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 grid">
      <svg {...box} className="col-start-1 row-start-1 dark:hidden">
        <path d={outline} className="fill-paper opacity-55" />
      </svg>
      <svg
        {...box}
        className="col-start-1 row-start-1 overflow-visible mix-blend-multiply dark:mix-blend-normal"
      >
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={-4}
          y={-4}
          width={width + 8}
          height={height + 8}
        >
          <rect x={-4} y={-4} width={width + 8} height={height + 8} fill="white" />
          <g filter={glyphFilter(STONE)}>{carved.map((cell) => character(cell, "fill-black"))}</g>
        </mask>
        <g filter={inkFilter(STONE)}>
          <path d={outline} fill="none" strokeWidth={4.4} className="stroke-seal" />
          <path d={dividers} fill="none" strokeWidth={2.2} className="stroke-seal" />
        </g>
        <g mask={`url(#${maskId})`}>
          <g filter={inkFilter(STONE)}>
            {carved.map((cell) => (
              <rect
                key={`${cell.x},${cell.y}`}
                x={cell.x}
                y={cell.y}
                width={CELL_WIDTH}
                height={CELL_HEIGHT}
                className="fill-seal"
              />
            ))}
          </g>
        </g>
        {(["printed", "faint"] as const).map((ink) => (
          // Faded after the wear, not before: the wear cuts back anything printed too light.
          <g key={ink} opacity={ink === "faint" ? 0.35 : 1}>
            <g filter={glyphFilter(STONE)}>
              {cells.filter((cell) => cell.ink === ink).map((cell) => character(cell, "fill-seal"))}
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * A cell of the block seal as a key: invisible over the print, with the ink rising while held.
 * Memoized, as the block lays out every cell again whenever the station on air changes.
 */
const PresetKey = memo(function PresetKey({
  slot,
  onAir,
  left,
  top,
  onPlay,
  onStore,
}: {
  slot: PresetSlot;
  onAir: boolean;
  /** Where the key lies on the block, in px; numbers, so a key re-renders only when it changes. */
  left: number;
  top: number;
  onPlay: (key: number) => void;
  onStore: (key: number) => void;
}) {
  const m = useMessages();
  const { holding, handlers } = useHold(
    (event) => {
      playKeyClick();
      if (event.shiftKey) onStore(slot.key);
      else onPlay(slot.key);
    },
    () => onStore(slot.key)
  );
  return (
    <button
      type="button"
      data-control
      aria-pressed={onAir}
      aria-label={
        slot.station ? m.presets.key(slot.key, slot.station.name) : m.presets.emptyKey(slot.key)
      }
      className="absolute cursor-pointer outline-none select-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
      style={{ left, top, width: CELL_WIDTH, height: CELL_HEIGHT }}
      {...handlers}
    >
      {holding && (
        <span
          aria-hidden
          className="absolute inset-0 origin-bottom bg-seal/80 mix-blend-multiply dark:mix-blend-normal motion-safe:animate-[seal-rise_650ms_linear_forwards]"
          style={{ filter: inkFilter(STONE) }}
        />
      )}
    </button>
  );
});
