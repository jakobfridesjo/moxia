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

/** Open-Meteo updates its current weather every 15 minutes; half an hour is near enough for a painting. */
const WEATHER_MS = 30 * 60 * 1000;

/** The weather at a place, to about a kilometre. */
export const localWeatherQuery = (latitude: number, longitude: number) => {
  const [lat, lon] = [latitude, longitude].map((degrees) => Math.round(degrees * 100) / 100);
  return queryOptions({
    queryKey: ["weather", lat, lon],
    queryFn: () => commands.localWeather(lat, lon),
    staleTime: WEATHER_MS,
    refetchInterval: WEATHER_MS,
    retry: 1,
  });
};
