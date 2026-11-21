import { createMemo, Show } from "solid-js";
import type { Station } from "@/shared/api/commands.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { stationClock } from "@/shared/lib/station-time.ts";
import {
  inscribedRuns,
  lunarDate,
  SIDEWAYS_ROOM_EM,
  SIDEWAYS_SHIFT_EM,
  SIDEWAYS_SIZE_EM,
  timeOfDay,
  TITLE_COLUMN_SVH,
  TITLE_REM,
} from "@/pages/radio/lib/inscription.ts";
import { SealMark } from "@/pages/radio/ui/Seal.tsx";

/**
 * The station written as a painting's inscription (題款), only what nothing else on screen says: columns
 * read right to left from one top line, a seal of the region leading the station name as it is written,
 * and, for a recording, the lunar date and time of day it was made. The seal and the name's first column
 * stand in the same place for every station, the name at one size; a long name runs on into columns of
 * even length to its left.
 */
export function Inscription(props: {
  title: string;
  station: Station | null;
  /** When the recording being played was made; null when live. */
  recordedAt: string | null;
}) {
  const m = useMessages();
  const simplified = () => !props.station || props.station.countryCode === "CN";
  const recording = createMemo(() => {
    const { inscription } = m.radio;
    const script = simplified() ? inscription.simplified : inscription.traditional;
    const recorded = props.recordedAt ? new Date(props.recordedAt) : null;
    const recordedDate = recorded && lunarDate(recorded, simplified() ? "zh-Hans" : "zh-Hant");
    return recorded && recordedDate
      ? recordedDate + script.times[timeOfDay(stationClock(recorded).hour)] + script.recorded
      : null;
  });

  return (
    <>
      <MistFilter />
      <div
        aria-hidden="true"
        lang={simplified() ? "zh-Hans" : "zh-Hant"}
        class="pointer-events-none absolute top-[max(1.4rem,env(safe-area-inset-top))] right-[max(1.6rem,env(safe-area-inset-right))] -mt-12 -mr-12 flex flex-row-reverse items-start gap-2.5 p-12 font-brush text-ink [filter:url(#inscription-mist)] dark:[filter:none]"
      >
        <div class="flex flex-col items-end gap-2" style={{ "font-size": `${TITLE_REM}rem` }}>
          <div class="flex w-[1.15em] justify-center">
            <SealMark
              glyph={m.radio.inscription.regions[props.station?.countryCode ?? "CN"]}
              carved
              size={38}
            />
          </div>
          <p
            class="m-0 leading-[1.15] font-bold tracking-[0.04em] [text-wrap:balance] [writing-mode:vertical-rl]"
            style={{ "max-height": `${TITLE_COLUMN_SVH}svh` }}
          >
            {inscribed(props.title)}
          </p>
        </div>
        <Show when={recording()}>{(written) => <p class={SMALL_COLUMN}>{written()}</p>}</Show>
      </div>
    </>
  );
}

const SMALL_COLUMN =
  "m-0 mt-12 max-h-[62svh] text-[1.05rem] leading-[1.35] font-bold tracking-[0.04em] whitespace-nowrap text-ink/85 [writing-mode:vertical-rl]";

/**
 * Paper cleared behind the inscription, grown out of the writing itself: the strokes spread into one
 * wash per column, torn and feathered at the edge, so it follows the columns however they wrap and fades
 * into the brushwork instead of sitting on it as a slab. The padding around the writing is its room.
 * At night the pale writing reads on the dark painting as it is, and a wash would only show as a patch.
 */
function MistFilter() {
  return (
    <svg aria-hidden="true" width="0" height="0" class="absolute">
      <filter id="inscription-mist" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation={12} result="spread" />
        <feComponentTransfer in="spread" result="column">
          <feFuncA type="linear" slope={6} />
        </feComponentTransfer>
        <feTurbulence
          type="fractalNoise"
          baseFrequency={0.03}
          numOctaves={3}
          seed={4}
          result="noise"
        />
        <feDisplacementMap
          in="column"
          in2="noise"
          scale={28}
          xChannelSelector="R"
          yChannelSelector="G"
          result="torn"
        />
        <feGaussianBlur in="torn" stdDeviation={8} result="feathered" />
        <feFlood style={{ "flood-color": "var(--paper)" }} flood-opacity={0.9} />
        <feComposite in2="feathered" operator="in" result="mist" />
        <feMerge>
          <feMergeNode in="mist" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </svg>
  );
}

/** The name with its numbers and Latin set the way vertical Chinese sets them, never broken across columns. */
function inscribed(text: string) {
  const room = `${SIDEWAYS_ROOM_EM / SIDEWAYS_SIZE_EM}em`;
  const runs = inscribedRuns(text);
  return runs.map(({ text: run, set }, index) => {
    if (set === "characters") return run;
    if (set === "across")
      return <span class="whitespace-nowrap [text-combine-upright:all]">{run}</span>;
    return (
      <span
        class="relative whitespace-nowrap tracking-[0.04em]"
        style={{
          "font-size": `${SIDEWAYS_SIZE_EM}em`,
          left: /[A-Za-z0-9]/.test(run) ? `-${SIDEWAYS_SHIFT_EM}em` : undefined,
          "margin-inline-start": index === 0 ? 0 : room,
          "margin-inline-end": index === runs.length - 1 ? 0 : room,
        }}
      >
        {run}
      </span>
    );
  });
}
