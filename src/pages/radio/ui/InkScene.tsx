import { createEffect, createMemo, untrack } from "solid-js";
import type { CountryCode, Station } from "@/shared/api/commands.ts";
import { environmentAtom, shadersAtom } from "@/shared/config/preferences.ts";
import { nightAtom } from "@/shared/lib/night.ts";
import { usePageVisible } from "@/shared/lib/use-page-visible.ts";
import { levelAtom } from "@/features/player/model/player-store.ts";
import { meterReading } from "@/features/player/model/levels.ts";
import {
  captionsAtom,
  soundAtom,
  subtitlesStatusAtom,
  type Caption,
} from "@/features/player/model/subtitles.ts";
import {
  inkLeft,
  layOut,
  type Layout,
  shownBy,
  shownFrom,
  sungBy,
} from "@/pages/radio/lib/captions.ts";
import {
  CAPTION_LINE,
  captionWriter,
  drawListener,
  LEAF_HEIGHT,
  leafSize,
  paintScene,
  restScene,
  type ListenerPose,
  type Scene,
} from "@/pages/radio/lib/ink-painter.ts";
import { makeMover, type FigurePose, type Poses } from "@/pages/radio/lib/mood.ts";
import { isTalkStation, listenForTalk, type Talk } from "@/pages/radio/lib/talk.ts";
import { listenToAir } from "@/pages/radio/lib/air.ts";
import { makeWeather, type Weather } from "@/pages/radio/lib/ink-weather.ts";
import { lightOnce, makeNight, NIGHT_LOOK, type Night } from "@/pages/radio/lib/ink-night.ts";
import { makeDay, type Day } from "@/pages/radio/lib/ink-day.ts";
import {
  makeSky,
  moonlight,
  weatherFor,
  type Sky,
  type SkyNow,
} from "@/pages/radio/lib/ink-sky.ts";
import type { LocalSky } from "@/pages/radio/model/use-local-sky.ts";
import { DAY_TONE } from "@/pages/radio/lib/ink-tone.ts";
import { bloomer } from "@/pages/radio/lib/ink-bloom.ts";
import { AMBIENT_FRAME_MS, FRAME_SLACK_MS } from "@/pages/radio/lib/ink-pace.ts";
import { createInkGL, type InkGL, type InkLayers } from "@/pages/radio/lib/ink-gl.ts";
import { leafImage } from "@/pages/radio/ui/ink/layers.ts";

/** The last swipe or key that changed what plays: the station, toward `direction`, or the place, from `at` (fractions of the screen). */
export interface Move {
  id: number;
  kind: "station" | "place";
  direction: 1 | -1;
  at: [number, number];
}

interface InkSceneProps {
  region: CountryCode;
  /** What plays, whose tags say whether it is likely to be talk. */
  station: Station | null;
  /** His head follows what plays, and he dozes when it stops. */
  listening: boolean;
  /** A scroll lies at his hands while the radio records. */
  writing: boolean;
  /** Changing station blows mist across the painting; changing place soaks the new one in from the finger. */
  move: Move | null;
  /** The real sky where the station is: its weather, when known, and the light of dawn or dusk. */
  sky: LocalSky;
  /** Something opaque lies over the painting, so what moves in it rests. */
  covered?: boolean;
  /** The keys in the top corner: subtitles keep as far from them as they keep from the screen's edge. */
  keys?: () => HTMLElement | undefined;
}

/** How long a scene takes to fade into the next, in ms, when it does not bloom. */
const FADE_MS = 1300;
/** How long a new place takes to soak through, and mist takes to blow past, in ms. */
const BLOOM_MS = 2200;
const GUST_MS = 2800;
/** How far subtitles keep from the screen's edge where there are no keys to measure it by, in CSS pixels. */
const CAPTION_MARGIN = 16;
/** The room the usual inscription takes from the screen's right edge, in CSS pixels: its margin, the name's first column under its seal, and a little more. Subtitles keep clear of that much whatever the station, so their box never changes width. */
const INSCRIPTION_ROOM = 96;
/** How far down the screen subtitles may be written, as a fraction of its height: the same on every painting. */
const CAPTION_END = 0.43;
const SILENT_TALK: Talk = { talking: false, voice: 0 };

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** How far a change of station has washed the painting out, 0 to 1, `progress` of the way through: in over the first third, held a moment, then back. */
const washOf = (progress: number) =>
  ease(clamp01(progress / 0.35)) * (1 - ease(clamp01((progress - 0.5) / 0.5)));

/** The paper, "r,g,b", laid over the painting and its figures at `alpha`: by day a wash, by night the dark. */
function washOut(
  ctx: CanvasRenderingContext2D,
  gl: InkGL | undefined,
  paper: string,
  alpha: number
) {
  if (alpha <= 0.002) return;
  if (gl?.ready) {
    gl.fill(paper.split(",").map(Number) as [number, number, number], alpha);
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(${paper},${alpha})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

function copyOf(source: HTMLCanvasElement) {
  const copy = document.createElement("canvas");
  Object.assign(copy, { width: source.width, height: source.height });
  copy.getContext("2d")?.drawImage(source, 0, 0);
  return copy;
}

const pixelRatio = () => Math.min(2, window.devicePixelRatio || 1);

const SCENE_CLASS =
  "absolute inset-0 size-full transition-opacity ease-out motion-reduce:transition-none";

/** A renderer whose canvas is shown in `slot`, or null without a hardware GPU. */
function layerIn(slot: HTMLElement | undefined) {
  const gl = slot ? createInkGL() : null;
  if (!slot || !gl) return null;
  gl.canvas.className = "absolute inset-0 size-full";
  slot.replaceChildren(gl.canvas);
  return gl;
}

function letGo(layers: Partial<InkLayers> | null | undefined) {
  for (const gl of [layers?.under, layers?.over]) {
    gl?.dispose();
    gl?.canvas.remove();
  }
}

/** Bumped whenever the browser finishes loading fonts, so subtitles written in a stand-in font are written again. */
let fontsLoaded = 0;
if (typeof document !== "undefined")
  document.fonts?.addEventListener("loadingdone", () => (fontsLoaded += 1));

/**
 * The painting behind the radio: two canvases take turns holding a place's leaf
 * so a new place fades in over the old. Over them lie, in order, the GPU's layer of
 * light and mist, a canvas for the figures and what falls, the GPU's layer of what
 * lies in front of the figures, and the subtitles: the browser lays them together,
 * so nothing is copied from one canvas to another.
 */
export function InkScene(props: InkSceneProps) {
  const visible = usePageVisible();
  const moving = createMemo(() => visible() && !props.covered);
  const region = createMemo(() => props.region);
  let box: HTMLDivElement | undefined;
  let sceneA: HTMLCanvasElement | undefined;
  let sceneB: HTMLCanvasElement | undefined;
  let front: HTMLCanvasElement | undefined;
  let underSlot: HTMLDivElement | undefined;
  let overSlot: HTMLDivElement | undefined;
  let subtitles: HTMLCanvasElement | undefined;
  let shown = 0;
  // Every level the player reports goes to a listener that starts afresh with each station.
  let talk = SILENT_TALK;
  const stationId = createMemo(() => props.station?.id);
  const talkStation = createMemo(() => (props.station ? isTalkStation(props.station.tags) : false));
  createEffect(
    () => [stationId(), talkStation()] as const,
    ([, talks]) => {
      const hear = listenForTalk(talks);
      talk = SILENT_TALK;
      return levelAtom.subscribe(({ left, right }) => {
        talk = hear(meterReading(Math.max(left, right)));
      });
    }
  );
  // The brush font comes in pieces by character, so each subtitle asks for its own.
  createEffect(
    () => undefined,
    () => {
      return captionsAtom.subscribe((captions) => {
        const text = captions.at(-1)?.text;
        if (text) {
          document.fonts
            .load('700 40px "LXGW WenKai", "LXGW WenKai TC"', text)
            .catch(() => undefined);
        }
      });
    }
  );
  // The listener belongs to the painting on show, so he changes with it.
  let scenery: Scene | null = null;
  let weather: Weather | null = null;
  // At night each painting is lit by something in it; by day some have weather and light of their own.
  let lighting: Night | null = null;
  // Each place's night light is worked out once and kept while it is night, so coming back to a place costs nothing.
  const nights = new Map<CountryCode, { image: ImageBitmap; layers: InkLayers; night: Night }>();
  let daylight: Day | null = null;
  let overhead: Sky | null = null;
  // Weather, light and blooms are drawn only on a hardware GPU, when shaders are on; made on first use.
  let gpu: InkLayers | null | undefined;
  const gpuOf = (withShaders: boolean) => {
    if (gpu === undefined) {
      const under = withShaders ? layerIn(underSlot) : null;
      const over = under ? layerIn(overSlot) : null;
      gpu = under && over ? { under, over } : null;
      if (!gpu) letGo({ under: under ?? undefined });
    }
    return gpu;
  };
  // Declared before the effects that draw, so a change of the shaders setting lets the old renderers go first.
  createEffect(shadersAtom, () => () => {
    letGo(gpu);
    gpu = undefined;
    // Made with the renderer just let go, so made afresh.
    weather = null;
    lighting = null;
    nights.clear();
    daylight = null;
    overhead = null;
  });
  // The sky changes without repainting: the shaders read it each frame.
  const skyNow = createMemo<SkyNow>(() => ({
    weather: weatherFor(region(), props.sky.weather),
    glow: props.sky.glow,
    night: nightAtom(),
    moon: props.sky.moon,
  }));
  const readSky = () => skyNow();
  let toneNow = DAY_TONE;
  // The place painted last, and the move whose bloom brought it, so a resize never blooms again.
  let painted: { region: CountryCode; move?: number } | null = null;
  let endChange: (() => void) | null = null;
  // While one painting gives way to the next, both hold their figures, posed as the front would draw them, so neither shows the holes cut for them nor jumps when the front takes them back.
  let holding = false;
  let figurePose: ListenerPose | null = null;

  // Only the place, day and night, the settings for weather and shaders, and the size repaint.
  createEffect(
    () => [region(), nightAtom(), environmentAtom(), shadersAtom()] as const,
    ([place, dark, withWeather, withShaders]) => {
      const element = box;
      if (!element) return;
      const tone = dark ? NIGHT_LOOK[place].tone : DAY_TONE;
      let gone = false;
      const paint = async () => {
        const image = await leafImage(place);
        const next = 1 - shown;
        const scenes = [sceneA, sceneB];
        const canvas = scenes[next];
        const old = scenes[shown];
        // A painting taken off the page before its leaf arrived has no size to paint at.
        if (gone || !canvas || !old || !element.isConnected) return;
        endChange?.();
        const leaving = scenery;
        const ground = dark ? NIGHT_LOOK[place] : undefined;
        // Without shaders the painting holds still: no weather or bloom, and its night light is painted in once.
        const layers = image ? gpuOf(withShaders) : null;
        const day = layers && withWeather && !dark ? makeDay(place, layers, readSky) : null;
        const scene = paintScene(canvas, {
          region: place,
          width: element.clientWidth,
          height: element.clientHeight,
          pixelRatio: pixelRatio(),
          image,
          ground: ground?.paint,
          inkStrength: ground?.inkStrength,
          erased: day?.erased,
        });
        if (!layers && dark && image && scene) lightOnce(canvas, scene, image);
        scenery = scene;
        toneNow = tone;
        if (weather?.place !== place || weather.tone !== tone)
          weather =
            layers && image
              ? makeWeather(place, image, leafSize(image), tone, layers, {
                  liveSmoke: Boolean(day?.erased),
                  windOf: () => skyNow().weather.wind,
                })
              : null;
        if (!dark) nights.clear();
        const lit = nights.get(place);
        if (layers && dark && image && (lit?.image !== image || lit.layers !== layers))
          nights.set(place, {
            image,
            layers,
            night: makeNight(place, image, layers, () => moonlight(skyNow())),
          });
        lighting = layers && dark && image ? (nights.get(place)?.night ?? null) : null;
        daylight = day;
        overhead = layers && withWeather ? makeSky(layers.over, readSky) : null;
        canvas.style.zIndex = "1";
        old.style.zIndex = "0";
        shown = next;
        const first = old.style.opacity !== "1";
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const moved = untrack(() => props.move);
        const blooms =
          layers !== null &&
          !first &&
          !still &&
          moved?.kind === "place" &&
          painted?.region !== place &&
          painted?.move !== moved.id;
        painted = { region: place, move: blooms ? moved.id : painted?.move };
        if (first) {
          canvas.style.transitionDuration = "0ms";
          old.style.transitionDuration = "0ms";
          canvas.style.opacity = "1";
          old.style.opacity = "0";
          return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const holed = copyOf(canvas);
        const leavingHoled = copyOf(old);
        // Each frame of the change, a painting is its holed leaf with its figures drawn back in.
        const hold = (target: HTMLCanvasElement, base: HTMLCanvasElement, held: Scene) => {
          const g = target.getContext("2d");
          if (!g) return;
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.clearRect(0, 0, target.width, target.height);
          g.drawImage(base, 0, 0);
          if (!figurePose) return restScene(target, held);
          g.setTransform(...held.transform);
          drawListener(g, held, figurePose);
        };
        const incoming = blooms ? copyOf(canvas) : canvas;
        const soak = blooms
          ? bloomer({ origin: moved.at, seed: Math.floor(Math.random() * 200) })
          : null;
        const start = performance.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let frame = 0;
        const finish = () => {
          clearTimeout(timer);
          cancelAnimationFrame(frame);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(holed, 0, 0);
          old.style.transitionDuration = "0ms";
          old.style.opacity = "0";
          holding = false;
          endChange = null;
        };
        const step = (now: number) => {
          if (leaving) hold(old, leavingHoled, leaving);
          if (scene) hold(incoming, holed, scene);
          if (soak) {
            const progress = (now - start) / BLOOM_MS;
            if (progress >= 1) return finish();
            soak(ctx, incoming, progress);
          }
          frame = requestAnimationFrame(step);
        };
        endChange = finish;
        holding = true;
        if (soak) {
          // The new place soaks through the paper over the old, from where the finger lifted.
          canvas.style.transitionDuration = "0ms";
          canvas.style.opacity = "1";
        } else {
          // The new painting fades in over the last.
          canvas.style.transitionDuration = `${FADE_MS}ms`;
          old.style.transitionDuration = `${FADE_MS}ms`;
          canvas.style.opacity = "1";
          old.style.opacity = "0";
          timer = setTimeout(finish, FADE_MS);
        }
        step(start);
      };
      // An observer reports the size it starts with too; only a real resize repaints, or it would cut the bloom short.
      const sizeOf = () => `${element.clientWidth}x${element.clientHeight}`;
      let paintedSize = sizeOf();
      void paint();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observer = new ResizeObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (sizeOf() === paintedSize) return;
          paintedSize = sizeOf();
          void paint();
        }, 150);
      });
      observer.observe(element);
      return () => {
        gone = true;
        clearTimeout(timer);
        observer.disconnect();
        endChange?.();
      };
    }
  );

  // The loop reads the renderer and the weather setting once, so it starts afresh when they change.
  createEffect(
    () => [moving(), environmentAtom(), shadersAtom()] as const,
    ([runs, withWeather, withShaders]) => {
      const canvas = front;
      const element = box;
      if (!runs || !canvas || !element) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Read once per resize, not every frame, which could force a layout.
      let width = element.clientWidth;
      let height = element.clientHeight;
      const keys = untrack(() => props.keys?.());
      // Subtitles keep the keys' own margin: from the screen's edge, the keys above and the usual inscription beside them.
      const captionRoom = () => {
        const frame = element.getBoundingClientRect();
        const keysBox = keys?.getBoundingClientRect();
        const margin = keysBox ? keysBox.left - frame.left : CAPTION_MARGIN;
        return {
          left: margin,
          top: (keysBox ? keysBox.bottom - frame.top : 0) + margin,
          right: frame.width - INSCRIPTION_ROOM - margin,
        };
      };
      let room = captionRoom();
      const observer = new ResizeObserver(() => {
        width = element.clientWidth;
        height = element.clientHeight;
        room = captionRoom();
      });
      observer.observe(element);
      if (keys) observer.observe(keys);
      const hearAir = listenToAir();
      const layers = gpuOf(withShaders);
      const written = subtitles?.getContext("2d") ?? null;
      let captionsShown = false;
      const writers = new WeakMap<
        Caption,
        { key: string; write: ReturnType<typeof captionWriter> }
      >();
      const writerOf = (
        caption: Caption,
        key: string,
        make: () => ReturnType<typeof captionWriter>
      ) => {
        const known = writers.get(caption);
        if (known?.key === key) return known.write;
        const write = make();
        writers.set(caption, { key, write });
        return write;
      };
      let gust: { start: number; direction: 1 | -1 } | null = null;
      let lastGust = untrack(() => props.move?.id);
      const mover = makeMover();
      let last = performance.now();
      let frame = 0;
      const layouts = new WeakMap<Caption, Layout>();
      const layoutOf = (caption: Caption) => {
        const known = layouts.get(caption);
        if (known) return known;
        const layout = layOut(caption.text, caption.readings);
        layouts.set(caption, layout);
        return layout;
      };

      const draw = (now: number) => {
        // Mist and falling leaves drift slowly, so they are drawn half as often; a gust or a
        // change of place moves fast, and goes at the screen's own pace.
        const moved = props.move;
        const hurried =
          gust !== null || holding || (moved?.kind === "station" && moved.id !== lastGust);
        if (!hurried && now - last < AMBIENT_FRAME_MS - FRAME_SLACK_MS) {
          frame = requestAnimationFrame(draw);
          return;
        }
        const seconds = Math.min(0.1, (now - last) / 1000);
        last = now;
        const ratio = pixelRatio();
        const [pixelsAcross, pixelsDown] = [Math.round(width * ratio), Math.round(height * ratio)];
        if (canvas.width !== pixelsAcross) canvas.width = pixelsAcross;
        if (canvas.height !== pixelsDown) canvas.height = pixelsDown;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        layers?.under.clear(pixelsAcross, pixelsDown);
        layers?.over.clear(pixelsAcross, pixelsDown);
        const scene = scenery;
        if (!scene) {
          frame = requestAnimationFrame(draw);
          return;
        }
        ctx.setTransform(...scene.transform);

        // The loop reads the pose as it is now, so it never restarts when the pose changes.
        const playing = props.listening;
        const writing = props.writing;
        const { left, right } = levelAtom.get();
        const captions = captionsAtom.get();
        // While subtitles are on, the speech models say when he speaks, how, and what plays;
        // otherwise the levels guess at talk from its pauses.
        const resting: FigurePose = { pitch: playing ? 0.05 : -1, lean: 0, jaw: 0 };
        const poses: Poses = still
          ? { figures: [writing ? { ...resting, pitch: -1 } : resting, resting], awake: 0 }
          : mover({
              now,
              seconds,
              playing,
              writing,
              subtitled: subtitlesStatusAtom.get() !== "off",
              captions,
              sound: soundAtom.get(),
              talk,
              loudness: meterReading(Math.max(left, right)),
            });
        const listenerPose: ListenerPose = { ...poses, writing, time: now / 1000 };
        figurePose = listenerPose;
        const held = holding;
        const air = hearAir({ playing, seconds });
        const tone = toneNow;
        const moment = {
          scene,
          air,
          time: now / 1000,
          seconds,
          still,
          held: held
            ? (g: CanvasRenderingContext2D) => drawListener(g, scene, listenerPose)
            : undefined,
        };
        // Light and mist are queued on the layer under the figures, what lies in front of them on
        // the layer over them, and both land once all is queued; what falls and the figures are
        // drawn in 2D between them.
        lighting?.under(ctx, moment);
        if (withWeather) weather?.draw(ctx, air, seconds, still);
        daylight?.draw(ctx, moment);
        if (!held) drawListener(ctx, scene, listenerPose);
        overhead?.draw(ctx, moment);
        weather?.veil(ctx, air);
        if (moved?.kind === "station" && moved.id !== lastGust) {
          lastGust = moved.id;
          gust = still ? null : { start: now, direction: moved.direction };
        }
        daylight?.over(ctx, moment);
        lighting?.over(ctx, moment);
        if (gust) {
          const progress = (now - gust.start) / GUST_MS;
          if (progress >= 1) gust = null;
          else {
            washOut(ctx, layers?.over, tone.paper, 0.9 * washOf(progress));
            weather?.gust(ctx, progress, gust.direction);
          }
        }
        layers?.under.flush();
        layers?.over.flush();

        // Subtitles are written at one size on every painting, however large its leaf is drawn: in units of the screen's height.
        const unit = (height * ratio) / LEAF_HEIGHT;
        const captionBox = {
          left: (room.left * ratio) / unit,
          // One line further down than the margin under the keys.
          top: (room.top * ratio) / unit + CAPTION_LINE,
          right: (room.right * ratio) / unit,
          bottom: LEAF_HEIGHT * CAPTION_END,
        };
        const shows = captions.map((caption, index) => shownFrom(caption, captions[index - 1]));
        const said = captions
          .map((caption, index) => ({
            caption,
            from: shows[index] ?? caption.at,
            alpha: inkLeft(caption, now, shows[index + 1] ?? null),
          }))
          .filter(({ from, alpha }) => now >= from && alpha > 0);
        // The subtitles' canvas is touched only while there are subtitles, and once more to clear it.
        if (written && (said.length > 0 || captionsShown)) {
          const page = written.canvas;
          if (page.width !== pixelsAcross) page.width = pixelsAcross;
          if (page.height !== pixelsDown) page.height = pixelsDown;
          written.setTransform(1, 0, 0, 1, 0, 0);
          written.clearRect(0, 0, page.width, page.height);
          const key = `${Object.values(captionBox).join()}:${unit}:${tone.paper}:${tone.writing}:${fontsLoaded}`;
          for (const { caption, from, alpha } of said) {
            const layout = layoutOf(caption);
            const sung = still ? layout.cells.map(() => 1) : sungBy(caption, layout, now);
            writerOf(caption, key, () => captionWriter(layout, captionBox, tone, unit))(
              written,
              sung,
              still ? 1 : shownBy(from, now),
              alpha
            );
          }
          captionsShown = said.length > 0;
        }

        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }
  );

  return (
    <div ref={(element) => (box = element)} aria-hidden="true" class="absolute inset-0 isolate">
      {/* The two canvases trade places; their order never changes. */}
      <canvas ref={(element) => (sceneA = element)} class={SCENE_CLASS} style={{ opacity: 0 }} />
      <canvas ref={(element) => (sceneB = element)} class={SCENE_CLASS} style={{ opacity: 0 }} />
      <div ref={(element) => (underSlot = element)} class="absolute inset-0 z-2" />
      <canvas ref={(element) => (front = element)} class="absolute inset-0 z-3 size-full" />
      <div ref={(element) => (overSlot = element)} class="absolute inset-0 z-4" />
      <canvas ref={(element) => (subtitles = element)} class="absolute inset-0 z-5 size-full" />
    </div>
  );
}
