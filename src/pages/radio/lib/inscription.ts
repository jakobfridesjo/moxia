const NUMERALS = "〇一二三四五六七八九";
const DAY_TENS = ["初", "十", "廿", "三"];
const DAY_ONES = "十一二三四五六七八九";
const STATION_TIME_ZONE = "Asia/Shanghai";

/** The title's largest and smallest size, and its largest once it runs to a second column, in rem; it may run down two columns this tall. */
const TITLE_LARGEST_REM = 1.9;
const TITLE_SMALLEST_REM = 1.2;
const TITLE_TWO_COLUMNS_REM = 1.5;
export const TITLE_COLUMN_SVH = 55;
/** A Latin phrase lies on its side, set this size down, and each letter takes about this much of a character's height. */
export const SIDEWAYS_SIZE_EM = 0.85;
const SIDEWAYS_EM = 0.6 * SIDEWAYS_SIZE_EM;
/** Room kept above and below a sideways phrase, in a character's height, so it never touches the characters. */
export const SIDEWAYS_ROOM_EM = 0.25;

export type Band = "FM" | "AM";

/** A station name with any trailing frequency (`FM100.7`) split off. */
export function splitFrequency(name: string): {
  title: string;
  band: Band | null;
  frequency: string | null;
} {
  const match = /\s*\b(FM|AM)\s*(\d+(?:\.\d+)?)\s*$/i.exec(name);
  if (!match || match.index === 0) return { title: name, band: null, frequency: null };
  return {
    title: name.slice(0, match.index).trim(),
    band: match[1].toUpperCase() as Band,
    frequency: match[2],
  };
}

/** `100.7` as an inscriber writes it: 一〇〇點七. */
export function chineseNumerals(number: string, point: string) {
  return number
    .split("")
    .map((digit) => (digit === "." ? point : NUMERALS[Number(digit)]))
    .join("");
}

/** A lunar month's day by its traditional name: 初五, 十二, 廿三. */
function lunarDay(day: number) {
  if (day === 10) return "初十";
  if (day === 20) return "二十";
  if (day === 30) return "三十";
  return DAY_TENS[Math.floor(day / 10)] + DAY_ONES[day % 10];
}

/** The lunar date at the stations, such as 丙午年十月初五; null where the webview lacks the Chinese calendar. */
export function lunarDate(date: Date, locale: "zh-Hans" | "zh-Hant") {
  try {
    const parts = new Intl.DateTimeFormat(`${locale}-u-ca-chinese`, {
      timeZone: STATION_TIME_ZONE,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).formatToParts(date);
    const part = (type: string) => parts.find((each) => each.type === type)?.value ?? "";
    const year = part("yearName");
    const day = Number(part("day"));
    if (!year || !part("month") || !day) return null;
    return `${year}年${part("month")}${lunarDay(day)}`;
  } catch {
    return null;
  }
}

export type TimeOfDay = "dawn" | "day" | "dusk" | "night";

/** The time of day an inscription records, from the hour at the stations. */
export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 9) return "dawn";
  if (hour >= 9 && hour < 17) return "day";
  if (hour >= 17 && hour < 19) return "dusk";
  return "night";
}

/**
 * How a run of a vertical name is set, as in vertical Chinese typesetting: characters as they are, with a
 * short acronym or a longer number among them in full-width letters standing one under another; a number
 * of one or two digits across one character's square (縱中橫); and a Latin word or phrase on its side.
 */
export type InscribedSet = "characters" | "across" | "sideways";

const LATIN_RUN = /[A-Za-z0-9.&'+-]+(?:\s+[A-Za-z0-9.&'+-]+)*/g;

function latinSet(token: string): InscribedSet {
  if (/^\d{1,2}\+?$/.test(token)) return "across";
  if (/^\d+(?:\.\d+)?$/.test(token) || /^[A-Z]{1,4}$/.test(token)) return "characters";
  return "sideways";
}

/** `CCTV` as `ＣＣＴＶ`: Latin in the width of a character, so it stands upright in a vertical line. */
function fullWidth(text: string) {
  return text.replace(/[!-~]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 0xfee0)
  );
}

/** What lies between Latin runs: spaces dropped, and ASCII brackets and marks in the forms that turn with a vertical line. */
function standing(text: string) {
  return fullWidth(text.replace(/\s+/g, ""));
}

/** A name split into runs, each with how it is set in a vertical column. */
export function inscribedRuns(text: string): { text: string; set: InscribedSet }[] {
  const runs: { text: string; set: InscribedSet }[] = [];
  const push = (part: string, set: InscribedSet) => {
    if (!part) return;
    const last = runs.at(-1);
    if (last && last.set === set && set !== "across") last.text += part;
    else runs.push({ text: part, set });
  };
  let at = 0;
  for (const match of text.matchAll(LATIN_RUN)) {
    push(standing(text.slice(at, match.index)), "characters");
    const latin = match[0];
    if (/\s/.test(latin)) push(latin, "sideways");
    else
      for (const part of latin.split(/(-)/)) {
        const set = part === "-" ? "sideways" : latinSet(part);
        push(set === "characters" ? fullWidth(part) : part, set);
      }
    at = match.index + latin.length;
  }
  push(standing(text.slice(at)), "characters");
  return runs;
}

/** How many characters tall `text` stands in a vertical line. */
function columnLength(text: string) {
  const height: Record<InscribedSet, number> = {
    characters: 1,
    across: 0,
    sideways: SIDEWAYS_EM,
  };
  return inscribedRuns(text).reduce(
    (length, run) =>
      length +
      (run.set === "across" ? 1 : run.text.length * height[run.set]) +
      (run.set === "sideways" ? 2 * SIDEWAYS_ROOM_EM : 0),
    0
  );
}

/**
 * The title shrinks to stay in one column, down to the size it takes in two; past that it runs on
 * into a second column, and only a name too long for two shrinks further.
 */
export function titleSize(text: string) {
  const length = Math.max(columnLength(text), 1).toFixed(2);
  const oneColumn = `${TITLE_COLUMN_SVH}svh / ${length}`;
  const twoColumns = `${2 * TITLE_COLUMN_SVH}svh / ${length}`;
  const largest = `min(${TITLE_LARGEST_REM}rem, max(${TITLE_TWO_COLUMNS_REM}rem, ${oneColumn}))`;
  return `clamp(${TITLE_SMALLEST_REM}rem, calc(${twoColumns}), ${largest})`;
}
