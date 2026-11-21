import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onSettled,
  type Accessor,
} from "solid-js";
import type { CountryCode, LocalWeather, Station } from "@/shared/api/commands.ts";
import { localWeatherQuery, useCommandQuery } from "@/shared/api/queries.ts";
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
 * radio shows, and with weather on, Open-Meteo says what falls and blows. Its fields follow the
 * place and the clock.
 */
export function useLocalSky(
  region: Accessor<CountryCode>,
  station: Accessor<Station | null>
): LocalSky {
  const place = createMemo(() => placeOf(region(), station()), {
    equals: (one, other) => one[0] === other[0] && one[1] === other[1],
  });
  const [now, setNow] = createSignal(new Date());
  onSettled(() => {
    const timer = setInterval(() => setNow(new Date()), SUN_MS);
    return () => clearInterval(timer);
  });
  const altitude = createMemo(() => sunAltitude(now(), ...place()));
  const night = createMemo(() => isNightAt(altitude()));
  createEffect(night, (down) => {
    placeNightAtom.set(down);
  });
  onCleanup(() => placeNightAtom.set(null));
  const weather = useCommandQuery(() => ({
    ...localWeatherQuery(...place()),
    enabled: environmentAtom(),
  }));
  return {
    get weather() {
      return environmentAtom() ? (weather.data ?? null) : null;
    },
    get glow() {
      return glowAt(altitude());
    },
    get moon() {
      return moonLit(now());
    },
  };
}
