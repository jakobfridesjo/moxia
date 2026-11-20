import { useEffect, useRef, type RefObject } from "react";
import { useSelector } from "@tanstack/react-store";
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
import { inkIn, inkLeft, layOut, type Layout } from "@/pages/radio/lib/captions.ts";
import {
  captionBox,
  drawCaption,
  drawDrift,
  drawListener,
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
import { createInkGL, type InkGL } from "@/pages/radio/lib/ink-gl.ts";
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
  /** The keys in the top corner: subtitles start clear of them. */
  keys?: RefObject<HTMLElement | null>;
}

/** How long a scene takes to fade into the next, in ms, when it does not bloom. */
const FADE_MS = 1300;
/** How long a new place takes to soak through, and mist takes to blow past, in ms. */
const BLOOM_MS = 2200;
const GUST_MS = 2800;
/** How far below the keys subtitles start, in CSS pixels. */
const CAPTION_CLEAR = 24;
const SILENT_TALK: Talk = { talking: false, voice: 0 };

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** How far a change of station has washed the painting out, 0 to 1, `progress` of the way through: in over the first third, held a moment, then back. */
const washOf = (progress: number) =>
  ease(clamp01(progress / 0.35)) * (1 - ease(clamp01((progress - 0.5) / 0.5)));

/** The paper, "r,g,b", laid over everything drawn so far at `alpha`: by day a wash, by night the dark. */
function washOut(ctx: CanvasRenderingContext2D, gl: InkGL | null, paper: string, alpha: number) {
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

/**
 * The painting behind the radio: two canvases take turns holding a place's leaf
 * so a new place fades in over the old, and a third draws the part that moves.
 */
export function InkScene({
  region,
  station,
  listening,
  writing,
  move,
  sky,
  covered = false,
  keys,
}: InkSceneProps) {
  const night = useSelector(nightAtom);
  const environment = useSelector(environmentAtom);
  const shaders = useSelector(shadersAtom);
  const moving = usePageVisible() && !covered;
  const tone = night ? NIGHT_LOOK[region].tone : DAY_TONE;
  const box = useRef<HTMLDivElement>(null);
  const sceneA = useRef<HTMLCanvasElement>(null);
  const sceneB = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const shown = useRef(0);
  // The animation loop reads the pose from here, so it never restarts when the pose changes.
  const pose = useRef({ listening, writing });
  useEffect(() => {
    pose.current = { listening, writing };
  }, [listening, writing]);
  // Every level the player reports goes to a listener that starts afresh with each station.
  const talk = useRef(SILENT_TALK);
  const talkStation = station ? isTalkStation(station.tags) : false;
  useEffect(() => {
    const hear = listenForTalk(talkStation);
    talk.current = SILENT_TALK;
    const subscription = levelAtom.subscribe(({ left, right }) => {
      talk.current = hear(meterReading(Math.max(left, right)));
    });
    return () => subscription.unsubscribe();
  }, [station?.id, talkStation]);
  // The brush font comes in pieces by character, so each subtitle asks for its own.
  useEffect(() => {
    const subscription = captionsAtom.subscribe((captions) => {
      const text = captions.at(-1)?.text;
      if (text) {
        document.fonts
          .load('700 40px "LXGW WenKai", "LXGW WenKai TC"', text)
          .catch(() => undefined);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  // The listener belongs to the painting on show, so he changes with it.
  const scenery = useRef<Scene | null>(null);
  const weather = useRef<Weather | null>(null);
  // At night each painting is lit by something in it; by day some have weather and light of their own.
  const lighting = useRef<Night | null>(null);
  const daylight = useRef<Day | null>(null);
  // Weather, light and blooms are drawn only on the GPU, when there is WebGL2 and shaders are on; made on first use.
  const gpu = useRef<InkGL | null | undefined>(undefined);
  const gpuOf = () => {
    if (gpu.current === undefined) gpu.current = shaders ? createInkGL() : null;
    return gpu.current;
  };
  useEffect(
    () => () => {
      gpu.current?.dispose();
      gpu.current = undefined;
      // Made with the renderer just let go, so made afresh.
      weather.current = null;
      lighting.current = null;
      daylight.current = null;
      overhead.current = null;
    },
    [shaders]
  );
  // The sky changes without repainting: the shaders read it each frame.
  const skyNow = useRef<SkyNow>({
    weather: weatherFor(region, null),
    glow: 0,
    night,
    moon: sky.moon,
  });
  useEffect(() => {
    skyNow.current = {
      weather: weatherFor(region, sky.weather),
      glow: sky.glow,
      night,
      moon: sky.moon,
    };
  }, [region, sky.weather, sky.glow, sky.moon, night]);
  const overhead = useRef<Sky | null>(null);
  const toneNow = useRef(tone);
  const lastMove = useRef(move);
  useEffect(() => {
    lastMove.current = move;
  }, [move]);
  // The place painted last, and the move whose bloom brought it, so a resize never blooms again.
  const painted = useRef<{ region: CountryCode; move?: number } | null>(null);
  const endChange = useRef<(() => void) | null>(null);
  // While one painting gives way to the next, both hold their figures, posed as the front would draw them, so neither shows the holes cut for them nor jumps when the front takes them back.
  const holding = useRef(false);
  const figurePose = useRef<ListenerPose | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let gone = false;
    const paint = async () => {
      const image = await leafImage(region);
      const next = 1 - shown.current;
      const scenes = [sceneA.current, sceneB.current];
      const canvas = scenes[next];
      const old = scenes[shown.current];
      if (gone || !canvas || !old) return;
      endChange.current?.();
      const leaving = scenery.current;
      const ground = night ? NIGHT_LOOK[region] : undefined;
      // Without shaders the painting holds still: no weather or bloom, and its night light is painted in once.
      const gl = image ? gpuOf() : null;
      const readSky = () => skyNow.current;
      const day = gl && environment && !night ? makeDay(region, gl, readSky) : null;
      const scene = paintScene(canvas, {
        region,
        width: element.clientWidth,
        height: element.clientHeight,
        pixelRatio: pixelRatio(),
        image,
        ground: ground?.paint,
        inkStrength: ground?.inkStrength,
        erased: day?.erased,
      });
      if (!gl && night && image && scene) lightOnce(canvas, scene, image);
      scenery.current = scene;
      toneNow.current = tone;
      if (weather.current?.place !== region || weather.current.tone !== tone)
        weather.current =
          gl && image
            ? makeWeather(region, image, leafSize(image), tone, gl, {
                liveSmoke: Boolean(day?.erased),
                windOf: () => skyNow.current.weather.wind,
              })
            : null;
      lighting.current =
        gl && night && image ? makeNight(region, image, gl, () => moonlight(skyNow.current)) : null;
      daylight.current = day;
      overhead.current = gl && environment ? makeSky(gl, readSky) : null;
      canvas.style.zIndex = "1";
      old.style.zIndex = "0";
      shown.current = next;
      const first = old.style.opacity !== "1";
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const moved = lastMove.current;
      const blooms =
        gl !== null &&
        !first &&
        !still &&
        moved?.kind === "place" &&
        painted.current?.region !== region &&
        painted.current?.move !== moved.id;
      painted.current = { region, move: blooms ? moved.id : painted.current?.move };
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
      const hold = (target: HTMLCanvasElement, base: HTMLCanvasElement, painted: Scene) => {
        const g = target.getContext("2d");
        if (!g) return;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, target.width, target.height);
        g.drawImage(base, 0, 0);
        if (!figurePose.current) return restScene(target, painted);
        g.setTransform(...painted.transform);
        drawListener(g, painted, figurePose.current);
      };
      const incoming = blooms ? copyOf(canvas) : canvas;
      const soak = blooms
        ? bloomer({ origin: moved.at, seed: Math.floor(Math.random() * 200) }, gl)
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
        holding.current = false;
        endChange.current = null;
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
      endChange.current = finish;
      holding.current = true;
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
      endChange.current?.();
    };
    // The canvas refs are stable; only the place, day and night, the settings for weather and shaders, and the size repaint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, night, environment, shaders]);

  useEffect(() => {
    const canvas = front.current;
    const element = box.current;
    if (!moving || !canvas || !element) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Read once per resize, not every frame, which could force a layout.
    let width = element.clientWidth;
    let height = element.clientHeight;
    const keysEnd = () =>
      keys?.current
        ? keys.current.getBoundingClientRect().bottom - element.getBoundingClientRect().top
        : 0;
    let captionTop = keysEnd() + CAPTION_CLEAR;
    const observer = new ResizeObserver(() => {
      width = element.clientWidth;
      height = element.clientHeight;
      captionTop = keysEnd() + CAPTION_CLEAR;
    });
    observer.observe(element);
    if (keys?.current) observer.observe(keys.current);
    const hearAir = listenToAir();
    const gl = gpuOf();
    let gust: { start: number; direction: 1 | -1 } | null = null;
    let lastGust = lastMove.current?.id;
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
      const moved = lastMove.current;
      const hurried =
        gust !== null || holding.current || (moved?.kind === "station" && moved.id !== lastGust);
      if (!hurried && now - last < AMBIENT_FRAME_MS - FRAME_SLACK_MS) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      const ratio = pixelRatio();
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scene = scenery.current;
      if (!scene) {
        frame = requestAnimationFrame(draw);
        return;
      }
      ctx.setTransform(...scene.transform);

      const { listening: playing, writing } = pose.current;
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
            talk: talk.current,
            loudness: meterReading(Math.max(left, right)),
          });
      const listenerPose: ListenerPose = { ...poses, writing, time: now / 1000 };
      figurePose.current = listenerPose;
      const held = holding.current;
      const air = hearAir({ playing, seconds });
      const tone = toneNow.current;
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
      // Light and mist on the GPU wait in `gl`, and land in one go before anything drawn in 2D.
      lighting.current?.under(ctx, moment);
      if (environment) weather.current?.draw(ctx, air, seconds, still);
      daylight.current?.draw(ctx, moment);
      gl?.flush(ctx);
      if (gl && environment && !still) drawDrift(ctx, (now / 1000) * 6, tone);
      if (!held) drawListener(ctx, scene, listenerPose);
      overhead.current?.draw(ctx, moment);
      weather.current?.veil(ctx, air);
      if (moved?.kind === "station" && moved.id !== lastGust) {
        lastGust = moved.id;
        gust = still ? null : { start: now, direction: moved.direction };
      }
      daylight.current?.over(ctx, moment);
      lighting.current?.over(ctx, moment);
      if (gust) {
        const progress = (now - gust.start) / GUST_MS;
        if (progress >= 1) gust = null;
        else {
          washOut(ctx, gl, tone.paper, 0.9 * washOf(progress));
          weather.current?.gust(ctx, progress, gust.direction);
        }
      }
      gl?.flush(ctx);

      const [a, , , d, e, f] = scene.transform;
      const bounds = {
        left: -e / a,
        top: (captionTop * ratio - f) / d,
        right: (canvas.width - e) / a,
        bottom: (canvas.height - f) / d,
      };
      captions.forEach((caption, index) => {
        const alpha = inkLeft(caption, now, captions[index + 1]?.at ?? null);
        if (alpha <= 0) return;
        const layout = layoutOf(caption);
        const inks = still ? layout.cells.map(() => 1) : inkIn(caption, layout, now);
        drawCaption(ctx, layout, inks, captionBox(scene.region), { alpha, bounds, tone });
      });

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // The loop reads the renderer and the weather setting once, so it starts afresh when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, environment, shaders]);

  return (
    <div ref={box} aria-hidden className="absolute inset-0 isolate">
      {/* The two canvases trade places; their order never changes. */}
      <canvas ref={sceneA} className={SCENE_CLASS} style={{ opacity: 0 }} />
      <canvas ref={sceneB} className={SCENE_CLASS} style={{ opacity: 0 }} />
      <canvas ref={front} className="absolute inset-0 z-2 size-full" />
    </div>
  );
}
