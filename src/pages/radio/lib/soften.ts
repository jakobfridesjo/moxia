/*
 * Softening drawn by hand: WebKit's canvas has no `filter`, so in the app's webview a CSS
 * `blur()` on a canvas does nothing and every edge stays hard.
 */

type Context = CanvasRenderingContext2D;

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
  const sum = new Float32Array(4);
  for (let l = 0; l < count; l++) {
    const at = (k: number) => (l * stride + k * step) * 4;
    for (let k = 0; k < length; k++) line.set(data.subarray(at(k), at(k) + 4), k * 4);
    sum.fill(0);
    for (let k = 0; k <= radius && k < length; k++)
      for (let c = 0; c < 4; c++) sum[c] += line[k * 4 + c];
    for (let k = 0; k < length; k++) {
      for (let c = 0; c < 4; c++) data[at(k) + c] = sum[c] / span;
      const enter = k + radius + 1;
      const leave = k - radius;
      if (enter < length) for (let c = 0; c < 4; c++) sum[c] += line[enter * 4 + c];
      if (leave >= 0) for (let c = 0; c < 4; c++) sum[c] -= line[leave * 4 + c];
    }
  }
}

/**
 * `source` softened like CSS `blur(sigma px)`, on a canvas of its own. Done by hand because WebKit's
 * canvas has no `filter`, so the app's webview would leave every edge hard: shrunk so the blur is a
 * few pixels wide, three box passes each way, and smoothed back up.
 */
export function blurred(source: HTMLCanvasElement, sigma: number) {
  const { width, height } = source;
  const out = canvasOf(width, height);
  const o = out.getContext("2d");
  const shrink = Math.max(1, sigma / 4);
  const w = Math.max(1, Math.ceil(width / shrink));
  const h = Math.max(1, Math.ceil(height / shrink));
  const small = canvasOf(w, h);
  const s = small.getContext("2d", { willReadFrequently: true });
  if (!o || !s) return out;
  s.imageSmoothingQuality = "high";
  s.drawImage(source, 0, 0, w, h);
  const pixels = s.getImageData(0, 0, w, h);
  const data = new Float32Array(pixels.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = pixels.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) data[i + c] = pixels.data[i + c] * alpha;
    data[i + 3] = pixels.data[i + 3];
  }
  const smallSigma = sigma / shrink;
  const radius = Math.max(1, Math.round((Math.sqrt(4 * smallSigma ** 2 + 1) - 1) / 2));
  for (let pass = 0; pass < 3; pass++) {
    blurLines(data, { count: h, length: w, stride: w, step: 1 }, radius);
    blurLines(data, { count: w, length: h, stride: 1, step: w }, radius);
  }
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    for (let c = 0; c < 3; c++) pixels.data[i + c] = alpha > 0 ? (data[i + c] * 255) / alpha : 0;
    pixels.data[i + 3] = alpha;
  }
  s.putImageData(pixels, 0, 0);
  o.imageSmoothingQuality = "high";
  o.drawImage(small, 0, 0, width, height);
  return out;
}

/** Draws what `paint` draws (in the units of `transform`) onto `target`, blurred by `sigma` device pixels. */
export function paintSoft(
  target: Context,
  transform: DOMMatrix,
  sigma: number,
  paint: (g: Context) => void
) {
  const layer = canvasOf(target.canvas.width, target.canvas.height);
  const g = layer.getContext("2d");
  if (!g) return;
  g.setTransform(transform);
  paint(g);
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(blurred(layer, sigma), 0, 0);
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
