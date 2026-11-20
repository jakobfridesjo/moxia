import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commandErrorMessage, commands, type Station } from "@/shared/api/commands.ts";
import { favouritesQuery, presetsQuery } from "@/shared/api/queries.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { toastError } from "@/shared/lib/toast.ts";
import { toast } from "sonner";
import { presetSlots } from "@/pages/radio/model/preset-slots.ts";

/** The six preset keys, and a way to store a station on one. */
export function usePresets() {
  const m = useMessages();
  const queryClient = useQueryClient();
  const presets = useQuery(presetsQuery());
  const favourites = useQuery(favouritesQuery());

  // `mutate` keeps its identity while the mutation's state changes; the result object does not.
  const { mutate } = useMutation({
    mutationFn: ({ station, key }: { station: Station; key: number }) =>
      commands.setPreset(station, key),
    onSuccess: (_, { station, key }) => toast.success(m.presets.stored(key, station.name)),
    onError: (error) => toastError(commandErrorMessage(error, m.presets.storeFailed)),
    onSettled: async () => {
      await queryClient.invalidateQueries(presetsQuery());
      await queryClient.invalidateQueries(favouritesQuery());
    },
  });

  return {
    slots: presetSlots(presets.data ?? [], favourites.data ?? []),
    store: (station: Station, key: number) => mutate({ station, key }),
  };
}
