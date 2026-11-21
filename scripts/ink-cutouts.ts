// Cuts the ink out of CC0 paintings from the Cleveland Museum of Art into
// transparent WebP layers, as listed in src/pages/radio/ui/ink/cutouts.json.
// The old man on the monastery path's bridge is then cut from that layer, as "traveller".
// Usage: node scripts/ink-cutouts.ts [name ...]
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import sharp from "sharp";
// Node runs this script as it is, without the `@/` alias.
// oxlint-disable-next-line no-restricted-imports
import { TRAVELLER, travellerPart } from "../src/pages/radio/lib/scroll-path.ts";

/** Left, top, right, bottom, as fractions of the whole painting. */
type Box = [number, number, number, number];

interface Cutout {
  name: string;
  /** Cleveland Museum of Art accession number. */
  source: string;
  crop: Box;
  /** Inscriptions, signatures and seals the colour test misses. */
  erase?: Box[];
  /** How far in from the crop's edges the ink fades out, as a fraction of its shorter side. */
  feather?: number;
  /** Longest side of the layer, in px. */
  size?: number;
  /** Washes the colour out of a painting in ink and light colour, keeping only the ink under it; its seals then need erasing by hand. */
  inkOnly?: boolean;
  /** How dark the painting's darkest ink comes out, from 0 to 1: below 1 for a painter whose ink stayed grey. */
  strength?: number;
}

const MANIFEST = "src/pages/radio/ui/ink/cutouts.json";
const OUT = "src/pages/radio/ui/ink";
const CACHE = ".cache/ink-cutouts";
const API = "https://openaccess-api.clevelandart.org/api/artworks";
const HEADERS = { "User-Agent": "Moxia-ink-cutouts" };

/** The painter's ink, so a layer and a painted stroke are the same black. */
const INK = [20, 19, 18];
const PAPER = { r: 244, g: 240, b: 232 };
/** Paper this much darker than its surroundings still counts as paper: stains, fibres. */
const PAPER_NOISE = 12;
/** Ink fainter than this would cost bytes and show nothing. */
const FAINTEST = 0.04;
/** How much of a colour wash's shading `inkOnly` keeps, so washed rocks keep their body without their colour. */
const WASH_SHADE = 0.7;
/** How much redder than green or blue a pixel must be to be a seal. */
const SEAL_RED = 40;

const say = (line: string) => process.stdout.write(`${line}\n`);

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false
  );
}

async function download(source: string) {
  const file = `${CACHE}/${source}.tif`;
  if (await exists(file)) return file;
  const meta = await fetch(`${API}/${source}?fields=images,share_license_status`, {
    headers: HEADERS,
  });
  if (!meta.ok) throw new Error(`${source}: ${meta.status} from the museum's API`);
  const { data } = (await meta.json()) as {
    data: { share_license_status: string; images: { full: { url: string } } };
  };
  if (data.share_license_status !== "CC0") throw new Error(`${source} is not CC0`);
  say(`Downloading ${source}`);
  const image = await fetch(data.images.full.url, { headers: HEADERS });
  if (!image.ok || !image.body) throw new Error(`${source}: ${image.status} for the image`);
  await pipeline(Readable.fromWeb(image.body as ReadableStream), createWriteStream(`${file}.part`));
  await sharp(`${file}.part`, { limitInputPixels: false }).metadata();
  await rename(`${file}.part`, file);
  return file;
}

/** The luminance below which `share` of the pixels fall. */
function percentile(histogram: Uint32Array, total: number, share: number) {
  let seen = 0;
  for (let level = 0; level < histogram.length; level++) {
    seen += histogram[level];
    if (seen >= total * share) return level;
  }
  return histogram.length - 1;
}

/**
 * The paper's own brightness under every pixel. Old paper is never even, so each
 * tile takes its brighter pixels; a tile soaked in wash borrows from its neighbours.
 */
function paperLevels(luma: Uint8Array, width: number, height: number) {
  const all = new Uint32Array(256);
  for (const value of luma) all[value]++;
  const clean = percentile(all, luma.length, 0.97);

  const tile = Math.max(8, Math.round(Math.min(width, height) / 20));
  const columns = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);
  const grid = new Float32Array(columns * rows);
  const known = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const histogram = new Uint32Array(256);
      let count = 0;
      for (let y = row * tile; y < Math.min(height, (row + 1) * tile); y++) {
        for (let x = column * tile; x < Math.min(width, (column + 1) * tile); x++) {
          histogram[luma[y * width + x]]++;
          count++;
        }
      }
      const level = percentile(histogram, count, 0.8);
      grid[row * columns + column] = level;
      known[row * columns + column] = level >= clean - 12 ? 1 : 0;
    }
  }

  if (!known.includes(1)) grid.fill(clean);
  while (known.includes(0) && known.includes(1)) {
    const filled = known.slice();
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        if (known[row * columns + column]) continue;
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const r = row + dy;
            const c = column + dx;
            if (r < 0 || c < 0 || r >= rows || c >= columns || !known[r * columns + c]) continue;
            sum += grid[r * columns + c];
            count++;
          }
        }
        if (count === 0) continue;
        grid[row * columns + column] = sum / count;
        filled[row * columns + column] = 1;
      }
    }
    known.set(filled);
  }

  for (let pass = 0; pass < 2; pass++) {
    const source = grid.slice();
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const r = Math.min(rows - 1, Math.max(0, row + dy));
            const c = Math.min(columns - 1, Math.max(0, column + dx));
            sum += source[r * columns + c];
            count++;
          }
        }
        grid[row * columns + column] = sum / count;
      }
    }
  }

  const paper = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(rows - 1, Math.max(0, (y + 0.5) / tile - 0.5));
    const r0 = Math.floor(gy);
    const r1 = Math.min(rows - 1, r0 + 1);
    const fy = gy - r0;
    for (let x = 0; x < width; x++) {
      const gx = Math.min(columns - 1, Math.max(0, (x + 0.5) / tile - 0.5));
      const c0 = Math.floor(gx);
      const c1 = Math.min(columns - 1, c0 + 1);
      const fx = gx - c0;
      const top = grid[r0 * columns + c0] * (1 - fx) + grid[r0 * columns + c1] * fx;
      const bottom = grid[r1 * columns + c0] * (1 - fx) + grid[r1 * columns + c1] * fx;
      paper[y * width + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return paper;
}

/** Grows a mask by `radius` px, so a seal's soft red rim goes with it. */
function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  const across = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < width) across[y * width + nx] = 1;
      }
    }
  }
  const grown = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!across[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < height) grown[ny * width + x] = 1;
      }
    }
  }
  return grown;
}

/**
 * Ink darkens every channel of the paper alike, while a wash of colour darkens
 * some more than others. The channel that keeps the most of the paper's light
 * is the one the colour left alone, so how dark it is, is how much ink is there;
 * a share of the wash's own shading is kept on top.
 */
function washOutColour(luma: Uint8Array, channels: Uint8Array[], width: number, height: number) {
  const lumaPaper = paperLevels(luma, width, height);
  const papers = channels.map((channel) => paperLevels(channel, width, height));
  for (let i = 0; i < luma.length; i++) {
    const kept = Math.max(...channels.map((channel, c) => channel[i] / Math.max(1, papers[c][i])));
    const ink = Math.min(1, kept) * lumaPaper[i];
    luma[i] = Math.round(ink + (luma[i] - ink) * WASH_SHADE);
  }
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

async function cut(cutout: Cutout) {
  const file = await download(cutout.source);
  const { width: fullWidth, height: fullHeight } = await sharp(file, {
    limitInputPixels: false,
  }).metadata();
  const [left, top, right, bottom] = cutout.crop;
  const region = {
    left: Math.round(left * fullWidth),
    top: Math.round(top * fullHeight),
    width: Math.round((right - left) * fullWidth),
    height: Math.round((bottom - top) * fullHeight),
  };
  const scale = Math.min(1, (cutout.size ?? 1600) / Math.max(region.width, region.height));
  const width = Math.round(region.width * scale);
  const height = Math.round(region.height * scale);

  const { data } = await sharp(file, { limitInputPixels: false })
    .extract(region)
    .resize(width, height, { kernel: "lanczos3" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });

  const luma = new Uint8Array(width * height);
  const channels = [0, 1, 2].map(() => new Uint8Array(width * height));
  const seal = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    const [r, g, b] = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
    luma[i] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    channels.forEach((channel, c) => (channel[i] = data[i * 3 + c]));
    seal[i] = !cutout.inkOnly && r - Math.max(g, b) > SEAL_RED ? 1 : 0;
  }
  if (cutout.inkOnly) washOutColour(luma, channels, width, height);
  const seals = dilate(seal, width, height, Math.max(2, Math.round(Math.min(width, height) / 400)));
  const paper = paperLevels(luma, width, height);
  const histogram = new Uint32Array(256);
  for (const value of luma) histogram[value]++;
  const darkest = percentile(histogram, luma.length, 0.002);

  const erased = (cutout.erase ?? []).map(([l, t, r, b]) => [
    (l * fullWidth - region.left) * scale,
    (t * fullHeight - region.top) * scale,
    (r * fullWidth - region.left) * scale,
    (b * fullHeight - region.top) * scale,
  ]);
  const feather = (cutout.feather ?? 0.03) * Math.min(width, height);

  const layer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const depth = paper[i] - darkest - PAPER_NOISE;
      let alpha =
        depth > 0 ? Math.min(1, Math.max(0, (paper[i] - luma[i] - PAPER_NOISE) / depth)) : 0;
      if (seals[i] || erased.some(([l, t, r, b]) => x >= l && x <= r && y >= t && y <= b))
        alpha = 0;
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (feather > 0 && edge < feather) alpha *= smoothstep(edge / feather);
      alpha *= cutout.strength ?? 1;
      if (alpha < FAINTEST) alpha = 0;
      layer.set([...INK, Math.round(alpha * 255)], i * 4);
    }
  }

  const raw = { raw: { width, height, channels: 4 as const } };
  await sharp(layer, raw)
    .webp({ quality: 85, alphaQuality: 85, effort: 6 })
    .toFile(`${OUT}/${cutout.name}.webp`);
  await sharp({ create: { width, height, channels: 3, background: PAPER } })
    .composite([{ input: layer, ...raw }])
    .jpeg({ quality: 85 })
    .toFile(`${CACHE}/preview/${cutout.name}.jpg`);
  say(`${cutout.name}: ${width}×${height}`);
}

/** The scroll the old man stands in, and the name his own cut goes by. */
const SCROLL_LAYER = "monastery-path";
const TRAVELLER_NAME = "traveller";

/**
 * The old man cut from the scroll's layer as the app shows it: his body and his cane apart, so
 * the cane can swing, and a mask of where he stood, to take him out of the painting once he walks off.
 */
async function cutTraveller() {
  const { left, top, width, height } = TRAVELLER;
  const ink = await sharp(`${OUT}/${SCROLL_LAYER}.webp`)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const parts = { body: Buffer.alloc(ink.length), cane: Buffer.alloc(ink.length) };
  const hole = Buffer.alloc(ink.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const part = travellerPart(left + x, top + y, ink[i + 3]);
      if (!part) continue;
      ink.copy(parts[part], i, i, i + 4);
      // Paper over the stroke and a pixel round it, fully, so no ghost of him stays.
      for (const [ox, oy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const [cx, cy] = [x + ox, y + oy];
        if (cx >= 0 && cy >= 0 && cx < width && cy < height) hole[(cy * width + cx) * 4 + 3] = 255;
      }
    }
  }
  const raw = { raw: { width, height, channels: 4 as const } };
  for (const [name, pixels] of Object.entries({ ...parts, hole }))
    await sharp(pixels, raw)
      .webp({ lossless: true })
      .toFile(`${OUT}/${TRAVELLER_NAME}-${name}.webp`);
  say(`${TRAVELLER_NAME}: ${width}×${height}`);
}

const cutouts = JSON.parse(await readFile(MANIFEST, "utf8")) as Cutout[];
const wanted = process.argv.slice(2);
const unknown = wanted.filter(
  (name) => name !== TRAVELLER_NAME && !cutouts.some((cutout) => cutout.name === name)
);
if (unknown.length) throw new Error(`No cut-out named ${unknown.join(", ")} in ${MANIFEST}`);
await mkdir(`${CACHE}/preview`, { recursive: true });
for (const cutout of cutouts) {
  if (wanted.length === 0 || wanted.includes(cutout.name)) await cut(cutout);
}
if (wanted.length === 0 || wanted.includes(SCROLL_LAYER) || wanted.includes(TRAVELLER_NAME))
  await cutTraveller();
say(`Previews on paper: ${CACHE}/preview/`);
