import type { TapeNote } from "@/shared/api/commands.ts";
import { isActive, type PlayerState } from "@/features/player/model/player-store.ts";

/** What the radio is doing: a station on air or stopped, or a recording playing or paused. */
export type RadioMode = "idle" | "live" | "stopped" | "playback" | "paused";

export function radioMode(player: PlayerState): RadioMode {
  if (player.source === "tape" && player.deck) {
    return isActive(player.status) ? "playback" : "paused";
  }
  if (!player.station) return "idle";
  return isActive(player.status) ? "live" : "stopped";
}

/**
 * The entry `step` places on from `current`, wrapping around the ends;
 * the first or last when `current` is not in `list`.
 */
export function stepThrough<T extends { id: string }>(list: T[], current: T | null, step: -1 | 1) {
  if (list.length === 0) return null;
  const at = current ? list.findIndex((entry) => entry.id === current.id) : -1;
  if (at < 0) return step > 0 ? list[0] : list[list.length - 1];
  return list[(at + step + list.length) % list.length];
}

/** What was on air `seconds` into a recording: the last note written before then. */
export function noteAt(notes: TapeNote[], seconds: number) {
  return notes.findLast((note) => note.at <= seconds) ?? null;
}
