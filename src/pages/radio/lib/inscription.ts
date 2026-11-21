const DAY_TENS = ["初", "十", "廿", "三"];
const DAY_ONES = "十一二三四五六七八九";
const STATION_TIME_ZONE = "Asia/Shanghai";

/** The name's size, and how tall its columns run before it wraps into the next. */
export const TITLE_REM = 1.9;
export const TITLE_COLUMN_SVH = 55;
/** A Latin phrase lies on its side, set this size down. */
export const SIDEWAYS_SIZE_EM = 0.85;
/** Room kept above and below a sideways phrase, in a character's height, so it never touches the characters. */
export const SIDEWAYS_ROOM_EM = 0.25;
/** How far sideways letters and digits move back to the column's middle, in their own size: the font centres them with room for descenders most names lack. */
export const SIDEWAYS_SHIFT_EM = 0.06;

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
 * Brackets and other marks are left out.
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

/** What lies between Latin runs: spaces dropped, and ASCII marks in the width of a character. */
function standing(text: string) {
  return fullWidth(text.replace(/\s+/g, ""));
}

/** Brackets and other marks, left out of the inscription. */
const MARKS = /[()[\]{}<>（）［］｛｝〔〕【】《》〈〉「」『』|_~*#@]/g;

/** A name split into runs, each with how it is set in a vertical column. */
export function inscribedRuns(text: string): { text: string; set: InscribedSet }[] {
  const runs: { text: string; set: InscribedSet }[] = [];
  const push = (part: string, set: InscribedSet) => {
    if (!part) return;
    const last = runs.at(-1);
    if (last && last.set === set && set !== "across") last.text += part;
    else runs.push({ text: part, set });
  };
  const name = text.replace(MARKS, " ");
  let at = 0;
  for (const match of name.matchAll(LATIN_RUN)) {
    push(standing(name.slice(at, match.index)), "characters");
    const latin = match[0];
    if (/\s/.test(latin)) push(latin, "sideways");
    else
      for (const part of latin.split(/(-)/)) {
        const set = part === "-" ? "sideways" : latinSet(part);
        push(set === "characters" ? fullWidth(part) : part, set);
      }
    at = match.index + latin.length;
  }
  push(standing(name.slice(at)), "characters");
  return runs;
}
