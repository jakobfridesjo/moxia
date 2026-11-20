import type { CountryCode, LocalWeather } from "@/shared/api/commands.ts";
import type { Air } from "@/pages/radio/lib/air.ts";
import type { Scene } from "@/pages/radio/lib/ink-painter.ts";
import type { InkGL } from "@/pages/radio/lib/ink-gl.ts";
import { COMMON } from "@/pages/radio/lib/ink-day.ts";

/*
 * The real sky where the station is, over any painting, by day and by night: rain, snow, fog,
 * lightning, the grey of an overcast day and the warmth of dawn and dusk. One shader over the
 * whole screen, drawn in front of the figures, that only lays colour over the painting.
 */

/** The weather each painting shows when the real weather is not known: as each was painted. */
const PAINTED: Record<CountryCode, LocalWeather> = {
  CN: { rain: 0, snow: 0, cloud: 0.2, fog: 0, wind: 0.2, storm: false },
  TW: { rain: 0.5, snow: 0, cloud: 0.6, fog: 0, wind: 0.2, storm: false },
  HK: { rain: 0, snow: 0, cloud: 0, fog: 0, wind: 0, storm: false },
  MO: { rain: 0, snow: 0, cloud: 0, fog: 0, wind: 0.2, storm: false },
};

/** What a painting shows of `weather`, or of its own painted weather while the real one is not known. */
export const weatherFor = (region: CountryCode, weather: LocalWeather | null) =>
  weather ?? PAINTED[region];

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** How much moonlight reaches a painting, 0 to 1: as much as the moon is lit, less through cloud or fog. */
export const moonlight = ({ weather, moon }: SkyNow) =>
  (0.3 + 0.7 * moon) * (1 - 0.85 * smoothstep(0.4, 0.95, weather.cloud)) * (1 - 0.6 * weather.fog);

/** Effect time a reduced-motion frame holds at. */
const STILL_TIME = 23.7;

export const SKY = `${COMMON}
/** Streaks of rain in three depths, slanting with the wind, thicker the harder it rains. */
float rain(vec2 css, float amount, float wind) {
  float a = 0.;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float k = 1. - fi * .3;
    vec2 r = vec2(css.x - css.y * (.17 + .5 * wind), css.y);
    float w = 7. + fi * 4.;
    float c = floor(r.x / w);
    float h = hash12(vec2(c, fi * 13.));
    float speed = (640. + 260. * h) * k;
    float seg = 150. + 90. * fi;
    float y = r.y - u_time * speed + h * 977.;
    float idx = floor(y / seg);
    float on = step(1. - .8 * amount, hash12(vec2(c, idx + fi * 91.)));
    float f = fract(y / seg) * seg;
    float len = (18. + 18. * h) * k;
    float s = step(f, len) * (f / len);
    float dx = (fract(r.x / w) - (.3 + .4 * hash12(vec2(c, 7. + fi)))) * w;
    float line = smoothstep(1.4 * k + .8, 0., abs(dx));
    a += line * s * on * (.05 * k + .018);
  }
  // Half is the soft rain Taiwan's river was painted with; more is a downpour.
  return min(a * (.4 + 1.2 * amount + 2. * max(amount - .5, 0.)), .32);
}
/** Soft flakes in three depths, each swaying on its own and drifting with the wind: a white heart and a grey halo. */
vec2 snow(vec2 css, float amount, float wind) {
  vec2 a = vec2(0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float k = 1. - fi * .28;
    float G = 34. - fi * 8.;
    vec2 q = css + vec2(-u_time * wind * 70. * k, -u_time * (34. + 16. * fi) * k) + fi * 211.;
    vec2 cell = floor(q / G);
    if (hash12(cell + fi * 37.) > .25 + .55 * amount) continue;
    vec2 h = hash22(cell + fi * 5.);
    vec2 sway = vec2(sin(u_time * (.6 + .5 * h.y) + h.x * 6.28) * G * .22, 0.);
    vec2 off = q - (cell + .2 + .6 * h) * G - sway;
    float radius = (1.8 + 2. * h.y) * k;
    float d = length(off);
    float near = .55 + .45 * k;
    a = max(a, vec2(smoothstep(radius, radius * .4, d), smoothstep(radius * 2.2, radius * .6, d)) * near);
  }
  return a;
}
/** A flash of lightning every few seconds, flickering twice. */
float lightning() {
  float slot = floor(u_time / 6.);
  if (hash12(vec2(slot, 3.1)) < .55) return 0.;
  float t = u_time - slot * 6. - 4. * hash12(vec2(slot, 8.7));
  return gauss(t / .06) + .6 * gauss((t - .22) / .08);
}
void main() {
  vec2 css = v_px / u_ratio;
  vec2 view = u_target / u_ratio;
  float v = css.y / view.y;
  float inkA = texture(u_ink, v_px / u_target).a;
  float night = u_air.w;
  vec4 acc = vec4(0);
  // Dawn and dusk warm the sky, most at the top, and the paper more than the ink.
  lay(acc, vec3(1., .7, .45), u_air.z * .14 * smoothstep(1.1, 0., v) * (1. - .6 * inkA) * (1. - night));
  // An overcast day greys everything a little; at night dark cloud drifts across the sky, hiding the moon.
  lay(acc, vec3(.5, .52, .55), smoothstep(.5, 1., u_weather.z) * .07 * (1. - night));
  if (night > .5 && u_weather.z > .3) {
    float cloud = fbm(vec2(css.x * .003 - u_time * (.006 + .03 * u_air.x), css.y * .006));
    lay(acc, vec3(.06, .07, .09), smoothstep(.3, 1., u_weather.z) * smoothstep(.35, .7, cloud) * .35 * smoothstep(.75, 0., v));
  }
  // Fog hangs in banks, thickest low down, and drifts with the wind.
  float fog = u_weather.w;
  if (fog > 0.) {
    float n = fbm(vec2(css.x * .004 + u_time * (.01 + .04 * u_air.x), css.y * .007 + u_time * .004));
    vec3 tone = mix(vec3(.957, .941, .91), vec3(.42, .44, .48), night);
    lay(acc, tone, fog * (.18 + .3 * smoothstep(.2, 1., v)) * smoothstep(.25, .75, n + .15));
  }
  if (u_moving > .5) {
    float wind = u_air.x;
    if (u_weather.x > 0.) lay(acc, mix(vec3(.58, .6, .63), vec3(.74, .77, .82), night), rain(css, u_weather.x, wind) * mix(1., .8, night));
    if (u_weather.y > 0.) {
      vec2 flake = snow(css, u_weather.y, wind);
      // A grey halo so a flake reads on pale paper, as snow is painted: by the ink left out round it.
      lay(acc, vec3(.55, .56, .6), flake.y * .38 * (1. - night));
      lay(acc, vec3(1.), flake.x * mix(.95, .75, night));
    }
    if (u_air.y > .5) {
      float flash = lightning();
      lay(acc, vec3(.93, .95, 1.), flash * mix(.22, .38, night) * (1. - .7 * inkA));
    }
  }
  color = acc;
}`;

interface Moment {
  scene: Scene;
  air: Air;
  still: boolean;
}

export interface Sky {
  /** The weather in front of the figures; `ctx` draws in leaf units. Flush `gl` after. */
  draw: (ctx: CanvasRenderingContext2D, moment: Moment) => void;
}

/** What the sky over a painting holds now, as `makeSky` draws it. */
export interface SkyNow {
  weather: LocalWeather;
  /** The warmth of dawn or dusk, 0 to 1. */
  glow: number;
  night: boolean;
  /** How much of the moon is lit, 0 at new moon to 1 at full. */
  moon: number;
}

/** The sky over the paintings, reading what it holds from `now` each frame; null where the GPU can't draw it well. */
export function makeSky(gl: InkGL | null, now: () => SkyNow): Sky | null {
  if (!gl || gl.software) return null;
  return {
    draw: (ctx, { scene, air, still }) => {
      const { weather, glow, night } = now();
      // A clear sky lays nothing, so it is not drawn: by day cloud greys only once heavy, and dusk warms; by night cloud drifts.
      const falling = !still && (weather.rain > 0 || weather.snow > 0 || weather.storm);
      const hung =
        weather.fog > 0 || (night ? weather.cloud > 0.3 : weather.cloud > 0.5 || glow > 0);
      if (!falling && !hung) return;
      const m = ctx.getTransform();
      const { width, height } = ctx.canvas;
      gl.day({
        place: "SKY",
        rect: [0, 0, width, height],
        ink: scene.ink,
        leaf: [m.e, m.f, m.a],
        time: still ? STILL_TIME : air.time,
        ratio: Math.min(2, window.devicePixelRatio || 1),
        moving: !still,
        over: false,
        weather: [weather.rain, weather.snow, weather.cloud, weather.fog],
        air: [weather.wind, weather.storm ? 1 : 0, glow, night ? 1 : 0],
      });
    },
  };
}
