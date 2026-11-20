const NUMERALS = "〇一二三四五六七八九";
const DAY_TENS = ["初", "十", "廿", "三"];
const DAY_ONES = "十一二三四五六七八九";
const STATION_TIME_ZONE = "Asia/Shanghai";

/** The title's largest and smallest size, in rem; it may run down two columns this tall. */
const TITLE_LARGEST_REM = 1.9;
const TITLE_SMALLEST_REM = 1.2;
export const TITLE_COLUMN_SVH = 55;
/** Latin letters and digits lie on their side in a vertical line and take about this much of a character's height. */
const SIDEWAYS_EM = 0.6;

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

/** The first Chinese character of a station's name, which its preset key shows; null for a name without one. */
export function stationInitial(name: string) {
  return /\p{Script=Han}/u.exec(name)?.[0] ?? null;
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

/** How many characters tall `text` stands in a vertical line. */
function columnLength(text: string) {
  let length = 0;
  for (const character of text) {
    if (/\s/u.test(character)) length += 0.3;
    else if (/[\p{Script=Han}　-ヿ＀-￯]/u.test(character)) length += 1;
    else length += SIDEWAYS_EM;
  }
  return length;
}

/** The title keeps one size and runs on into a second column; only a name too long for two shrinks. */
export function titleSize(text: string) {
  const length = Math.max(columnLength(text), 1);
  return `clamp(${TITLE_SMALLEST_REM}rem, calc(${2 * TITLE_COLUMN_SVH}svh / ${length.toFixed(2)}), ${TITLE_LARGEST_REM}rem)`;
}
