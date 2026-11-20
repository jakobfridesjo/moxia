import { inkNoise } from "@/pages/radio/lib/ink-weather.ts";
import type { InkGL } from "@/pages/radio/lib/ink-gl.ts";

/*
 * Moving to the next place, its painting soaks through the paper from where the
 * finger lifted, like ink spreading in wet paper, with a darker wet edge. The
 * edge is a tiny mask of distance plus noise, worked out afresh each frame and
 * drawn up smoothly, so it comes out soft.
 */

const INK: [number, number, number] = [20, 19, 18];
/** Mask cells across the screen; down follows the screen's shape. */
const CELLS_ACROSS = 48;
/** How much the noise pushes the edge about, against the distance from the origin. */
const RAGGED = 0.55;
/** How soft the edge is, in the same units. */
const SOFT = 0.07;
/** How dark the wet edge is at its darkest. */
const RIM = 0.4;

export interface Bloom {
  /** Where it starts, as fractions of the screen across and down. */
  origin: [number, number];
  /** Which part of the noise its edge follows, so no two look alike. */
  seed: number;
}

/** How far the wet edge has spread `progress` (0 to 1) of the way through, against the distance from the origin. */
function edgeAt([ox, oy]: [number, number], progress: number, aspect: number) {
  const corners = [0, 1].flatMap((x) => [0, 1].map((y) => Math.hypot((x - ox) * aspect, y - oy)));
  // Far enough at the end to soak even the furthest corner through its noisiest edge.
  return progress * (Math.max(...corners) * 0.8 + RAGGED + SOFT);
}

/** Mask cells across and down a canvas `width`×`height`. */
function cellsOf(width: number, height: number): [number, number] {
  return [CELLS_ACROSS, Math.max(1, Math.round((CELLS_ACROSS * height) / width))];
}

/** How much of each mask cell `progress` (0 to 1) of the way through the bloom has soaked: 0 dry to 1 painted. */
export function soaked(
  { origin: [ox, oy], seed }: Bloom,
  progress: number,
  across: number,
  down: number
) {
  const noise = inkNoise();
  const aspect = across / down;
  const edge = edgeAt([ox, oy], progress, aspect);
  const out = new Float32Array(across * down);
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      const n = noise[((y * 2 + seed) & 255) * 256 + ((x * 2 + seed * 3) & 255)];
      const distance = Math.hypot((x / across - ox) * aspect, y / down - oy);
      out[y * across + x] = Math.min(1, Math.max(0, (edge - (distance * 0.8 + n * RAGGED)) / SOFT));
    }
  }
  return out;
}

/**
 * Draws a bloom: `incoming` soaked `progress` of the way into `ctx`'s canvas, in place of what
 * it held; with `gl` on a GPU, its mask is worked out there.
 */
export function bloomer(bloom: Bloom, gl: InkGL | null = null) {
  const mask = document.createElement("canvas");
  const rim = document.createElement("canvas");
  return (ctx: CanvasRenderingContext2D, incoming: HTMLCanvasElement, progress: number) => {
    const { width, height } = ctx.canvas;
    const [across, down] = cellsOf(width, height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // A full-screen layer of its own each frame, so on software WebGL the read back costs more
    // than the 2D path's passes.
    if (gl?.ready && !gl.software) {
      ctx.clearRect(0, 0, width, height);
      gl.bloom(ctx, incoming, {
        origin: bloom.origin,
        seed: bloom.seed,
        edge: edgeAt(bloom.origin, progress, across / down),
        cells: [across, down],
        ragged: RAGGED,
        soft: SOFT,
        rim: RIM,
        ink: INK,
      });
      ctx.restore();
      return;
    }
    for (const canvas of [mask, rim]) Object.assign(canvas, { width: across, height: down });
    const maskCtx = mask.getContext("2d");
    const rimCtx = rim.getContext("2d");
    if (!maskCtx || !rimCtx) return ctx.restore();
    const cells = soaked(bloom, progress, across, down);
    const maskPixels = maskCtx.createImageData(across, down);
    const rimPixels = rimCtx.createImageData(across, down);
    cells.forEach((a, i) => {
      maskPixels.data[i * 4 + 3] = a * 255;
      rimPixels.data.set([...INK, a * (1 - a) * 4 * RIM * 255], i * 4);
    });
    maskCtx.putImageData(maskPixels, 0, 0);
    rimCtx.putImageData(rimPixels, 0, 0);
    // The mask drawn up in place of what the canvas held, then the new place kept to it.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(mask, 0, 0, width, height);
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(incoming, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(rim, 0, 0, width, height);
    ctx.restore();
  };
}
