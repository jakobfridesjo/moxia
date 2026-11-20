import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { tapesQuery } from "@/shared/api/queries.ts";
import { tapesChangedAtom } from "@/features/player/model/player-store.ts";

/** The saved tapes, fetched again whenever a recording ends. */
export function useTapes() {
  const queryClient = useQueryClient();
  const changed = useSelector(tapesChangedAtom);
  useEffect(() => {
    if (changed > 0) void queryClient.invalidateQueries(tapesQuery());
  }, [changed, queryClient]);
  return useQuery(tapesQuery());
}
