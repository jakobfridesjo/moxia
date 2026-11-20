import type { Station } from "@/shared/api/commands.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { stationClock } from "@/shared/lib/station-time.ts";
import {
  chineseNumerals,
  lunarDate,
  splitFrequency,
  timeOfDay,
  TITLE_COLUMN_SVH,
  titleSize,
} from "@/pages/radio/lib/inscription.ts";
import { SealMark } from "@/pages/radio/ui/Seal.tsx";

/**
 * The station written as a painting's inscription (題款), only what nothing else on screen says: columns
 * read right to left from one top line, a seal of the region leading the station name, then the frequency
 * smaller and set lower, and, for a recording, the lunar date and time of day it was made.
 */
export function Inscription({
  title,
  station,
  recordedAt,
}: {
  title: string;
  station: Station | null;
  /** When the recording being played was made; null when live. */
  recordedAt: string | null;
}) {
  const { inscription } = useMessages().radio;
  const simplified = !station || station.countryCode === "CN";
  const script = simplified ? inscription.simplified : inscription.traditional;
  const { title: name, band, frequency } = splitFrequency(title);
  const tuning =
    band && frequency ? script.bands[band] + chineseNumerals(frequency, script.point) : null;

  const recorded = recordedAt ? new Date(recordedAt) : null;
  const recordedDate = recorded && lunarDate(recorded, simplified ? "zh-Hans" : "zh-Hant");
  const recording =
    recorded && recordedDate
      ? recordedDate + script.times[timeOfDay(stationClock(recorded).hour)] + script.recorded
      : null;

  return (
    <div
      aria-hidden
      lang={simplified ? "zh-Hans" : "zh-Hant"}
      className="pointer-events-none absolute top-[max(1.4rem,env(safe-area-inset-top))] right-[max(1.6rem,env(safe-area-inset-right))] isolate flex flex-row-reverse items-start gap-2.5 font-brush text-ink"
    >
      <Mist />
      <div className="flex flex-col items-center gap-2">
        {station && <SealMark glyph={inscription.regions[station.countryCode]} carved size={30} />}
        <p
          className="m-0 leading-[1.15] font-bold tracking-[0.04em] [writing-mode:vertical-rl]"
          style={{ fontSize: titleSize(name), maxHeight: `${TITLE_COLUMN_SVH}svh` }}
        >
          <Inscribed text={name} />
        </p>
      </div>
      {tuning && <p className={SMALL_COLUMN}>{tuning}</p>}
      {recording && <p className={SMALL_COLUMN}>{recording}</p>}
    </div>
  );
}

const SMALL_COLUMN =
  "m-0 mt-12 max-h-[62svh] text-[1.05rem] leading-[1.35] font-bold tracking-[0.04em] whitespace-nowrap text-ink/85 [writing-mode:vertical-rl]";

/**
 * Paper cleared behind the inscription: a wash shaped to the columns with a torn, feathered edge,
 * so it fades into the brushwork instead of reading as a hole in the painting. At night the pale
 * writing reads on the dark painting as it is, and a wash would only show as a patch.
 */
function Mist() {
  return (
    <svg
      aria-hidden
      className="absolute -top-14 -left-12 -z-10 h-[calc(100%+7rem)] dark:hidden w-[calc(100%+6rem)] overflow-visible"
    >
      <filter id="inscription-mist" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={0.035}
          numOctaves={3}
          seed={4}
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale={34}
          xChannelSelector="R"
          yChannelSelector="G"
          result="torn"
        />
        <feGaussianBlur in="torn" stdDeviation={11} />
      </filter>
      <rect
        x="12%"
        y="10%"
        width="76%"
        height="80%"
        rx={18}
        filter="url(#inscription-mist)"
        className="fill-paper opacity-88"
      />
    </svg>
  );
}

/** Characters as they are, with runs of Latin set a size down so they don't outweigh them. */
function Inscribed({ text }: { text: string }) {
  const runs = text.match(/[A-Za-z0-9.&'+-]+(?:\s+[A-Za-z0-9.&'+-]+)*|[^A-Za-z0-9.&'+-]+/g) ?? [];
  let offset = 0;
  return runs.map((run) => {
    const key = offset;
    offset += run.length;
    return /[A-Za-z]/.test(run) ? (
      <span key={key} className="text-[0.7em] tracking-[0.04em]">
        {run}
      </span>
    ) : (
      run.replace(/\s+/g, "")
    );
  });
}
