import { createMemo } from "solid-js";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { commandErrorMessage, commands, type Station } from "@/shared/api/commands.ts";
import { favouritesQuery, presetsQuery, useCommandQuery } from "@/shared/api/queries.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { toastError } from "@/shared/lib/toast.ts";
import { presetSlots } from "@/pages/radio/model/preset-slots.ts";

/** The six preset keys, and a way to store a station on one. */
export function usePresets() {
  const m = useMessages();
  const queryClient = useQueryClient();
  const presets = useCommandQuery(presetsQuery);
  const favourites = useCommandQuery(favouritesQuery);
  const slots = createMemo(() => presetSlots(presets.data ?? [], favourites.data ?? []));

  const store = useMutation(() => ({
    mutationFn: ({ station, key }: { station: Station; key: number }) =>
      commands.setPreset(station, key),
    onSuccess: (_: unknown, { station, key }: { station: Station; key: number }) => {
      toast.success(m.presets.stored(key, station.name));
    },
    onError: (error: unknown) => toastError(commandErrorMessage(error, m.presets.storeFailed)),
    onSettled: async () => {
      await queryClient.invalidateQueries(presetsQuery());
      await queryClient.invalidateQueries(favouritesQuery());
    },
  }));

  return {
    get slots() {
      return slots();
    },
    store: (station: Station, key: number) => void store.mutate({ station, key }),
  };
}
