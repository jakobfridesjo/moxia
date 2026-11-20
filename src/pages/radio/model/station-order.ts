import { COUNTRY_CODES, type Station } from "@/shared/api/commands.ts";

/** The order seeking steps through: by country, then region, then name. */
export function dialOrder(stations: Station[]): Station[] {
  const rank = (station: Station) => COUNTRY_CODES.indexOf(station.countryCode);
  return stations.toSorted(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.state ?? "").localeCompare(b.state ?? "", "zh") ||
      a.name.localeCompare(b.name, "zh")
  );
}

/** The first station of the next country along `order` from `current`'s, or the previous one for `step` −1. */
export function nextCountry(order: Station[], current: Station | null, step: -1 | 1) {
  const countries = [...new Set(order.map((station) => station.countryCode))];
  if (countries.length === 0) return null;
  const at = current ? countries.indexOf(current.countryCode) : -1;
  const next =
    at < 0
      ? countries[step > 0 ? 0 : countries.length - 1]
      : countries[(at + step + countries.length) % countries.length];
  return order.find((station) => station.countryCode === next) ?? null;
}
