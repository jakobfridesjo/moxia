import { createAtom } from "@tanstack/react-store";
import { themeAtom, type Theme } from "@/shared/config/preferences.ts";

/** Whether `theme` means night, when the system is or is not dark. */
export function isNight(theme: Theme, systemDark: boolean) {
  return theme === "night" || (theme === "auto" && systemDark);
}

const systemDark =
  typeof window !== "undefined" && "matchMedia" in window
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** Whether the app is in its night look now, following the theme setting and, on auto, the system. */
export const nightAtom = createAtom(isNight(themeAtom.get(), systemDark?.matches ?? false));

const update = () => nightAtom.set(isNight(themeAtom.get(), systemDark?.matches ?? false));
themeAtom.subscribe(update);
systemDark?.addEventListener("change", update);
