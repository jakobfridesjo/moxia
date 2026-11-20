import { queryOptions } from "@tanstack/react-query";
import { commands } from "@/shared/api/commands.ts";

/** Rust keeps the station list for a day, so asking again is cheap. */
export const stationsQuery = () =>
  queryOptions({ queryKey: ["stations"], queryFn: () => commands.listStations(false) });

export const favouritesQuery = () =>
  queryOptions({ queryKey: ["favourites"], queryFn: commands.listFavourites });

export const presetsQuery = () =>
  queryOptions({ queryKey: ["presets"], queryFn: commands.listPresets });

export const tapesQuery = () => queryOptions({ queryKey: ["tapes"], queryFn: commands.listTapes });

export const recentQuery = () =>
  queryOptions({ queryKey: ["recent"], queryFn: commands.listRecent });

/** Chinese text in English: the translator gives the same translation every time. */
export const translationQuery = (text: string) =>
  queryOptions({
    queryKey: ["translation", text],
    queryFn: () => commands.translate(text),
    staleTime: "static",
  });

/** Which downloadable models are on this device. */
export const modelsQuery = () =>
  queryOptions({ queryKey: ["models"], queryFn: commands.listModels });
