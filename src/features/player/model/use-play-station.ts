import { useQueryClient } from "@tanstack/solid-query";
import type { Station } from "@/shared/api/commands.ts";
import { recentQuery } from "@/shared/api/queries.ts";
import { playStation } from "@/features/player/model/player-store.ts";

/** Plays a station; it then heads the recent list. */
export function usePlayStation() {
  const queryClient = useQueryClient();
  return async (station: Station) => {
    await playStation(station);
    await queryClient.invalidateQueries(recentQuery());
  };
}
