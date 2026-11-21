import { createAtom } from "@/shared/lib/atom.ts";
import { themeAtom, type Theme } from "@/shared/config/preferences.ts";

/**
 * Whether `theme` means night. On auto it follows the sun where the station is, `placeNight`,
 * while the radio shows one, and otherwise the system.
 */
export function isNight(theme: Theme, systemDark: boolean, placeNight: boolean | null = null) {
  return theme === "night" || (theme === "auto" && (placeNight ?? systemDark));
}

const systemDark =
  typeof window !== "undefined" && "matchMedia" in window
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** Whether the sun is down where the station on show is; null when no station is on show. */
export const placeNightAtom = createAtom<boolean | null>(null);

const nightNow = () => isNight(themeAtom.get(), systemDark?.matches ?? false, placeNightAtom.get());

/** Whether the app is in its night look now, following the theme setting and, on auto, the sun or the system. */
export const nightAtom = createAtom(nightNow());

const update = () => nightAtom.set(nightNow());
themeAtom.subscribe(update);
placeNightAtom.subscribe(update);
systemDark?.addEventListener("change", update);
