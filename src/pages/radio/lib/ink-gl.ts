/*
 * What lies over the paintings and is the same everywhere it spreads (mist, the night's light,
 * the dark) worked out per pixel on the GPU with WebGL2, instead of in canvas passes that each
 * blend across the screen. Each renderer draws on a canvas of its own that is shown as a layer
 * over the painting, so nothing is copied between canvases: draws are queued and land at
 * `flush`, in the order they were queued. Without a hardware GPU, or once its context is lost,
 * `createInkGL` gives null or `ready` turns false, and what it would draw is left out.
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
  | { kind: "group"; ink: Source; draws: Draw[] };

export interface InkGL {
  /** False once the context is lost, until it is restored. */
  readonly ready: boolean;
  /** The canvas it draws on, shown as a layer of its own. */
  readonly canvas: HTMLCanvasElement;
  mist: (draw: MistDraw) => void;
  glow: (draw: GlowDraw) => void;
  /** Falling water and its steam, as `FALLS_SHADER` works them out. */
  falls: (draw: FallsDraw) => void;
  /** A place's day weather and light, as `ink-day.ts` writes it. */
  day: (draw: DayDraw) => void;
  image: (draw: ImageDraw) => void;
  /** A veil of `color` over the whole target. */
  fill: (color: Rgb, alpha: number) => void;
  /** What `paint` queues, as light lying behind `ink`: cut away wherever it has ink. */
  behindInk: (ink: Source, paint: () => void) => void;
  /** Starts a frame: the canvas made `width`×`height` pixels and cleared, and anything still queued dropped. */
  clear: (width: number, height: number) => void;
  /** Draws everything queued onto the canvas, over what it holds since `clear`. */
  flush: () => void;
  dispose: () => void;
}

/** The two layers a painting's effects lie on: under the figures, and over them. */
export interface InkLayers {
  under: InkGL;
  over: InkGL;
}

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

/**
 * A renderer drawing on `canvas`, to be shown as a layer; null without WebGL2 on a hardware GPU.
 * `allowSoftware` takes WebGL running on the CPU too, as the test browser's does.
 */
export function createInkGL(
  canvas: HTMLCanvasElement = document.createElement("canvas"),
  { allowSoftware = false }: { allowSoftware?: boolean } = {}
): InkGL | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    // On the CPU every effect costs more than it is worth, so they are left out as without shaders.
    failIfMajorPerformanceCaveat: !allowSoftware,
  });
  if (!gl) return null;

  let programs: Record<"mist" | "glow" | "falls" | "image", Program> | null = null;
  let textures = new Map<object, Held>();
  /** The texture a group of light is drawn into. */
  let group: {
    fbo: WebGLFramebuffer;
    texture: WebGLTexture;
    width: number;
    height: number;
  } | null = null;
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
    };
    programs = Object.values(made).every(Boolean) ? (made as typeof programs) : null;
    textures = new Map();
    group = null;
    days = new Map();
    floats = new Map();
    gl.bindVertexArray(gl.createVertexArray());
    gl.enable(gl.BLEND);
    // Premultiplied colour laid over what is there, as a 2D canvas's source-over.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };
  setUp();
  if (!programs) return null;

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

  /** The texture a group of light is drawn into, `width`×`height`, bound to draw into. */
  const drawIntoGroup = (width: number, height: number) => {
    // Nothing may sample a texture while it is drawn into.
    bind(0, null);
    bind(1, null);
    if (group?.width === width && group.height === height) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, group.fbo);
      return group;
    }
    if (group) {
      gl.deleteFramebuffer(group.fbo);
      gl.deleteTexture(group.texture);
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
    group = { fbo, texture, width, height };
    return group;
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
        const into = drawIntoGroup(gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (const inner of draw.draws) render(inner, target);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        image(into.texture, [0, 0, ...target], 1, target, true, 2, draw.ink);
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

  const add = (draw: Draw) => (collecting ?? queue).push(draw);

  const sweep = () => {
    for (const [source, held] of textures)
      if (flushes - held.used > TEXTURE_LIFE) {
        gl.deleteTexture(held.texture);
        textures.delete(source);
      }
  };

  const flush: InkGL["flush"] = () => {
    const draws = queue;
    queue = [];
    if (!draws.length || lost || disposed) return;
    flushes += 1;
    const target: [number, number] = [canvas.width, canvas.height];
    for (const draw of draws) render(draw, target);
    if (flushes % 60 === 0) sweep();
  };

  const clear: InkGL["clear"] = (width, height) => {
    queue = [];
    if (lost || disposed) return;
    if (canvas.width !== width || canvas.height !== height)
      Object.assign(canvas, { width, height });
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  return {
    canvas,
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
    clear,
    flush,
    dispose: () => {
      queue = [];
      disposed = true;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
