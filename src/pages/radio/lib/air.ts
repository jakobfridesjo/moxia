/*
 * What the painting's weather knows of the player: only whether anything plays. The weather never
 * follows the sound itself (its loudness, beats or talk); only the figures' heads and mouths do.
 */

/** How fast the painting stirs when playing starts, and settles when it stops, per second. */
const STIRRING = 1.2;
/** Effect time runs at a quarter speed once nothing plays. */
const STOPPED_PACE = 0.25;

export interface Air {
  /** 1 while something plays, easing to 0 once it stops. */
  life: number;
  /** Seconds of effect time, which slows once nothing plays. */
  time: number;
}

/** A listener fed each frame whether anything plays, saying how stirred the weather is. */
export function listenToAir() {
  let air: Air = { life: 0, time: 0 };
  return ({ playing, seconds }: { playing: boolean; seconds: number }): Air => {
    const life = air.life + ((playing ? 1 : 0) - air.life) * Math.min(1, seconds * STIRRING);
    air = { life, time: air.time + seconds * (STOPPED_PACE + (1 - STOPPED_PACE) * life) };
    return air;
  };
}
