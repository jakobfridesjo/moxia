import type { CountryCode, Station } from "@/shared/api/commands.ts";

const RAD = Math.PI / 180;
/** 2000-01-01 12:00 UTC, in days since the Unix epoch. */
const J2000 = 10957.5;

/** How high the sun stands over the horizon at `latitude`, `longitude` at `date`, in degrees, to about a tenth of one. */
export function sunAltitude(date: Date, latitude: number, longitude: number) {
  const days = date.getTime() / 86_400_000 - J2000;
  const meanAnomaly = (357.528 + 0.985_600_3 * days) * RAD;
  const meanLongitude = 280.46 + 0.985_647_4 * days;
  const ecliptic =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD;
  const obliquity = (23.439 - 0.000_000_4 * days) * RAD;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  const siderealHours = 18.697_374_558 + 24.065_709_824_419_08 * days;
  const hourAngle = (siderealHours * 15 + longitude) * RAD - rightAscension;
  const lat = latitude * RAD;
  return (
    Math.asin(
      Math.sin(lat) * Math.sin(declination) +
        Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)
    ) / RAD
  );
}

/** The sun is down, for the painting, once it is this far under the horizon: the end of the brightest dusk. */
const NIGHT_BELOW = -4;

/** Whether the painting should show night with the sun at `altitude`. */
export const isNightAt = (altitude: number) => altitude < NIGHT_BELOW;

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** How warm the light of dawn or dusk is with the sun at `altitude`, 0 to 1: strongest as it touches the horizon. */
export const glowAt = (altitude: number) =>
  smoothstep(NIGHT_BELOW, 0, altitude) * (1 - smoothstep(2, 10, altitude));

/** Each region's capital or main city, for a station radio-browser has no place for. */
const CITIES: Record<CountryCode, [number, number]> = {
  CN: [39.9, 116.4],
  TW: [25.03, 121.56],
  HK: [22.3, 114.17],
  MO: [22.19, 113.54],
};

/** Where `station` is, in degrees: where radio-browser says, else its region's main city. */
export function placeOf(region: CountryCode, station: Station | null): [number, number] {
  if (station?.countryCode === region && station.latitude !== null && station.longitude !== null)
    return [station.latitude, station.longitude];
  return CITIES[region];
}
