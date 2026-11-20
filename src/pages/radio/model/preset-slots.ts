import { PRESET_KEYS, type Preset, type Station } from "@/shared/api/commands.ts";

export interface PresetSlot {
  key: number;
  station: Station | null;
}

/**
 * What each preset key plays: the station stored on it, or else the next
 * favourite that is on no key, newest first; empty once those run out.
 */
export function presetSlots(presets: Preset[], favourites: Station[]): PresetSlot[] {
  const stored = new Map(presets.map((preset) => [preset.key, preset.station]));
  const onKeys = new Set(presets.map((preset) => preset.station.id));
  const spare = favourites.filter((station) => !onKeys.has(station.id));
  return Array.from({ length: PRESET_KEYS }, (_, index) => {
    const key = index + 1;
    return { key, station: stored.get(key) ?? spare.shift() ?? null };
  });
}
