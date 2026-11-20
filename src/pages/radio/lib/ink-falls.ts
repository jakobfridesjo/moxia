/*
 * Falling water as mist rather than strokes: a soft veil down the painted sheet whose long, faint
 * streaks pour slowly, finer threads of water down its middle, its edges fraying, with vapour
 * drifting up through it and the whole fading into mist toward its foot. Worked out per point from the one tiling ink noise, the same way on
 * the GPU (`FALLS_SHADER`) as on the CPU (`fallsAt`), so either may draw it. Points are in the
 * weather layer's units.
 */

type Rgb = [number, number, number];
/** A sheet of falling water as rows of centre x, y and half width, top to bottom. */
export type Rows = [number, number, number][];

/** At most this many rows. */
export const MAX_ROWS = 8;

export interface FallsLook {
  rows: Rows;
  /** How far the water has fallen, in units, as `pour` wraps it. */
  flow: number;
  /** Seconds the vapour has drifted. */
  time: number;
  light: Rgb;
  /** How thick the pouring veil and the vapour lie. */
  alpha: { sheet: number; steam: number };
}

/** How far the vapour spreads past the sheet, in half widths. */
const SPREAD = 3;
/** The share of the falls' height over which it fades into mist at its foot. */
const FADE = 0.12;
/** How many texels of noise a unit down the broad streaks spans: long, so they pour calmly. The fine threads span twice as many, so both tile where `pour` wraps. */
const STREAK_LENGTH = 0.1;

/** How far the streaks have fallen after `fallen` units, wrapped to where their noise tiles. */
export const pour = (fallen: number) => fallen % (256 / STREAK_LENGTH);

/** The box the falls may touch, in units: left, top, width, height. */
export function fallsBox(rows: Rows): [number, number, number, number] {
  const reach = Math.max(...rows.map(([, , half]) => half)) * SPREAD;
  const left = Math.min(...rows.map(([x]) => x)) - reach;
  const right = Math.max(...rows.map(([x]) => x)) + reach;
  const top = rows[0][1] - 10;
  const bottom = rows[rows.length - 1][1] + 15;
  return [left, top, right - left, bottom - top];
}

const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** The 256-square tiling `noise` at `x`, `y` texels, drawn between its texels. */
function sample(noise: Float32Array, x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const at = (dx: number, dy: number) => noise[((iy + dy) & 255) * 256 + ((ix + dx) & 255)];
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx;
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx;
  return top + (bottom - top) * fy;
}

/** Where the sheet is at `y`: its centre and half width, held at its ends above the top and below the foot. */
export function sheetAt(rows: Rows, y: number): [number, number] {
  let i = 0;
  while (i < rows.length - 2 && y > rows[i + 1][1]) i++;
  const [ax, ay, ah] = rows[i];
  const [bx, by, bh] = rows[i + 1];
  const k = Math.min(1, Math.max(0, (y - ay) / Math.max(by - ay, 1e-3)));
  return [ax + (bx - ax) * k, ah + (bh - ah) * k];
}

/** How much light lies at `x`, `y`. */
export function fallsAt(noise: Float32Array, look: FallsLook, x: number, y: number) {
  const { rows, flow, time, alpha } = look;
  const [centre, half] = sheetAt(rows, y);
  const top = rows[0][1];
  const bottom = rows[rows.length - 1][1];
  const fade = (bottom - top) * FADE;
  const across = x - centre;
  const u = across / half;

  const rag = sample(noise, y * 0.3 + time * 1.5, u < 0 ? 31 : 157);
  const sheet =
    (1 - smoothstep(0.35 + 0.4 * rag, 1.05 + 0.3 * rag, Math.abs(u))) *
    smoothstep(top, top + 30, y) *
    (1 - smoothstep(bottom - fade, bottom, y));
  const streaks = sample(noise, across * 5, (y - flow) * STREAK_LENGTH);
  const threads = sample(noise, across * 14 + 101, (y - flow) * STREAK_LENGTH * 2 + 53);
  const core = 1 - smoothstep(0.2, 0.8, Math.abs(u));
  const water =
    sheet *
    (0.5 + 0.5 * smoothstep(0.4, 0.68, streaks) + 0.6 * core * smoothstep(0.5, 0.68, threads));

  const mist =
    sample(noise, x * 0.9 + time * 0.6 + 17, (y + time * 3) * 0.9 + 89) * 0.75 +
    sample(noise, x * 2 - time * 0.8 + 61, (y + time * 4.5) * 1.8 + 7) * 0.25;
  const steam =
    Math.exp(-((u / 1.5) ** 2)) *
    smoothstep(top, top + 60, y) *
    (1 - smoothstep(bottom - fade / 2, bottom + 15, y)) *
    smoothstep(0.38, 0.78, mist);
  return Math.min(1, alpha.sheet * water + alpha.steam * steam);
}

/** `fallsAt` on the GPU: `u_place` maps the target's pixels to units, as offset x, y and pixels a unit. */
export const FALLS_SHADER = `#version 300 es
precision highp float;
uniform highp sampler2D u_noise;
uniform vec3 u_rows[${MAX_ROWS}];
uniform int u_count;
uniform vec3 u_place;
uniform float u_flow;
uniform float u_time;
uniform vec3 u_light;
uniform vec2 u_alpha;
in vec2 v_px;
out vec4 color;
/** The noise drawn between its texels, as \`sample\` draws it. */
float noiseAt(vec2 p) {
  return texture(u_noise, (mod(p, 256.) + .5) / 256.).r;
}
void main() {
  vec2 p = (v_px - u_place.xy) / u_place.z;
  float top = u_rows[0].y;
  float bottom = u_rows[u_count - 1].y;
  if (p.y <= top || p.y >= bottom + 15.0) {
    color = vec4(0);
    return;
  }
  vec3 a = u_rows[0];
  vec3 b = u_rows[1];
  for (int i = 1; i < ${MAX_ROWS}; i++) {
    if (i >= u_count) break;
    a = u_rows[i - 1];
    b = u_rows[i];
    if (p.y <= b.y) break;
  }
  float k = clamp((p.y - a.y) / max(b.y - a.y, 1e-3), 0.0, 1.0);
  float centre = a.x + (b.x - a.x) * k;
  float half_ = a.z + (b.z - a.z) * k;
  float fade = (bottom - top) * ${FADE.toFixed(2)};
  float across = p.x - centre;
  float u = across / half_;

  // The sheet's ragged edge reaches 1.35 half widths at most; past it, and past the foot, only vapour.
  float water = 0.0;
  if (abs(u) < 1.35 && p.y < bottom) {
    float rag = noiseAt(vec2(p.y * 0.3 + u_time * 1.5, u < 0.0 ? 31.0 : 157.0));
    float sheet = (1.0 - smoothstep(0.35 + 0.4 * rag, 1.05 + 0.3 * rag, abs(u)))
      * smoothstep(top, top + 30.0, p.y)
      * (1.0 - smoothstep(bottom - fade, bottom, p.y));
    if (sheet > 0.0) {
      float streaks = noiseAt(vec2(across * 5.0, (p.y - u_flow) * ${STREAK_LENGTH.toFixed(2)}));
      float core = 1.0 - smoothstep(0.2, 0.8, abs(u));
      float threads = core > 0.0 ? noiseAt(vec2(across * 14.0 + 101.0, (p.y - u_flow) * ${(STREAK_LENGTH * 2).toFixed(2)} + 53.0)) : 0.0;
      water = sheet
        * (0.5 + 0.5 * smoothstep(0.4, 0.68, streaks) + 0.6 * core * smoothstep(0.5, 0.68, threads));
    }
  }

  float steam = exp(-(u / 1.5) * (u / 1.5))
    * smoothstep(top, top + 60.0, p.y)
    * (1.0 - smoothstep(bottom - fade * 0.5, bottom + 15.0, p.y));
  if (steam > 1e-4) {
    float mist = noiseAt(vec2(p.x * 0.9 + u_time * 0.6 + 17.0, (p.y + u_time * 3.0) * 0.9 + 89.0)) * 0.75
      + noiseAt(vec2(p.x * 2.0 - u_time * 0.8 + 61.0, (p.y + u_time * 4.5) * 1.8 + 7.0)) * 0.25;
    steam *= smoothstep(0.38, 0.78, mist);
  } else {
    steam = 0.0;
  }
  float light = min(1.0, u_alpha.x * water + u_alpha.y * steam);
  color = vec4(u_light * light, light);
}`;
