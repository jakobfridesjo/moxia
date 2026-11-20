/*
 * Softening drawn by hand: WebKit's canvas has no `filter`, so in the app's webview a CSS
 * `blur()` on a canvas does nothing and every edge stays hard.
 */

type Context = CanvasRenderingContext2D;
/** Red, green and blue, 0 to 255. */
export type Tint = readonly [number, number, number];

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/**
 * Box-blurs `length`-long lines of premultiplied RGBA in place, `count` of them, the line at `l`
 * starting at pixel `l * stride` and stepping `step` pixels; beyond the ends lies nothing.
 */
function blurLines(
  data: Float32Array,
  { count, length, stride, step }: { count: number; length: number; stride: number; step: number },
  radius: number
) {
  const line = new Float32Array(length * 4);
  const span = radius * 2 + 1;
  const jump = step * 4;
  for (let l = 0; l < count; l++) {
    const start = l * stride * 4;
    for (let k = 0, at = start; k < length * 4; k += 4, at += jump) {
      line[k] = data[at];
      line[k + 1] = data[at + 1];
      line[k + 2] = data[at + 2];
      line[k + 3] = data[at + 3];
    }
    let [r, g, b, a] = [0, 0, 0, 0];
    for (let k = 0; k <= radius && k < length; k++) {
      r += line[k * 4];
      g += line[k * 4 + 1];
      b += line[k * 4 + 2];
      a += line[k * 4 + 3];
    }
    for (let k = 0, at = start; k < length; k++, at += jump) {
      data[at] = r / span;
      data[at + 1] = g / span;
      data[at + 2] = b / span;
      data[at + 3] = a / span;
      const enter = (k + radius + 1) * 4;
      const leave = (k - radius) * 4;
      if (enter < length * 4) {
        r += line[enter];
        g += line[enter + 1];
        b += line[enter + 2];
        a += line[enter + 3];
      }
      if (leave >= 0) {
        r -= line[leave];
        g -= line[leave + 1];
        b -= line[leave + 2];
        a -= line[leave + 3];
      }
    }
  }
}

/** As `blurLines`, for lines of one number a pixel. */
function blurAlphaLines(
  data: Float32Array,
  { count, length, stride, step }: { count: number; length: number; stride: number; step: number },
  radius: number
) {
  const line = new Float32Array(length);
  const span = radius * 2 + 1;
  for (let l = 0; l < count; l++) {
    const start = l * stride;
    for (let k = 0, at = start; k < length; k++, at += step) line[k] = data[at];
    let sum = 0;
    for (let k = 0; k <= radius && k < length; k++) sum += line[k];
    for (let k = 0, at = start; k < length; k++, at += step) {
      data[at] = sum / span;
      if (k + radius + 1 < length) sum += line[k + radius + 1];
      if (k - radius >= 0) sum -= line[k - radius];
    }
  }
}

/** Softens the alpha of `pixels` within `box`, leaving every pixel it reaches the one colour `tint`. */
function softenAlpha(
  pixels: ImageData,
  box: { x: number; y: number; w: number; h: number },
  radius: number,
  [r, g, b]: Tint
) {
  const alpha = new Float32Array(box.w * box.h);
  for (let y = 0; y < box.h; y++) {
    let from = ((box.y + y) * pixels.width + box.x) * 4 + 3;
    for (let i = y * box.w; i < (y + 1) * box.w; i++, from += 4) alpha[i] = pixels.data[from];
  }
  for (let pass = 0; pass < 3; pass++) {
    blurAlphaLines(alpha, { count: box.h, length: box.w, stride: box.w, step: 1 }, radius);
    blurAlphaLines(alpha, { count: box.w, length: box.h, stride: 1, step: box.w }, radius);
  }
  for (let y = 0; y < box.h; y++) {
    let to = ((box.y + y) * pixels.width + box.x) * 4;
    for (let i = y * box.w; i < (y + 1) * box.w; i++, to += 4) {
      const lit = alpha[i] > 0;
      pixels.data[to] = lit ? r : 0;
      pixels.data[to + 1] = lit ? g : 0;
      pixels.data[to + 2] = lit ? b : 0;
      pixels.data[to + 3] = alpha[i];
    }
  }
}

/** The box holding everything in `pixels` that isn't clear, `margin` pixels wider each way; null if all is clear. */
function inkedBox({ data, width, height }: ImageData, margin: number) {
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    const row = y * width * 4 + 3;
    let first = 0;
    while (first < width && data[row + first * 4] === 0) first++;
    if (first === width) continue;
    let last = width - 1;
    while (data[row + last * 4] === 0) last--;
    left = Math.min(left, first);
    right = Math.max(right, last);
    top = Math.min(top, y);
    bottom = y;
  }
  if (right < 0) return null;
  const x = Math.max(0, left - margin);
  const y = Math.max(0, top - margin);
  return {
    x,
    y,
    w: Math.min(width, right + margin + 1) - x,
    h: Math.min(height, bottom + margin + 1) - y,
  };
}

/** How far a blur of `sigma` pixels over a `width`×`height` canvas is shrunk, so it is a few pixels wide: the smaller size, and the blur left to do there. */
function shrunk(width: number, height: number, sigma: number) {
  const shrink = Math.max(1, sigma / 4);
  return {
    w: Math.max(1, Math.ceil(width / shrink)),
    h: Math.max(1, Math.ceil(height / shrink)),
    sigma: sigma / shrink,
  };
}

/**
 * Softens what `ctx` holds like CSS `blur(sigma px)`: three box passes each way, over no more than
 * the blur can reach. Where all of it is the one colour `tint`, only its alpha is worked through,
 * a quarter of the work.
 */
function soften(ctx: Context, sigma: number, tint?: Tint) {
  const { width: w, height: h } = ctx.canvas;
  const radius = Math.max(1, Math.round((Math.sqrt(4 * sigma ** 2 + 1) - 1) / 2));
  const pixels = ctx.getImageData(0, 0, w, h);
  const box = inkedBox(pixels, radius * 3);
  if (!box) return;
  if (tint) {
    softenAlpha(pixels, box, radius, tint);
    ctx.putImageData(pixels, 0, 0);
    return;
  }
  const data = new Float32Array(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    let from = ((box.y + y) * w + box.x) * 4;
    for (let i = y * box.w * 4; i < (y + 1) * box.w * 4; i += 4, from += 4) {
      const alpha = pixels.data[from + 3] / 255;
      data[i] = pixels.data[from] * alpha;
      data[i + 1] = pixels.data[from + 1] * alpha;
      data[i + 2] = pixels.data[from + 2] * alpha;
      data[i + 3] = pixels.data[from + 3];
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    blurLines(data, { count: box.h, length: box.w, stride: box.w, step: 1 }, radius);
    blurLines(data, { count: box.w, length: box.h, stride: 1, step: box.w }, radius);
  }
  for (let y = 0; y < box.h; y++) {
    let to = ((box.y + y) * w + box.x) * 4;
    for (let i = y * box.w * 4; i < (y + 1) * box.w * 4; i += 4, to += 4) {
      const alpha = data[i + 3];
      pixels.data[to] = alpha > 0 ? (data[i] * 255) / alpha : 0;
      pixels.data[to + 1] = alpha > 0 ? (data[i + 1] * 255) / alpha : 0;
      pixels.data[to + 2] = alpha > 0 ? (data[i + 2] * 255) / alpha : 0;
      pixels.data[to + 3] = alpha;
    }
  }
  ctx.putImageData(pixels, 0, 0);
}

/**
 * `source` softened like CSS `blur(sigma px)`, on a canvas of its own. Done by hand because WebKit's
 * canvas has no `filter`, so the app's webview would leave every edge hard: shrunk so the blur is a
 * few pixels wide, blurred there, and smoothed back up.
 */
export function blurred(source: HTMLCanvasElement, sigma: number) {
  const { width, height } = source;
  const out = canvasOf(width, height);
  const o = out.getContext("2d");
  const small = shrunk(width, height, sigma);
  const canvas = canvasOf(small.w, small.h);
  const s = canvas.getContext("2d", { willReadFrequently: true });
  if (!o || !s) return out;
  s.imageSmoothingQuality = "high";
  s.drawImage(source, 0, 0, small.w, small.h);
  soften(s, small.sigma);
  o.imageSmoothingQuality = "high";
  o.drawImage(canvas, 0, 0, width, height);
  return out;
}

/**
 * Draws what `paint` draws (in the units of `transform`) onto `target`, blurred by `sigma` device
 * pixels. It is painted already shrunk, on a canvas kept in memory, so nothing is read back from
 * the GPU. `tint` is the one colour `paint` draws in, when it draws in only one: it is softened
 * much faster.
 */
export function paintSoft(
  target: Context,
  transform: DOMMatrix,
  sigma: number,
  paint: (g: Context) => void,
  tint?: Tint
) {
  const { width, height } = target.canvas;
  const small = shrunk(width, height, sigma);
  const canvas = canvasOf(small.w, small.h);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return;
  g.setTransform(new DOMMatrix().scale(small.w / width, small.h / height).multiply(transform));
  paint(g);
  soften(g, small.sigma, tint);
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.imageSmoothingQuality = "high";
  target.drawImage(canvas, 0, 0, width, height);
  target.restore();
}

/** A repeating `tile` softened by `sigma` pixels, blurred across its edges so it still repeats. */
export function blurredTile(tile: HTMLCanvasElement, sigma: number) {
  const { width, height } = tile;
  const around = canvasOf(width * 3, height * 3);
  const a = around.getContext("2d");
  const out = canvasOf(width, height);
  const o = out.getContext("2d");
  if (!a || !o) return tile;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) a.drawImage(tile, x * width, y * height);
  o.drawImage(blurred(around, sigma), width, height, width, height, 0, 0, width, height);
  return out;
}
