import type { CountryCode } from "@/shared/api/commands.ts";
import { LEAVES, type LayerName } from "@/pages/radio/lib/ink-painter.ts";
import dozingUnderPine from "./dozing-under-pine.webp";
import riverLandscape from "./river-landscape.webp";
import scholarAtWaterfall from "./scholar-at-waterfall.webp";
import suDongpo from "./su-dongpo.webp";

const URLS: Record<LayerName, string> = {
  "dozing-under-pine": dozingUnderPine,
  "river-landscape": riverLandscape,
  "scholar-at-waterfall": scholarAtWaterfall,
  "su-dongpo": suDongpo,
};

const loading = new Map<LayerName, Promise<ImageBitmap | undefined>>();

/** `region`'s leaf, decoded once and kept; undefined when it would not load, and the place is bare paper. */
export function leafImage(region: CountryCode) {
  const name = LEAVES[region].layer;
  let image = loading.get(name);
  if (!image) {
    image = fetch(URLS[name])
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob))
      .catch(() => undefined);
    loading.set(name, image);
  }
  return image;
}
