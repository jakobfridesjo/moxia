/*
 * What lies over the paintings and is the same everywhere it spreads (mist, the night's light,
 * the dark, a new place soaking in) worked out per pixel on the GPU with WebGL2, instead of in
 * canvas passes that each blend across the screen. Draws are queued and land on a 2D canvas in
 * one go at `flush`, so they stay in order with what the 2D canvas draws between them. Without
 * WebGL2, or once its context is lost, `createInkGL` gives null or `ready` turns false, and the
 * callers draw in 2D as before.
 */

import { inkNoise } from "@/pages/radio/lib/ink-weather.ts";
import { FALLS_SHADER, MAX_ROWS, type FallsLook } from "@/pages/radio/lib/ink-falls.ts";
import { DAY_SHADERS, dayLattice, type DayPlace } from "@/pages/radio/lib/ink-day.ts";
import { SKY } from "@/pages/radio/lib/ink-sky.ts";

/** x, y, width and height, in the target canvas's pixels. */
type Rect = [number, number, number, number];
type Rgb = [number, number, number];
type Source = HTMLCanvasElement | ImageBitmap;

interface MistDraw {
  rect: Rect;
  /** The tile of mist, 256 square, coloured and soft as `fogTile` makes it. */
  tile: HTMLCanvasElement;
  /** The size of the low-resolution scratch the 2D path works the band out at. */
  scratch: [number, number];
  /** Where the tile's pattern starts, and how big one of its texels is, in scratch pixels. */
  origin: [number, number];
  cell: [number, number];
  alpha: number;
  /** How much of the height, and of the width, fades in at each edge. */
  edge: number;
  side: number;
}

interface GlowDraw {
  rect: Rect;
  center: [number, number];
  radius: number;
  /** How much wider than tall the glow is. */
  stretch?: number;
  color: Rgb;
  /** [offset, alpha] pairs, as a canvas gradient's colour stops; at most eight. */
  stops: [number, number][];
}

interface ImageDraw {
  source: Source;
  rect: Rect;
  alpha: number;
  /** A canvas lying over the whole target whose alpha the image is kept to. */
  within?: Source;
}

interface BloomDraw {
  /** Where it starts, as fractions of the screen across and down. */
  origin: [number, number];
  seed: number;
  /** How far the soaked edge has reached, in the units `soaked` works in. */
  edge: number;
  cells: [number, number];
  ragged: number;
  soft: number;
  rim: number;
  ink: Rgb;
}

interface FallsDraw {
  rect: Rect;
  look: FallsLook;
  /** Where the layer's units lie on the target: offset x, y and pixels a unit. */
  place: [number, number, number];
}

interface DayDraw {
  /** A place's day, or the live sky over any painting. */
  place: DayPlace | "SKY";
  rect: Rect;
  /** The scene's ink, lying over the whole target: what lies on water stays out of it. */
  ink: Source;
  /** Where the leaf lies on the target: offset x, y and pixels a unit. */
  leaf: [number, number, number];
  time: number;
  /** Target pixels a CSS pixel, so rain and dust keep their size on any screen. */
  ratio: number;
  /** False when motion is reduced: rain, ripples, glints and dust are left out, the rest held still. */
  moving: boolean;
  /** Draws only what lies in front of the figures, for after they are drawn. */
  over: boolean;
  /** Rain, snow, cloud and fog where the station is, each 0 to 1. */
  weather: [number, number, number, number];
  /** Wind 0 to 1, lightning 0 or 1, the warmth of dawn or dusk 0 to 1, and 1 at night. */
  air: [number, number, number, number];
}

type Draw =
  | { kind: "mist"; draw: MistDraw }
  | { kind: "day"; draw: DayDraw }
  | { kind: "falls"; draw: FallsDraw }
  | { kind: "glow"; draw: GlowDraw }
  | { kind: "image"; draw: ImageDraw }
  | { kind: "group"; ink: Source; draws: Draw[] }
  | { kind: "bloom"; draw: BloomDraw; incoming: Source };

export interface InkGL {
  /** False once the context is lost, until it is restored. */
  readonly ready: boolean;
  /**
   * Whether WebGL itself runs on the CPU (SwiftShader, llvmpipe). Each flush then reads every
   * pixel back, which costs more than a full-screen draw in 2D does: worth it only where it
   * replaces several.
   */
  readonly software: boolean;
  mist: (draw: MistDraw) => void;
  glow: (draw: GlowDraw) => void;
  /** Falling water and its steam, as `fallsAt` works them out. */
  falls: (draw: FallsDraw) => void;
  /** A place's day weather and light, as `ink-day.ts` writes it. */
  day: (draw: DayDraw) => void;
  image: (draw: ImageDraw) => void;
  /** A veil of `color` over the whole target. */
  fill: (color: Rgb, alpha: number) => void;
  /** What `paint` queues, as light lying behind `ink`: cut away wherever it has ink. */
  behindInk: (ink: Source, paint: () => void) => void;
  /** Soaks `incoming` into `ctx`'s canvas, over whatever it already holds. */
  bloom: (ctx: CanvasRenderingContext2D, incoming: Source, draw: BloomDraw) => void;
  /** Draws everything queued onto `ctx`'s canvas, in one go. */
  flush: (ctx: CanvasRenderingContext2D) => void;
  dispose: () => void;
}

/** Soft things are worked out at this share of the target's resolution and drawn up. */
const SOFT_SCALE = 0.5;
/** Clear pixels kept around what a flush draws, wider than drawing it up ever reaches. */
const MARGIN = 2;
/** Left, top, right and bottom, in the target's pixels. */
type Edges = [number, number, number, number];
const NOWHERE: Edges = [Infinity, Infinity, -Infinity, -Infinity];
const union = (a: Edges, b: Edges): Edges => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];
/** Flushes a texture may go unused before it is let go. */
const TEXTURE_LIFE = 240;
const MAX_STOPS = 8;
const rgb = ([r, g, b]: Rgb): Rgb => [r / 255, g / 255, b / 255];
/** The texture unit textures are made on; draws sample units 0 and 1. */
const SPARE_UNIT = 7;

const VERTEX = `#version 300 es
uniform vec4 u_rect;
uniform vec2 u_target;
out vec2 v_local;
out vec2 v_px;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  v_local = corner;
  v_px = u_rect.xy + corner * u_rect.zw;
  vec2 ndc = v_px / u_target * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`;

const MIST = `#version 300 es
precision highp float;
uniform sampler2D u_tile;
uniform vec2 u_scratch;
uniform vec2 u_origin;
uniform vec2 u_cell;
uniform float u_alpha;
uniform float u_edge;
uniform float u_side;
in vec2 v_local;
out vec4 color;
float ramp(float t, float fade) {
  return fade <= 0.0 ? 1.0 : clamp(min(t, 1.0 - t) / fade, 0.0, 1.0);
}
void main() {
  vec2 texel = (v_local * u_scratch - u_origin) / u_cell;
  color = texture(u_tile, texel / 256.0) * (u_alpha * ramp(v_local.x, u_side) * ramp(v_local.y, u_edge));
}`;

const GLOW = `#version 300 es
precision highp float;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_stretch;
uniform vec3 u_color;
uniform vec2 u_stops[${MAX_STOPS}];
uniform int u_count;
in vec2 v_px;
out vec4 color;
void main() {
  vec2 d = v_px - u_center;
  d.x /= u_stretch;
  float t = length(d) / u_radius;
  float a = u_stops[0].y;
  for (int i = 1; i < ${MAX_STOPS}; i++) {
    if (i >= u_count) break;
    vec2 low = u_stops[i - 1];
    vec2 high = u_stops[i];
    if (t >= low.x) a = t >= high.x ? high.y : mix(low.y, high.y, (t - low.x) / max(high.x - low.x, 1e-6));
  }
  color = vec4(u_color * a, a);
}`;

const IMAGE = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform sampler2D u_mask;
uniform vec2 u_maskSize;
uniform int u_maskMode;
uniform bool u_flip;
uniform float u_alpha;
in vec2 v_local;
in vec2 v_px;
out vec4 color;
void main() {
  vec4 c = texture(u_source, u_flip ? vec2(v_local.x, 1.0 - v_local.y) : v_local) * u_alpha;
  if (u_maskMode != 0) {
    vec2 uv = v_px / u_maskSize;
    float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
    float m = texture(u_mask, uv).a * inside;
    c *= u_maskMode == 1 ? m : 1.0 - m;
  }
  color = c;
}`;

/** The bloom's mask, a pixel a cell: how soaked each cell is, and how dark its wet rim. */
const SOAK = `#version 300 es
precision highp float;
uniform highp sampler2D u_noise;
uniform vec2 u_origin;
uniform vec2 u_cells;
uniform float u_seed;
uniform float u_edge;
uniform float u_ragged;
uniform float u_soft;
uniform float u_rim;
out vec4 color;
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  int seed = int(u_seed);
  float n = texelFetch(u_noise, ivec2((cell.x * 2 + seed * 3) & 255, (cell.y * 2 + seed) & 255), 0).r;
  vec2 at = vec2(cell) / u_cells;
  float distance = length(vec2((at.x - u_origin.x) * (u_cells.x / u_cells.y), at.y - u_origin.y));
  float soak = clamp((u_edge - (distance * 0.8 + n * u_ragged)) / u_soft, 0.0, 1.0);
  color = vec4(soak, soak * (1.0 - soak) * 4.0 * u_rim, 0.0, 1.0);
}`;

/** The new place through the mask, drawn up smoothly as the 2D path draws its mask up, under its rim. */
const BLOOM = `#version 300 es
precision highp float;
uniform sampler2D u_incoming;
uniform sampler2D u_soak;
uniform vec3 u_ink;
in vec2 v_local;
out vec4 color;
void main() {
  vec2 mask = texture(u_soak, v_local).rg;
  color = vec4(u_ink * mask.g, mask.g) + texture(u_incoming, v_local) * mask.r * (1.0 - mask.g);
}`;

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface Held {
  texture: WebGLTexture;
  width: number;
  height: number;
  used: number;
}

function compile(gl: WebGL2RenderingContext, fragment: string): Program | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  return { program, uniforms: new Map() };
}

/** A renderer of its own, drawing on a canvas no one sees; null without WebGL2. */
export function createInkGL(): InkGL | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;

  let programs: Record<"mist" | "glow" | "falls" | "image" | "soak" | "bloom", Program> | null =
    null;
  let textures = new Map<object, Held>();
  /** Textures drawn into: a group of light, and the bloom's mask. */
  let targets = new Map<
    "group" | "soak",
    { fbo: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number }
  >();
  /** Numbers made once, drawn between their texels: the ink noise and the day's lattice. */
  let floats = new Map<"noise" | "lattice", WebGLTexture>();
  /** Each place's day, compiled the first time it is drawn; null if it would not compile. */
  let days = new Map<DayPlace | "SKY", Program | null>();
  let flushes = 0;
  let lost = false;
  /** Let go by its owner: never ready again, even if the context comes back. */
  let disposed = false;
  let queue: Draw[] = [];
  let collecting: Draw[] | null = null;

  const setUp = () => {
    const made = {
      mist: compile(gl, MIST),
      glow: compile(gl, GLOW),
      falls: compile(gl, FALLS_SHADER),
      image: compile(gl, IMAGE),
      soak: compile(gl, SOAK),
      bloom: compile(gl, BLOOM),
    };
    programs = Object.values(made).every(Boolean) ? (made as typeof programs) : null;
    textures = new Map();
    targets = new Map();
    days = new Map();
    floats = new Map();
    gl.bindVertexArray(gl.createVertexArray());
    gl.enable(gl.BLEND);
    // Premultiplied colour laid over what is there, as a 2D canvas's source-over.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };
  setUp();
  if (!programs) return null;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererName = String(
    gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? ""
  );
  const software = /swiftshader|llvmpipe|softpipe|software/i.test(rendererName);

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    lost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    setUp();
    lost = !programs;
  });

  /** Switches to `chosen`, returning its uniforms by name. */
  const switchTo = (chosen: Program) => {
    gl.useProgram(chosen.program);
    return (name: string) => {
      if (!chosen.uniforms.has(name))
        chosen.uniforms.set(name, gl.getUniformLocation(chosen.program, name));
      return chosen.uniforms.get(name) ?? null;
    };
  };

  const program = (which: keyof NonNullable<typeof programs>) => {
    const chosen = programs?.[which];
    if (!chosen) throw new Error("ink-gl is not set up");
    return switchTo(chosen);
  };

  /**
   * Binds `texture` to be made on a unit no program samples: binding it on the active unit
   * would replace a texture already bound there for the draw being set up.
   */
  const makeOnSpareUnit = (texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + SPARE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  const textureOf = (source: Source, repeat = false) => {
    const known = textures.get(source);
    if (known) {
      known.used = flushes;
      return known.texture;
    }
    const texture = gl.createTexture();
    makeOnSpareUnit(texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (repeat) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      repeat ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
    );
    textures.set(source, { texture, width: source.width, height: source.height, used: flushes });
    return texture;
  };

  const floatTexture = (name: "noise" | "lattice") => {
    const known = floats.get(name);
    if (known) return known;
    const texture = gl.createTexture();
    makeOnSpareUnit(texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // Half floats, as only they may be drawn between without an extension.
    const values = name === "lattice" ? dayLattice() : inkNoise();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 256, 256, 0, gl.RED, gl.FLOAT, values);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    floats.set(name, texture);
    return texture;
  };

  /** The texture `name` is drawn into, `width`×`height`, bound to draw into. */
  const drawInto = (name: "group" | "soak", width: number, height: number) => {
    // Nothing may sample a texture while it is drawn into.
    bind(0, null);
    bind(1, null);
    const known = targets.get(name);
    if (known?.width === width && known.height === height) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, known.fbo);
      return known;
    }
    if (known) {
      gl.deleteFramebuffer(known.fbo);
      gl.deleteTexture(known.texture);
    }
    const texture = gl.createTexture();
    makeOnSpareUnit(texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const made = { fbo, texture, width, height };
    targets.set(name, made);
    return made;
  };

  const bind = (unit: number, texture: WebGLTexture | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  const quad = (uniform: ReturnType<typeof program>, rect: Rect, target: [number, number]) => {
    gl.uniform4f(uniform("u_rect"), ...rect);
    gl.uniform2f(uniform("u_target"), ...target);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const render = (draw: Draw, target: [number, number]) => {
    switch (draw.kind) {
      case "mist": {
        const { rect, tile, scratch, origin, cell, alpha, edge, side } = draw.draw;
        const uniform = program("mist");
        bind(0, textureOf(tile, true));
        gl.uniform1i(uniform("u_tile"), 0);
        gl.uniform2f(uniform("u_scratch"), ...scratch);
        gl.uniform2f(uniform("u_origin"), ...origin);
        gl.uniform2f(uniform("u_cell"), ...cell);
        gl.uniform1f(uniform("u_alpha"), alpha);
        gl.uniform1f(uniform("u_edge"), edge);
        gl.uniform1f(uniform("u_side"), side);
        quad(uniform, rect, target);
        return;
      }
      case "glow": {
        const { rect, center, radius, stretch = 1, color, stops } = draw.draw;
        const uniform = program("glow");
        gl.uniform2f(uniform("u_center"), ...center);
        gl.uniform1f(uniform("u_radius"), radius);
        gl.uniform1f(uniform("u_stretch"), stretch);
        gl.uniform3f(uniform("u_color"), color[0] / 255, color[1] / 255, color[2] / 255);
        const kept = stops.slice(0, MAX_STOPS);
        gl.uniform2fv(uniform("u_stops"), kept.flat());
        gl.uniform1i(uniform("u_count"), kept.length);
        quad(uniform, rect, target);
        return;
      }
      case "falls": {
        const { rect, look, place } = draw.draw;
        const uniform = program("falls");
        bind(1, floatTexture("noise"));
        gl.uniform1i(uniform("u_noise"), 1);
        const rows = look.rows.slice(0, MAX_ROWS);
        gl.uniform3fv(uniform("u_rows"), rows.flat());
        gl.uniform1i(uniform("u_count"), rows.length);
        gl.uniform3f(uniform("u_place"), ...place);
        gl.uniform1f(uniform("u_flow"), look.flow);
        gl.uniform1f(uniform("u_time"), look.time);
        gl.uniform3f(uniform("u_light"), ...rgb(look.light));
        gl.uniform2f(uniform("u_alpha"), look.alpha.sheet, look.alpha.steam);
        quad(uniform, rect, target);
        return;
      }
      case "day": {
        const { place, rect, ink, leaf, time, ratio, moving, over, weather, air } = draw.draw;
        if (!days.has(place))
          days.set(place, compile(gl, place === "SKY" ? SKY : DAY_SHADERS[place]));
        const chosen = days.get(place);
        if (!chosen) return;
        const uniform = switchTo(chosen);
        bind(0, textureOf(ink));
        gl.uniform1i(uniform("u_ink"), 0);
        bind(1, floatTexture("lattice"));
        gl.uniform1i(uniform("u_lattice"), 1);
        gl.uniform3f(uniform("u_leaf"), ...leaf);
        gl.uniform1f(uniform("u_time"), time);
        gl.uniform1f(uniform("u_ratio"), ratio);
        gl.uniform1f(uniform("u_moving"), moving ? 1 : 0);
        gl.uniform1f(uniform("u_over"), over ? 1 : 0);
        gl.uniform4f(uniform("u_weather"), ...weather);
        gl.uniform4f(uniform("u_air"), ...air);
        quad(uniform, rect, target);
        return;
      }
      case "image": {
        const { source, rect, alpha, within } = draw.draw;
        image(textureOf(source), rect, alpha, target, false, within ? 1 : 0, within);
        return;
      }
      case "group": {
        const into = drawInto("group", gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (const inner of draw.draws) render(inner, target);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        image(into.texture, [0, 0, ...target], 1, target, true, 2, draw.ink);
        return;
      }
      case "bloom": {
        const { origin, seed, edge, cells, ragged, soft, rim, ink } = draw.draw;
        // First the mask, a pixel a cell, written as it is rather than laid over anything.
        const mask = drawInto("soak", ...cells);
        gl.viewport(0, 0, ...cells);
        gl.disable(gl.BLEND);
        const soak = program("soak");
        bind(1, floatTexture("noise"));
        gl.uniform1i(soak("u_noise"), 1);
        gl.uniform2f(soak("u_origin"), ...origin);
        gl.uniform2f(soak("u_cells"), ...cells);
        gl.uniform1f(soak("u_seed"), seed);
        gl.uniform1f(soak("u_edge"), edge);
        gl.uniform1f(soak("u_ragged"), ragged);
        gl.uniform1f(soak("u_soft"), soft);
        gl.uniform1f(soak("u_rim"), rim);
        quad(soak, [0, 0, ...cells], cells);
        gl.enable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        // Then the new place through it, the mask drawn up smoothly.
        const bloom = program("bloom");
        bind(0, textureOf(draw.incoming));
        bind(1, mask.texture);
        gl.uniform1i(bloom("u_incoming"), 0);
        gl.uniform1i(bloom("u_soak"), 1);
        gl.uniform3f(bloom("u_ink"), ink[0] / 255, ink[1] / 255, ink[2] / 255);
        quad(bloom, [0, 0, ...target], target);
        return;
      }
    }
  };

  const image = (
    texture: WebGLTexture,
    rect: Rect,
    alpha: number,
    target: [number, number],
    flip: boolean,
    maskMode: 0 | 1 | 2,
    mask?: Source
  ) => {
    const uniform = program("image");
    bind(0, texture);
    gl.uniform1i(uniform("u_source"), 0);
    if (mask) {
      bind(1, textureOf(mask));
      gl.uniform1i(uniform("u_mask"), 1);
      gl.uniform2f(uniform("u_maskSize"), mask.width, mask.height);
    }
    gl.uniform1i(uniform("u_maskMode"), mask ? maskMode : 0);
    gl.uniform1i(uniform("u_flip"), flip ? 1 : 0);
    gl.uniform1f(uniform("u_alpha"), alpha);
    quad(uniform, rect, target);
  };

  /** The part of the target `draw` may touch, as left, top, right and bottom. */
  const reach = (draw: Draw): Edges => {
    if (draw.kind === "bloom") return [-Infinity, -Infinity, Infinity, Infinity];
    if (draw.kind === "group") return draw.draws.map(reach).reduce(union, NOWHERE);
    const [x, y, width, height] = draw.draw.rect;
    return [x, y, x + width, y + height];
  };

  const soft = (draw: Draw): boolean =>
    draw.kind === "mist" || draw.kind === "glow" || draw.kind === "falls";

  const add = (draw: Draw) => (collecting ?? queue).push(draw);

  const sweep = () => {
    for (const [source, held] of textures)
      if (flushes - held.used > TEXTURE_LIFE) {
        gl.deleteTexture(held.texture);
        textures.delete(source);
      }
  };

  const flush: InkGL["flush"] = (ctx) => {
    if (!queue.length) return;
    const draws = queue;
    queue = [];
    if (lost || disposed) return;
    flushes += 1;
    const target: [number, number] = [ctx.canvas.width, ctx.canvas.height];
    const scale = draws.every(soft) ? SOFT_SCALE : 1;
    const width = Math.max(1, Math.ceil(target[0] * scale));
    const height = Math.max(1, Math.ceil(target[1] * scale));
    if (canvas.width !== width || canvas.height !== height)
      Object.assign(canvas, { width, height });
    // Only what the draws reach is laid on the target, with a margin of clear pixels so it is
    // drawn up just as the whole canvas would be. All of it is cleared: drawing up may reach a
    // texel past the part laid.
    const [kx, ky] = [width / target[0], height / target[1]];
    const [left, top, right, bottom] = draws.map(reach).reduce(union, NOWHERE);
    const x0 = Math.max(0, Math.floor(left * kx) - MARGIN);
    const y0 = Math.max(0, Math.floor(top * ky) - MARGIN);
    const x1 = Math.min(width, Math.ceil(right * kx) + MARGIN);
    const y1 = Math.min(height, Math.ceil(bottom * ky) + MARGIN);
    if (x1 <= x0 || y1 <= y0) return;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const draw of draws) render(draw, target);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(
      canvas,
      x0,
      y0,
      x1 - x0,
      y1 - y0,
      x0 / kx,
      y0 / ky,
      (x1 - x0) / kx,
      (y1 - y0) / ky
    );
    ctx.restore();
    if (flushes % 60 === 0) sweep();
  };

  return {
    software,
    get ready() {
      return !lost && !disposed;
    },
    mist: (draw) => add({ kind: "mist", draw }),
    glow: (draw) => add({ kind: "glow", draw }),
    falls: (draw) => add({ kind: "falls", draw }),
    day: (draw) => add({ kind: "day", draw }),
    image: (draw) => add({ kind: "image", draw }),
    fill: (color, alpha) =>
      add({
        kind: "glow",
        draw: {
          rect: [-1e5, -1e5, 2e5, 2e5],
          center: [0, 0],
          radius: 1,
          color,
          stops: [[0, alpha]],
        },
      }),
    behindInk: (ink, paint) => {
      const draws: Draw[] = [];
      collecting = draws;
      try {
        paint();
      } finally {
        collecting = null;
      }
      queue.push({ kind: "group", ink, draws });
    },
    bloom: (ctx, incoming, draw) => {
      queue.push({ kind: "bloom", draw, incoming });
      flush(ctx);
    },
    flush,
    dispose: () => {
      queue = [];
      disposed = true;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
