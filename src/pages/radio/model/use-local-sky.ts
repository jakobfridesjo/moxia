import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import type { CountryCode, LocalWeather, Station } from "@/shared/api/commands.ts";
import { localWeatherQuery } from "@/shared/api/queries.ts";
import { environmentAtom } from "@/shared/config/preferences.ts";
import { placeNightAtom } from "@/shared/lib/night.ts";
import { glowAt, isNightAt, moonLit, placeOf, sunAltitude } from "@/pages/radio/lib/sun.ts";

/** The sun moves a quarter of a degree a minute, so the painting looks again each minute. */
const SUN_MS = 60_000;

/** The sky where the station is: its weather when known, and how warm the light of dawn or dusk is. */
export interface LocalSky {
  weather: LocalWeather | null;
  glow: number;
  /** How much of the moon is lit, 0 at new moon to 1 at full. */
  moon: number;
}

/**
 * The sky over `station`, or `region` when nothing plays: the sun decides night on auto while the
 * radio shows, and with weather on, Open-Meteo says what falls and blows.
 */
export function useLocalSky(region: CountryCode, station: Station | null): LocalSky {
  const [latitude, longitude] = placeOf(region, station);
  const environment = useSelector(environmentAtom);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), SUN_MS);
    return () => clearInterval(timer);
  }, []);
  const altitude = sunAltitude(now, latitude, longitude);
  const night = isNightAt(altitude);
  useEffect(() => {
    placeNightAtom.set(night);
  }, [night]);
  useEffect(() => () => placeNightAtom.set(null), []);
  const { data } = useQuery({ ...localWeatherQuery(latitude, longitude), enabled: environment });
  return {
    weather: environment ? (data ?? null) : null,
    glow: glowAt(altitude),
    moon: moonLit(now),
  };
}
