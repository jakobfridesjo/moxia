import { COUNTRY_CODES, type Station } from "@/shared/api/commands.ts";
import type { CategoryFilter } from "@/shared/config/preferences.ts";

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

/** Whether seeking with `filter` stops at `station`. */
export const inCategory = (station: Station, filter: CategoryFilter) =>
  filter === "all" || station.categories.includes(filter);

/**
 * The nearest station `step` along `order` from `current` that is in `filter`, wrapping around the
 * ends, so a station outside the category keeps its place on the dial; the first or last in it when
 * `current` is not in `order`, and `current` itself when it is the only one.
 */
export function seekStation(
  order: Station[],
  current: Station | null,
  step: -1 | 1,
  filter: CategoryFilter
) {
  const size = order.length;
  const at = current ? order.findIndex((station) => station.id === current.id) : -1;
  const from = at >= 0 ? at : step > 0 ? -1 : size;
  for (let steps = 1; steps <= size; steps++) {
    const station = order[(((from + step * steps) % size) + size) % size];
    if (inCategory(station, filter)) return station;
  }
  return null;
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
