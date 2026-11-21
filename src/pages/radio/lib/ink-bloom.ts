import { inkNoise } from "@/pages/radio/lib/ink-weather.ts";

/*
 * Moving to the next place, its painting soaks through the paper from where the
 * finger lifted, like ink spreading in wet paper, with a darker wet edge. The
 * edge is a tiny mask of distance plus noise, worked out afresh each frame and
 * drawn up smoothly, so it comes out soft. The mask is a few dozen cells across,
 * so the bloom costs three canvas passes a frame.
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

/** Draws a bloom: `incoming` soaked `progress` of the way into `ctx`'s canvas, in place of what it held. */
export function bloomer(bloom: Bloom) {
  const mask = document.createElement("canvas");
  const rim = document.createElement("canvas");
  let pixels: { mask: ImageData; rim: ImageData } | null = null;
  return (ctx: CanvasRenderingContext2D, incoming: HTMLCanvasElement, progress: number) => {
    const { width, height } = ctx.canvas;
    const [across, down] = cellsOf(width, height);
    const maskCtx = mask.getContext("2d");
    const rimCtx = rim.getContext("2d");
    if (!maskCtx || !rimCtx) return;
    if (pixels?.mask.width !== across || pixels.mask.height !== down) {
      for (const canvas of [mask, rim]) Object.assign(canvas, { width: across, height: down });
      pixels = {
        mask: maskCtx.createImageData(across, down),
        rim: rimCtx.createImageData(across, down),
      };
      for (let i = 0; i < across * down; i++) pixels.rim.data.set(INK, i * 4);
    }
    const { mask: maskPixels, rim: rimPixels } = pixels;
    const cells = soaked(bloom, progress, across, down);
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      maskPixels.data[i * 4 + 3] = a * 255;
      rimPixels.data[i * 4 + 3] = a * (1 - a) * 4 * RIM * 255;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
