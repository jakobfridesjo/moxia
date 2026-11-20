/** Every station the app lists, in mainland China, Taiwan, Hong Kong and Macau, keeps UTC+8. */
const STATION_TIME_ZONE = "Asia/Shanghai";

/** The hour and minute at the stations. */
export function stationClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STATION_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  return { hour: part("hour"), minute: part("minute") };
}
