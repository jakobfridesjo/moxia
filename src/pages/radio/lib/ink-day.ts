import type { CountryCode } from "@/shared/api/commands.ts";
import type { Air } from "@/pages/radio/lib/air.ts";
import type { Scene } from "@/pages/radio/lib/ink-painter.ts";
import type { InkLayers } from "@/pages/radio/lib/ink-gl.ts";
import type { SkyNow } from "@/pages/radio/lib/ink-sky.ts";

/*
 * The radio's paintings by day, where the night has its lights: soft rain on Taiwan's river, sun
 * on Macau's gorge, and in Hong Kong a shaft of light through a temple's incense. Each place is one
 * shader over the whole screen that only lays colour over the painting, never moving its ink;
 * what lies on the water is kept out of the ink by the scene's ink layer. It needs the GPU, and is
 * left out where WebGL runs on the CPU: there the day stays as it was. Points are in leaf units.
 */

export type DayPlace = "TW" | "MO" | "HK";

/** Left, top, right, bottom and how far its edges fade, in leaf units. */
interface Erased {
  box: [number, number, number, number];
  feather: number;
}

/** Su Dongpo's painted incense, which the day's live smoke takes the place of. */
const PAINTED_SMOKE: Erased = { box: [-20, 340, 388, 800], feather: 16 };

/** Effect time a reduced-motion frame holds at. */
const STILL_TIME = 23.7;

export const COMMON = `#version 300 es
precision highp float;
uniform sampler2D u_ink;
/** \`hash12\` at each whole point of a repeating 256 square, as \`dayLattice\` works it out. */
uniform sampler2D u_lattice;
uniform vec2 u_target;
uniform vec3 u_leaf;
uniform float u_time;
uniform float u_ratio;
uniform float u_moving;
uniform float u_over;
/** The weather where the station is, each 0 to 1: rain, snow, cloud and fog. */
uniform vec4 u_weather;
/** Wind 0 to 1, lightning 0 or 1, the warmth of dawn or dusk 0 to 1, and 1 at night. */
uniform vec4 u_air;
in vec2 v_px;
out vec4 color;
const vec3 MIST = vec3(.957, .941, .91);
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
/** Value noise: the lattice drawn between its points by the texture unit, eased as \`smoothstep\` eases. */
float noise(vec2 p) {
  vec2 f = fract(p);
  return texture(u_lattice, (mod(floor(p), 256.) + f * f * (3. - 2. * f) + .5) / 256.).r;
}
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; } return s; }
float segDist2(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; vec2 off = pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return dot(off, off); }
float gauss(float x) { return exp(-x * x); }
/** Colour \`c\` laid over what \`acc\` holds at \`a\`, premultiplied, as a 2D canvas's source-over. */
void lay(inout vec4 acc, vec3 c, float a) { a = clamp(a, 0., 1.); acc = vec4(c * a, a) + acc * (1. - a); }
/** How much of the sun gets through: all under a clear sky, little once it is overcast or foggy. */
float sunny() { return (1. - smoothstep(.35, .95, u_weather.z)) * (1. - .7 * u_weather.w); }
`;

const TW = `${COMMON}
float riverTop(float x) {
  if (x < 420.) return mix(1118., 1098., x / 420.);
  if (x < 560.) return mix(1098., 965., (x - 420.) / 140.);
  return mix(965., 925., (x - 560.) / 451.);
}
float ripples(vec2 p, out float inner) {
  vec2 q = vec2(p.x, p.y * 3.2);
  float C = 52.;
  vec2 cell = floor(q / C);
  float ring = 0.;
  inner = 0.;
  for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
    vec2 id = cell + vec2(ox, oy);
    if (hash12(id + 3.7) < .62) continue;
    vec2 h = hash22(id);
    vec2 c = (id + .2 + .6 * h) * C;
    float period = 1.3 + 1.4 * hash12(id + 9.1);
    float ph = fract(u_time / period + h.x * 7.);
    float d = length(q - c);
    float w = 3.4 + ph * 5.;
    float fade = (1. - ph) * (1. - ph);
    float r = (d - ph * C * .95) / w;
    ring += gauss(r) * fade;
    inner += gauss(r + 1.6) * fade;
  }
  return ring;
}
void main() {
  vec2 css = v_px / u_ratio;
  vec2 view = u_target / u_ratio;
  vec2 p = (v_px - u_leaf.xy) / u_leaf.z;
  vec4 acc = vec4(0);
  float v = css.y / view.y;
  if (v < .75) {
    float cloud = fbm(vec2(css.x * .006 + u_time * .012, css.y * .011));
    lay(acc, vec3(0), (.035 + .09 * cloud) * (.5 + u_weather.z) * smoothstep(.75, 0., max(v, 0.)));
  }
  float rain = u_weather.x;
  if (u_moving > .5 && rain > 0.) {
    float water = smoothstep(0., 14., p.y - riverTop(p.x)) * smoothstep(1415., 1385., p.y) * step(0., p.x) * step(p.x, 1011.);
    if (water > 0.) {
      float m = water * (1. - texture(u_ink, v_px / u_target).a);
      if (m > 0.) {
        float inner;
        float ring = ripples(p, inner);
        float k = min(1., rain * 2.);
        lay(acc, vec3(.45, .47, .5), ring * .1 * m * k);
        lay(acc, vec3(.99), inner * .14 * m * k);
      }
    }
  }
  color = acc;
}`;

const MO = `${COMMON}
/** The stream's banks (39 points), the stone in it (10) and the fall (8), each closed. */
const vec2 OUTLINES[57] = vec2[57](vec2(591,1155),vec2(581,1165),vec2(579,1185),vec2(551,1199),vec2(541,1215),vec2(556,1234),vec2(570,1245),vec2(528,1249),vec2(500,1256),vec2(479,1268),vec2(460,1288),vec2(456,1312),vec2(471,1331),vec2(488,1349),vec2(496,1368),vec2(462,1375),vec2(387,1386),vec2(312,1397),vec2(246,1412),vec2(181,1425),vec2(87,1443),vec2(-11,1473),vec2(-11,1605),vec2(298,1605),vec2(256,1537),vec2(246,1495),vec2(270,1462),vec2(307,1432),vec2(350,1420),vec2(406,1424),vec2(462,1435),vec2(509,1439),vec2(560,1435),vec2(593,1418),vec2(610,1382),vec2(619,1331),vec2(619,1270),vec2(614,1204),vec2(604,1155),vec2(540,1318),vec2(555,1306),vec2(590,1306),vec2(612,1320),vec2(604,1376),vec2(580,1386),vec2(560,1396),vec2(532,1394),vec2(526,1368),vec2(536,1340),vec2(608,85),vec2(652,85),vec2(648,300),vec2(641,450),vec2(636,560),vec2(600,560),vec2(606,450),vec2(612,300));
/** Whether \`p\` lies inside the outline of \`count\` points from \`first\` in \`OUTLINES\`. */
bool inside(vec2 p, int first, int count) {
  bool c = false;
  for (int i = 0; i < count; i++) {
    vec2 a = OUTLINES[first + i], b = OUTLINES[first + (i == 0 ? count - 1 : i - 1)];
    if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
/** How far \`p\` lies from that outline's nearest edge, in units. */
float fromEdge(vec2 p, int first, int count) {
  float d = 1e10;
  for (int i = 0; i < count; i++) d = min(d, segDist2(p, OUTLINES[first + i], OUTLINES[first + (i == 0 ? count - 1 : i - 1)]));
  return sqrt(d);
}
/** How far inside the stream \`p\` lies from its nearest bank, in units; 0 outside it. */
float fromStreamBank(vec2 p) {
  if (p.x > 620. || p.y < 1155. || p.y > 1605. || !inside(p, 0, 39)) return 0.;
  return fromEdge(p, 0, 39);
}
float stoneMask(vec2 p) {
  if (p.x < 521. || p.x > 617. || p.y < 1301. || p.y > 1401.) return 0.;
  return inside(p, 39, 10) ? 1. : smoothstep(5., 0., fromEdge(p, 39, 10));
}
float fallMask(vec2 p) {
  if (p.x < 600. || p.x > 652. || p.y < 85. || p.y > 560. || !inside(p, 49, 8)) return 0.;
  return smoothstep(0., 8., fromEdge(p, 49, 8));
}
void main() {
  vec2 css = v_px / u_ratio;
  vec2 view = u_target / u_ratio;
  vec2 p = (v_px - u_leaf.xy) / u_leaf.z;
  float inkA = texture(u_ink, v_px / u_target).a;
  vec4 acc = vec4(0);
  // Sunbeams from over the cliff top, where the night's moonbeams come in, the rest shaded so they read.
  vec2 d = p - vec2(315., -15.);
  float ang = atan(d.y, d.x);
  float span = smoothstep(1.58, 1.72, ang) * smoothstep(2.22, 2.06, ang);
  float L = 0.;
  if (span > 0.) {
    float rays = smoothstep(.45, .9, noise(vec2(ang * 38., u_time * .05)) * .6 + noise(vec2(ang * 95. + 3., u_time * .035)) * .4);
    L = span * rays * smoothstep(1500., 120., length(d)) * .85 * sunny();
  }
  lay(acc, vec3(0), .07 * (1. - L));
  lay(acc, vec3(1., .975, .92), .3 * L * (1. - .8 * inkA));
  lay(acc, vec3(1., .93, .8), .25 * sunny() * smoothstep(686., 0., length(p - vec2(200., -1.))) * (1. - inkA));
  // The stream in ink and paper, never on the stone.
  float fromBank = inkA < .5 ? fromStreamBank(p) : 0.;
  if (fromBank > 0.) {
    float water = smoothstep(0., 7., fromBank) * (1. - stoneMask(p)) * (1. - smoothstep(.15, .5, inkA));
    // A pale grey wash along the banks, uneven as a brush leaves it, the paper whiter mid-stream.
    float midStream = smoothstep(8., 45., fromBank);
    lay(acc, vec3(.66, .66, .65), (.14 * (1. - midStream) + .04 + .05 * (fbm(p * .012) - .5)) * water);
    lay(acc, vec3(.99, .985, .975), .2 * midStream * water);
  }
  // Light running down the fall, and spray where it breaks.
  if (p.x > 560. && p.y < 720.) {
    float fall = fallMask(p) * u_moving;
    if (fall > 0.) {
      float sparkle = smoothstep(.72, .95, noise(vec2(p.x * .35, p.y * .022 - u_time * 2.4))) * (.5 + .5 * noise(vec2(p.x * .1, u_time * 3.)));
      lay(acc, vec3(1.), sparkle * .7 * fall);
    }
    vec2 foot = (p - vec2(612., 585.)) * vec2(1., 1.5);
    float near = smoothstep(110., 15., length(foot));
    if (near > 0.) lay(acc, MIST, smoothstep(.45, .8, fbm(p * .018 + vec2(0., u_time * .35))) * near * .8);
  }
  // Morning mist in banks from the figures' waists down, where the night's fog lies.
  float v = css.y / view.y;
  vec4 banks[4] = vec4[4](vec4(.66, .024, .3, 0.), vec4(.74, -.018, .4, 1.), vec4(.83, .03, .45, 2.), vec4(.93, -.022, .5, 3.));
  for (int i = 0; i < 4; i++) {
    vec4 b = banks[i];
    float m = gauss((v - b.x) / .05);
    if (m < .01) continue;
    float n = fbm(vec2(css.x / view.x * 2.6 + u_time * b.y * 3., v * 9. + b.w * 3.1));
    lay(acc, MIST, m * smoothstep(.32, .75, n) * b.z * 1.5);
  }
  color = acc;
}`;

const HK = `${COMMON}
const vec2 WINDOW = vec2(900., -300.);
const vec2 DIR = vec2(-.4789, .8779);
const vec2 TIP = vec2(336., 800.);
const vec2 RISE[7] = vec2[7](vec2(0., 336.), vec2(98., 290.), vec2(158., 215.), vec2(230., 165.), vec2(307., 150.), vec2(390., 95.), vec2(470., 50.));
float shaftAt(vec2 p) {
  vec2 q = p - WINDOW;
  float along = dot(q, DIR);
  float e = dot(q, vec2(-DIR.y, DIR.x));
  float half_ = 95. + max(along, 0.) * .1;
  float within = smoothstep(half_, half_ * .55, abs(e)) * smoothstep(0., 260., along) * smoothstep(2100., 1350., along);
  if (within <= 0.) return 0.;
  return within * (.66 + .22 * noise(vec2(e * .014, u_time * .025)) + .12 * noise(vec2(e * .045 + 7., u_time * .02)));
}
float riseX(float h) {
  for (int i = 1; i < 7; i++)
    if (h < RISE[i].x) return mix(RISE[i - 1].y, RISE[i].y, (h - RISE[i - 1].x) / (RISE[i].x - RISE[i - 1].x));
  return RISE[6].y;
}
/** The incense smoke: a thin thread from the stick's tip that wavers, then tears into strands. */
float smokeAt(vec2 p) {
  float h = TIP.y - p.y;
  if (h < -6. || h > 560.) return 0.;
  float hh = max(h, 0.);
  float amp = min(hh * .1, 34.);
  float x = riseX(hh) + amp * sin(hh * .032 - u_time * 1.35) + amp * .45 * sin(hh * .071 - u_time * 2.1 + 1.7);
  float turb = smoothstep(30., 240., hh);
  float width = 2.6 + hh * .05;
  // Past the furthest the warp and the haze reach, nothing shows.
  if (abs(p.x - x) > 45. * turb + width * 6.) return 0.;
  float warp = turb > 0. ? (fbm(vec2(p.x * .018, p.y * .016 + u_time * .45)) - .5) * 90. * turb : 0.;
  float dx = p.x - x + warp + (noise(p * .07 + vec2(0., u_time * .8)) - .5) * width * 1.2;
  float haze = exp(-dx * dx / (width * width * 6.));
  float core = exp(-dx * dx / (width * width)) * .7 + haze * .35;
  if (turb > 0.) core *= mix(1., smoothstep(.22, .7, fbm(vec2(dx * .05 + 3., (p.y + u_time * 38.) * .011))) * 1.6, turb);
  core *= .45 + .9 * fbm(p * .055 + vec2(0., u_time * .5));
  return core * smoothstep(-6., 10., h) * smoothstep(560., 220., hh) * clamp(9. / width, .4, 1.);
}
/** Fine dust falling through the light, each point wandering and fading on its own. */
vec4 dust(float sh) {
  vec4 acc = vec4(0);
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    vec2 drift = v_px + vec2(u_time * (.35 - .2 * fl), -u_time * (2.1 - .8 * fl)) * u_ratio + fl * 517.;
    float G = 11. + fl * 4.;
    vec2 cell = floor(drift / G);
    if (hash12(cell + fl * 71.) <= .62 + fl * .1) continue;
    vec2 r1 = hash22(cell + 13. + fl * 5.);
    vec2 r2 = hash22(cell + 41. + fl * 3.);
    vec2 wander = vec2(
      sin(u_time * (.07 + .16 * r1.x) + r2.x * 6.28) + .5 * sin(u_time * (.19 + .2 * r2.y) + r1.y * 9.),
      sin(u_time * (.06 + .15 * r1.y) + r2.y * 6.28) + .5 * sin(u_time * (.17 + .22 * r2.x) + r1.x * 7.)
    ) * G * .2;
    vec2 off = drift - (cell + .5) * G - wander;
    float dd = dot(off, off);
    if (dd > 6.) continue;
    float beat = u_time * (.2 + .3 * hash12(cell + 31.)) + hash12(cell + 19.) * 40.;
    float flicker = mix(hash12(cell + floor(beat)), hash12(cell + floor(beat) + 1.), smoothstep(0., 1., fract(beat)));
    lay(acc, vec3(1., .9, .66), exp(-dd / .7) * smoothstep(.1, .7, flicker) * sh * 1.4);
  }
  return acc;
}
void main() {
  vec2 p = (v_px - u_leaf.xy) / u_leaf.z;
  float sh = shaftAt(p) * mix(.3, 1., sunny());
  // The dust is drawn in a pass of its own, over the figures, so it falls in front of him.
  if (u_over > .5) {
    color = u_moving > .5 && sh > .01 ? dust(sh) : vec4(0);
    return;
  }
  float inkA = texture(u_ink, v_px / u_target).a;
  vec4 acc = vec4(0);
  // The temple is dim; the shaft from a high window lights him and the smoke it passes through.
  float lit = sh * (1. - .5 * inkA);
  lay(acc, vec3(0), .2 * (1. - lit));
  lay(acc, vec3(1., .96, .88), .25 * lit * (1. - .7 * inkA));
  float hazeAt = sh * smoothstep(1250., 250., p.y);
  if (hazeAt > 0.) {
    vec2 q = p * .0045;
    q.y += u_time * .045;
    float sm = fbm(q + fbm(q * 1.3 + vec2(u_time * .02, 0.)) * 1.25);
    lay(acc, vec3(1., .985, .95), smoothstep(.5, .78, sm) * hazeAt * .5);
  }
  if (p.x < 520. && p.y < 820.) {
    float d = smokeAt(p);
    if (d > 0.) {
      vec3 bright = mix(vec3(.66, .64, .61), vec3(1., .99, .96), smoothstep(.2, .75, d));
      lay(acc, mix(vec3(.44, .45, .47), bright, sh), d * mix(1., 1.35, sh) * mix(.62, 1., sh));
    }
  }
  color = acc;
}`;

/** The shaders' `hash12` at each whole point of a 256 square, row by row, in the GPU's 32-bit floats. */
export function dayLattice() {
  const f = Math.fround;
  const fract = (x: number) => f(x - Math.floor(x));
  const lattice = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const [a, b] = [fract(f(x * f(0.1031))), fract(f(y * f(0.1031)))];
      const k = f(33.33);
      const d = f(f(f(a * f(b + k)) + f(b * f(a + k))) + f(a * f(a + k)));
      lattice[y * 256 + x] = fract(f(f(f(a + d) + f(b + d)) * f(a + d)));
    }
  return lattice;
}

/** Each place's day, as a fragment shader over `VERTEX` in ink-gl. */
export const DAY_SHADERS: Record<DayPlace, string> = { TW, MO, HK };

interface Moment {
  scene: Scene;
  air: Air;
  still: boolean;
}

export interface Day {
  /** What of the painted leaf the day draws live instead, to leave out when it is painted. */
  erased: Erased | null;
  /** The day's weather and light, queued on the layer under the figures; `ctx` says where leaf units lie. */
  draw: (ctx: CanvasRenderingContext2D, moment: Moment) => void;
  /** What falls in front of the figures (Hong Kong's dust), queued on the layer over them. */
  over: (ctx: CanvasRenderingContext2D, moment: Moment) => void;
}

/** The part of the screen the shaft may light, in its pixels. */
function shaftRect(m: DOMMatrix, width: number, height: number): [number, number, number, number] {
  const [left, top, right, bottom] = SHAFT;
  const x0 = Math.max(0, m.a * left + m.e);
  const y0 = Math.max(0, m.d * top + m.f);
  const x1 = Math.min(width, m.a * right + m.e);
  const y1 = Math.min(height, m.d * bottom + m.f);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

const isDayPlace = (region: CountryCode): region is DayPlace =>
  region === "TW" || region === "MO" || region === "HK";

/** Where Hong Kong's light shaft, and the dust in it, may reach, in leaf units: left, top, right and bottom. */
const SHAFT: [number, number, number, number] = [-400, -400, 1000, 1750];

/** `region`'s day under the sky `now` says it has, or null where it has none. */
export function makeDay(region: CountryCode, layers: InkLayers, now: () => SkyNow): Day | null {
  if (!isDayPlace(region)) return null;
  const queue = (ctx: CanvasRenderingContext2D, { scene, air, still }: Moment, over: boolean) => {
    const { weather, glow, night } = now();
    const m = ctx.getTransform();
    const { width, height } = ctx.canvas;
    const gl = over ? layers.over : layers.under;
    gl.day({
      place: region,
      rect: over ? shaftRect(m, width, height) : [0, 0, width, height],
      ink: scene.ink,
      leaf: [m.e, m.f, m.a],
      time: still ? STILL_TIME : air.time,
      ratio: Math.min(2, window.devicePixelRatio || 1),
      moving: !still,
      over,
      weather: [weather.rain, weather.snow, weather.cloud, weather.fog],
      air: [weather.wind, weather.storm ? 1 : 0, glow, night ? 1 : 0],
    });
  };
  return {
    erased: region === "HK" ? PAINTED_SMOKE : null,
    draw: (ctx, moment) => queue(ctx, moment, false),
    over: (ctx, moment) => {
      if (region === "HK" && !moment.still) queue(ctx, moment, true);
    },
  };
}
