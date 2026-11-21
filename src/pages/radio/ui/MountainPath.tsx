import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import type { Tape } from "@/shared/api/commands.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { environmentAtom, shadersAtom } from "@/shared/config/preferences.ts";
import { nightAtom } from "@/shared/lib/night.ts";
import { usePageVisible } from "@/shared/lib/use-page-visible.ts";
import { ariaBoolean } from "@/shared/lib/aria.ts";
import { AMBIENT_FRAME_MS, FRAME_SLACK_MS } from "@/pages/radio/lib/ink-pace.ts";
import { createInkGL } from "@/pages/radio/lib/ink-gl.ts";
import { formatMonthDay, formatShortDateTime } from "@/shared/lib/date.ts";
import { formatTapeTime } from "@/shared/lib/duration.ts";
import { cn } from "@/shared/lib/class-names.ts";
import { playCrack, playIgnite } from "@/shared/lib/key-sound.ts";
import {
  PATH_LENGTH,
  LIT_WINDOWS,
  MOONLIT_SKY,
  SCROLL,
  TRAVELLER,
  CANE,
  travellerPart,
  clampToPath,
  pathData,
  pointAt,
  slotAt,
} from "@/pages/radio/lib/scroll-path.ts";
import { MOVE_PX, useHold } from "@/pages/radio/model/use-hold.ts";
import { listenToAir } from "@/pages/radio/lib/air.ts";
import { makeWeather, type Weather } from "@/pages/radio/lib/ink-weather.ts";
import {
  DAY_TONE,
  FIRELIGHT,
  MOONLIT,
  PATH_NIGHT_GROUND,
  PATH_NIGHT_SKY,
  PATH_NIGHT_TONE,
} from "@/pages/radio/lib/ink-tone.ts";
import { Seal } from "@/pages/radio/ui/Seal.tsx";
import painting from "./ink/monastery-path.webp";

/** How wide the painting is, in screen widths: close enough to walk in, far enough to see where. */
const SCREENS_ACROSS = 2.3;
/** How far a slip stands off the path, in px. */
const SLIP_OFFSET_PX = 46;
/** How close the old man stands to the side of a slip, in px. */
const STAND_CLEAR_PX = 6;
/** How far back along the path he looks for a place to stand clear of the slips, and in what steps. */
const STAND_SEARCH = 600;
const STAND_STEP = 3;
/** How far sideways the path must head before he turns to face that way. */
const TURN_HEADING = 0.15;
/** Where on the screen, from the top, the camera keeps the place it looks at. */
const EYE_LINE = 0.56;
/** How quickly the camera catches up with where it should look, each frame; faster under a finger. */
const FOLLOW = 0.12;
const FOLLOW_DRAGGING = 0.4;
/** How much of its speed a fling keeps each frame. */
const FRICTION = 0.93;
/** How quickly slips glide to new places along the path, each frame. */
const GLIDE = 0.08;
/** How long the traveller takes to walk, in ms: a pause to set off, then by the distance. */
const WALK_START_MS = 900;
const WALK_MS_PER_PX = 4;
const WALK_MAX_MS = 15_000;
/** His gait as he walks: ms per stride, how far he rocks and bobs, and how far his cane swings ahead and back. */
const STRIDE_MS = 1100;
const ROCK_DEG = 4;
const BOB_PX = 2;
const CANE_SWING_DEG = 14;
/** The old man's blow, in ms from when he reaches the slip: raising the cane, bringing it down, holding, lowering it. */
const RAISE_MS = 800;
const HIT_MS = 1050;
const HOLD_MS = 1500;
const SWING_MS = 2400;
/** How far the cane turns about his hand, in degrees forward from hanging: raised high, then down on the slip. */
const RAISED_DEG = 130;
const STRUCK_DEG = 55;
/** How far he leans into it, in degrees: back as he raises it, forward as it lands. */
const RAISE_LEAN_DEG = 5;
const STRIKE_LEAN_DEG = -8;
/** At night, where the light round the old man is centred on him, in layer px, and how far it reaches, and a burning slip's. */
const GLOW_AT = [232, 3285] as const;
const GLOW_REACH = 210;
/** How strongly the firelight lies on the paper at its heart, falling off as the boat's lamp does. */
const GLOW_HEART = 0.55;
/** How far the lamplight from a house reaches, in layer px. */
const WINDOW_REACH = 85;
const SLIP_FIRELIGHT_REACH = 150;
/** How long a slip takes to burn away, in ms. */
const BURN_MS = 2600;
/** How long the broken pieces take to fade away, while a tap can still mend them, in ms. */
const FADE_MS = 5000;
/** How long the pieces take to fly back together, in ms. */
const MEND_MS = 600;

/** Waiting for the old man's cane, in pieces and fading, or flying back together. */
type BreakPhase = "awaiting" | "broken" | "mending";

/** The pieces a slip breaks into, as a clip path, and where each falls. */
const SHARDS = [
  { clip: "polygon(0 0, 60% 0, 45% 35%, 0 50%)", x: "-0.8rem", y: "1.4rem", turn: "-6deg" },
  {
    clip: "polygon(60% 0, 100% 0, 100% 40%, 55% 55%, 45% 35%)",
    x: "0.9rem",
    y: "1.1rem",
    turn: "15deg",
  },
  {
    clip: "polygon(0 50%, 45% 35%, 55% 55%, 40% 100%, 0 100%)",
    x: "-0.6rem",
    y: "2.6rem",
    turn: "-12deg",
  },
  {
    clip: "polygon(55% 55%, 100% 40%, 100% 100%, 40% 100%)",
    x: "0.7rem",
    y: "2.3rem",
    turn: "9deg",
  },
];

/** Where a slip tied to the stone at `at`, on `side` of the path, stands on the painting, in px. */
function slipPlace(at: number, side: 1 | -1, k: number) {
  const stone = pointAt(at);
  return {
    x: Math.max(
      28,
      Math.min(SCROLL.width * k - 28, stone.x * k - stone.dy * side * SLIP_OFFSET_PX)
    ),
    y: stone.y * k + stone.dx * side * SLIP_OFFSET_PX,
  };
}

/**
 * Where the old man stops by the slip `id`: as near its stone as he can stand, coming from
 * where he is, without any slip hiding him, so he waits just beside its edge.
 */
function standBy(state: Motion, id: string, slipEls: Map<string, HTMLElement>) {
  const { scale: k, slots, walk } = state;
  const target = slots.get(id)?.target ?? walk.at;
  const boxes = [...slots].flatMap(([slipId, slot]) => {
    const card = slipEls.get(slipId)?.firstElementChild;
    if (!(card instanceof HTMLElement)) return [];
    const { x, y } = slipPlace(slot.target, slot.side, k);
    const [w, h] = [card.offsetWidth / 2 + STAND_CLEAR_PX, card.offsetHeight / 2 + STAND_CLEAR_PX];
    return [{ left: x - w, right: x + w, top: y - h, bottom: y + h }];
  });
  const half = (TRAVELLER.width / 2) * k;
  const above = (TRAVELLER.feet[1] - TRAVELLER.top) * k;
  const below = (TRAVELLER.top + TRAVELLER.height - TRAVELLER.feet[1]) * k;
  const hidden = (at: number) => {
    const feet = pointAt(at);
    const [x, y] = [feet.x * k, feet.y * k];
    return boxes.some(
      (box) =>
        x + half > box.left && x - half < box.right && y + below > box.top && y - above < box.bottom
    );
  };
  const back = Math.sign(walk.at - target) || -1;
  for (let along = 0; along <= STAND_SEARCH; along += STAND_STEP) {
    const at = clampToPath(target + back * along);
    if (!hidden(at)) return at;
  }
  return walk.at;
}

/** Sets the walker off from where he stands to `to`, at his pace. */
function walkTo(state: Motion, to: number, now: number, still: boolean) {
  const at = state.walk.at;
  const duration = still
    ? 0
    : Math.min(WALK_MAX_MS, WALK_START_MS + Math.abs(to - at) * WALK_MS_PER_PX);
  state.walk = { at, from: at, to, start: now, duration };
  state.speed = 0;
}

/**
 * The old man's pose `elapsed` ms into a blow, in degrees as he faces in the painting
 * (left): the cane turned forward about his hand, and his lean, forward negative. By day he
 * brings his cane down on the slip; at night he bends to it as it catches fire.
 */
function blowPose(elapsed: number, burning: boolean) {
  const between = (from: number, to: number, start: number, end: number) => {
    const u = Math.min(1, Math.max(0, (elapsed - start) / (end - start)));
    return from + (to - from) * (1 - (1 - u) ** 2);
  };
  if (burning) {
    if (elapsed < HIT_MS) return { cane: 0, lean: between(0, STRIKE_LEAN_DEG, 0, HIT_MS) };
    if (elapsed < HOLD_MS) return { cane: 0, lean: STRIKE_LEAN_DEG };
    return { cane: 0, lean: between(STRIKE_LEAN_DEG, 0, HOLD_MS, SWING_MS) };
  }
  if (elapsed < RAISE_MS)
    return {
      cane: between(0, RAISED_DEG, 0, RAISE_MS),
      lean: between(0, RAISE_LEAN_DEG, 0, RAISE_MS),
    };
  if (elapsed < HIT_MS)
    return {
      cane: between(RAISED_DEG, STRUCK_DEG, RAISE_MS, HIT_MS),
      lean: between(RAISE_LEAN_DEG, STRIKE_LEAN_DEG, RAISE_MS, HIT_MS),
    };
  if (elapsed < HOLD_MS) return { cane: STRUCK_DEG, lean: STRIKE_LEAN_DEG };
  return {
    cane: between(STRUCK_DEG, 0, HOLD_MS, SWING_MS),
    lean: between(STRIKE_LEAN_DEG, 0, HOLD_MS, SWING_MS),
  };
}

/** Where the camera, the walker and every slip are, kept outside the reactive graph and drawn each frame. */
interface Motion {
  scale: number;
  view: { width: number; height: number };
  camera: { x: number; y: number } | null;
  focus: number;
  speed: number;
  drag: { id: number; x: number; y: number; moved: boolean; at: number } | null;
  walk: { at: number; from: number; to: number; start: number; duration: number };
  slots: Map<string, { at: number; target: number; side: 1 | -1 }>;
  /** Slips held to be broken, in turn; the old man walks to the first. */
  strikes: string[];
  swing: { id: string; start: number; hit: boolean } | null;
  /** Which way the old man faces: left, as in the painting, or right. */
  facesRight: boolean;
}

interface TravellerCutout {
  width: number;
  height: number;
  body: ImageData;
  cane: ImageData;
  /** A mask of where he stood, to take him out of the painting once he walks off. */
  hole: string;
}

let travellerCutout: Promise<TravellerCutout | null> | null = null;

/**
 * The old man cut from the painting, body and cane apart, worked out once: going over every
 * pixel of him takes long enough to stall the path's opening.
 */
function cutTraveller() {
  travellerCutout ??= (async () => {
    const image = new Image();
    image.src = painting;
    await image.decode();
    const ratio = image.naturalWidth / SCROLL.width;
    const width = Math.round(TRAVELLER.width * ratio);
    const height = Math.round(TRAVELLER.height * ratio);
    const source = document.createElement("canvas");
    Object.assign(source, { width, height });
    const reader = source.getContext("2d", { willReadFrequently: true });
    if (!reader) return null;
    reader.drawImage(
      image,
      TRAVELLER.left * ratio,
      TRAVELLER.top * ratio,
      width,
      height,
      0,
      0,
      width,
      height
    );
    const ink = reader.getImageData(0, 0, width, height);
    const parts = { body: new ImageData(width, height), cane: new ImageData(width, height) };
    const covered = new ImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const part = travellerPart(
          TRAVELLER.left + x / ratio,
          TRAVELLER.top + y / ratio,
          ink.data[i + 3]
        );
        if (!part) continue;
        parts[part].data.set(ink.data.subarray(i, i + 4), i);
        // Paper over the stroke and a pixel round it, fully, so no ghost of him stays.
        for (const [ox, oy] of [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const [cx, cy] = [x + ox, y + oy];
          if (cx >= 0 && cy >= 0 && cx < width && cy < height)
            covered.data[(cy * width + cx) * 4 + 3] = 255;
        }
      }
    }
    const holeCanvas = document.createElement("canvas");
    Object.assign(holeCanvas, { width, height });
    holeCanvas.getContext("2d")?.putImageData(covered, 0, 0);
    return { width, height, ...parts, hole: holeCanvas.toDataURL() };
  })().catch(() => {
    travellerCutout = null;
    return null;
  });
  return travellerCutout;
}

/**
 * The recordings along a path up Chen Chun's hanging scroll, newest just above the bridge and
 * each older one further up toward the peak. The man on the bridge walks to whichever one plays, and
 * breaks a held one with his cane.
 */
export function MountainPath(props: {
  tapes: Tape[];
  playing: Tape | null;
  hint: string | null;
  onPlay: (tape: Tape) => void;
  onBreak: (tape: Tape) => void;
  onDelete: (tape: Tape) => void;
  onLeave: () => void;
}) {
  const m = useMessages();
  // At night the moon dims the paper, light glows round the old man, and he burns what he is asked to break.
  const tone = () => (nightAtom() ? PATH_NIGHT_TONE : DAY_TONE);
  const [breaks, setBreaks] = createSignal<Record<string, BreakPhase>>({});
  const [gone, setGone] = createSignal<ReadonlySet<string>>(new Set());
  const [scale, setScale] = createSignal(0);
  /** Every slip held to be broken, until it is deleted or mended; its timer runs once it is broken. */
  const doomed = new Map<string, { tape: Tape; timer?: ReturnType<typeof setTimeout> }>();

  const shown = createMemo(() => props.tapes.filter((tape) => !gone().has(tape.id)));
  const motion: Motion = {
    scale: 0,
    view: { width: 0, height: 0 },
    camera: null,
    // The path opens at the bottom, on the old man on his bridge.
    focus: 0,
    speed: 0,
    drag: null,
    walk: { at: 0, from: 0, to: 0, start: 0, duration: 0 },
    slots: new Map(),
    strikes: [],
    swing: null,
    // Turned from the painting from the start, to face up the path he sets off on.
    facesRight: true,
  };

  let viewport: HTMLDivElement | undefined;
  let world: HTMLDivElement | undefined;
  let traveller: HTMLDivElement | undefined;
  let body: HTMLCanvasElement | undefined;
  let cane: HTMLCanvasElement | undefined;
  let glow: HTMLDivElement | undefined;
  const slipFirelights = new Map<string, HTMLElement>();
  let paintingImage: HTMLImageElement | undefined;
  const [hole, setHole] = createSignal<string | null>(null);
  let sky: HTMLCanvasElement | undefined;
  let walked: SVGPathElement | undefined;
  let ahead: SVGPathElement | undefined;
  let leave: HTMLButtonElement | undefined;
  const slipEls = new Map<string, HTMLElement>();
  const tieEls = new Map<string, SVGGElement>();
  /** Keeps an element under `id` for as long as the row that holds it lives. */
  const kept = <E extends Element>(elements: Map<string, E>, id: string) => {
    onCleanup(() => elements.delete(id));
    return (element: E) => elements.set(id, element);
  };

  // Every recording has a place on the path; the others glide along to make room.
  const place = (ids: string[]) => {
    const slots = motion.slots;
    ids.forEach((id, index) => {
      const target = slotAt(index, ids.length);
      // Counted from the oldest, so a new recording at the bridge leaves the rest on their sides.
      const side = (ids.length - 1 - index) % 2 ? 1 : -1;
      const slot = slots.get(id);
      if (slot) Object.assign(slot, { target, side });
      else slots.set(id, { at: target, target, side });
    });
    for (const id of slots.keys()) if (!ids.includes(id)) slots.delete(id);
  };
  const shownIds = createMemo(() =>
    shown()
      .map((tape) => tape.id)
      .join(" ")
  );
  // Placed before the first frame, and again whenever the recordings change.
  place(untrack(shownIds).split(" ").filter(Boolean));
  createEffect(shownIds, (ids) => place(ids.split(" ").filter(Boolean)), { defer: true });

  // The traveller walks to the recording that starts playing.
  const playingId = createMemo(() => props.playing?.id ?? null);
  let walkedTo = untrack(playingId);
  createEffect(playingId, (id) => {
    if (walkedTo === id) return;
    walkedTo = id;
    if (!id || !motion.slots.has(id) || motion.strikes.length) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    walkTo(motion, standBy(motion, id, slipEls), performance.now(), still);
  });

  const phase = (id: string, next: BreakPhase | null) =>
    setBreaks((all) => {
      const rest = { ...all };
      delete rest[id];
      return next ? { ...rest, [id]: next } : rest;
    });

  // The cane lands: the slip breaks, and is deleted once its pieces have faded.
  const hit = (id: string) => {
    const pending = doomed.get(id);
    if (!pending) return;
    phase(id, "broken");
    if (nightAtom()) playIgnite();
    else playCrack();
    props.onBreak(pending.tape);
    pending.timer = setTimeout(() => {
      doomed.delete(id);
      phase(id, null);
      setGone((ids) => new Set(ids).add(id));
      props.onDelete(pending.tape);
    }, FADE_MS);
  };

  // Leaving the path deletes every slip held to be broken at once, broken yet or not.
  const remove = untrack(() => props.onDelete);
  onCleanup(() => {
    for (const { tape, timer } of doomed.values()) {
      clearTimeout(timer);
      remove(tape);
    }
    doomed.clear();
  });

  onSettled(() => {
    const element = viewport;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      motion.view = { width, height };
      motion.scale = (width * SCREENS_ACROSS) / SCROLL.width;
      setScale(motion.scale);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  onSettled(() => leave?.focus());

  const visible = usePageVisible();
  createEffect(
    () => [visible(), environmentAtom(), shadersAtom()] as const,
    ([showing, withWeather, withShaders]) => {
      if (!showing) return;
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      let raf = 0;
      let lastTrail = -1;
      /** Where the camera was, and when, as the weather was last drawn. */
      let drawnSky = { x: Number.NaN, y: Number.NaN, at: performance.now() };
      const hearAir = listenToAir();
      // Its weather is drawn only on a hardware GPU, when shaders are on: its mist on a layer over
      // the 2D canvas of what moves, riding the camera with it.
      const gl = withShaders ? createInkGL() : null;
      const skyCanvas = sky;
      if (gl && skyCanvas) {
        gl.canvas.className = skyCanvas.className;
        gl.canvas.setAttribute("aria-hidden", "true");
        skyCanvas.after(gl.canvas);
      }
      const layers = gl ? { under: gl, over: gl } : null;
      let weather: Weather | null = null;
      const image = new Image();
      if (layers) {
        image.src = painting;
        image
          .decode()
          .then(() => (weather = makeWeather("path", image, SCROLL, tone(), layers)))
          .catch(() => undefined);
      }
      // What each element was last given, so a frame where nothing moves writes nothing.
      const given = new WeakMap<Element, Map<string, string>>();
      const changed = (element: Element, key: string, value: string) => {
        const known = given.get(element) ?? new Map<string, string>();
        given.set(element, known);
        if (known.get(key) === value) return false;
        known.set(key, value);
        return true;
      };
      const style = (
        element: HTMLElement | SVGElement | null | undefined,
        key: "translate" | "transform" | "rotate" | "opacity" | "zIndex",
        value: string
      ) => {
        if (element && changed(element, key, value)) element.style[key] = value;
      };
      const attribute = (element: Element | null | undefined, key: string, value: string) => {
        if (element && changed(element, key, value)) element.setAttribute(key, value);
      };
      const draw = (now: number) => {
        raf = requestAnimationFrame(draw);
        if (layers && weather && weather.tone !== tone())
          weather = makeWeather("path", image, SCROLL, tone(), layers);
        const state = motion;
        const { scale: k, view } = state;
        if (!k) return;

        const walk = state.walk;
        const striking = state.strikes[0];
        const strikeSlot = striking ? state.slots.get(striking) : undefined;
        if (striking && !strikeSlot) state.strikes.shift();
        else if (striking && strikeSlot && walk.at === walk.to && !state.swing) {
          const stand = standBy(state, striking, slipEls);
          if (Math.abs(walk.at - stand) > STAND_STEP) walkTo(state, stand, now, still);
          else state.swing = { id: striking, start: now, hit: false };
        }
        const swing = state.swing;
        const swingElapsed = swing ? (still ? SWING_MS : now - swing.start) : 0;
        if (swing && !swing.hit && swingElapsed >= HIT_MS) {
          swing.hit = true;
          hit(swing.id);
        }
        if (swing && swingElapsed >= SWING_MS) {
          state.swing = null;
          state.strikes.shift();
        }

        // How far into his stride he is, swelling in as he sets off and fading as he arrives.
        let gait = 0;
        if (walk.at !== walk.to) {
          const u = walk.duration ? Math.min(1, (now - walk.start) / walk.duration) : 1;
          gait = Math.sin(Math.PI * u);
          const eased = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
          walk.at = u >= 1 ? walk.to : walk.from + (walk.to - walk.from) * eased;
          if (!state.drag?.moved) state.focus = walk.at;
        } else if (!state.drag && Math.abs(state.speed) > 0.05) {
          state.focus = clampToPath(state.focus + state.speed);
          state.speed *= FRICTION;
        }

        const eye = pointAt(state.focus);
        const target = {
          x: Math.max(0, Math.min(SCROLL.width * k - view.width, eye.x * k - view.width / 2)),
          y: Math.max(
            0,
            Math.min(SCROLL.height * k - view.height, eye.y * k - view.height * EYE_LINE)
          ),
        };
        // A finger resting on the painting holds it still, so a slip never slides out from under a tap.
        const follow = state.drag ? (state.drag.moved ? FOLLOW_DRAGGING : 0) : FOLLOW;
        if (!state.camera) state.camera = target;
        const camera = state.camera;
        camera.x += (target.x - camera.x) * follow;
        camera.y += (target.y - camera.y) * follow;
        style(world, "transform", `translate3d(${-camera.x}px, ${-camera.y}px, 0)`);
        // The weather covers only the screen, so it rides along with the camera.
        const weatherCanvas = sky;
        const ctx = weatherCanvas?.getContext("2d");
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.round(view.width * ratio);
        const height = Math.round(view.height * ratio);
        const resized = weatherCanvas?.width !== width || weatherCanvas.height !== height;
        // While the camera rests the weather is drawn half as often; it rides with the camera,
        // so a moving camera redraws it every frame.
        const resting =
          Math.abs(camera.x - drawnSky.x) < 0.25 && Math.abs(camera.y - drawnSky.y) < 0.25;
        const due = now - drawnSky.at >= AMBIENT_FRAME_MS - FRAME_SLACK_MS;
        if (weatherCanvas && ctx && weather && (resized || !resting || due)) {
          const canvases = gl ? [weatherCanvas, gl.canvas] : [weatherCanvas];
          if (resized) {
            Object.assign(weatherCanvas, { width, height });
            for (const canvas of canvases)
              Object.assign(canvas.style, {
                width: `${view.width}px`,
                height: `${view.height}px`,
              });
          }
          const skySeconds = Math.min(0.1, (now - drawnSky.at) / 1000);
          drawnSky = { x: camera.x, y: camera.y, at: now };
          for (const canvas of canvases) style(canvas, "translate", `${camera.x}px ${camera.y}px`);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, width, height);
          gl?.clear(width, height);
          ctx.setTransform(k * ratio, 0, 0, k * ratio, -camera.x * ratio, -camera.y * ratio);
          const air = hearAir({ playing: playingId() !== null, seconds: skySeconds });
          if (withWeather) weather.draw(ctx, air, skySeconds, still);
          weather.veil(ctx, air);
          gl?.flush();
        }

        let highestSlip = 0;
        for (const [id, slot] of state.slots) {
          slot.at =
            still || Math.abs(slot.target - slot.at) < 0.3
              ? slot.target
              : slot.at + (slot.target - slot.at) * GLIDE;
          highestSlip = Math.max(highestSlip, slot.at);
          const stone = pointAt(slot.at);
          const { x, y } = slipPlace(slot.at, slot.side, k);
          const slip = slipEls.get(id);
          style(slip, "translate", `${x}px ${y}px`);
          style(slipFirelights.get(id), "translate", `${x}px ${y}px`);
          style(slip, "zIndex", String(Math.max(0, Math.round(y))));
          const tie = tieEls.get(id);
          attribute(tie?.firstElementChild, "d", `M${stone.x * k} ${stone.y * k}L${x} ${y}`);
          attribute(tie?.lastElementChild, "cx", String(stone.x * k));
          attribute(tie?.lastElementChild, "cy", String(stone.y * k));
        }
        if (Math.abs(highestSlip - lastTrail) > 0.5) {
          lastTrail = highestSlip;
          walked?.setAttribute("d", pathData(0, highestSlip, k));
          ahead?.setAttribute("d", pathData(highestSlip, PATH_LENGTH, k));
        }

        const feet = pointAt(walk.at);
        const walking = walk.at !== walk.to;
        // He faces the way he walks, and keeps facing it when he stops; a nearly upright
        // stretch of path does not turn him round.
        const heading = feet.dx * Math.sign(walk.to - walk.from);
        if (walking && Math.abs(heading) > TURN_HEADING) state.facesRight = heading > 0;
        if (traveller) {
          const stride = (2 * Math.PI * (now - walk.start)) / STRIDE_MS;
          const bob = -Math.abs(Math.sin(stride)) * BOB_PX * gait;
          const pose = swing ? blowPose(swingElapsed, nightAtom()) : null;
          const lean = pose ? pose.lean : Math.sin(stride) * ROCK_DEG * gait;
          const caneTurn = pose ? pose.cane : Math.sin(stride) * CANE_SWING_DEG * gait;
          style(cane, "rotate", `${caneTurn}deg`);
          const glowX = feet.x + (state.facesRight ? -1 : 1) * (GLOW_AT[0] - TRAVELLER.feet[0]);
          const glowY = feet.y + GLOW_AT[1] - TRAVELLER.feet[1];
          // The glow is there only at night, and a new one each night.
          if (glow?.isConnected) style(glow, "translate", `${glowX * k}px ${glowY * k + bob}px`);
          style(
            traveller,
            "translate",
            `${(feet.x - TRAVELLER.feet[0] + TRAVELLER.left) * k}px ${(feet.y - TRAVELLER.feet[1] + TRAVELLER.top) * k + bob}px`
          );
          style(traveller, "transform", `scaleX(${state.facesRight ? -1 : 1}) rotate(${lean}deg)`);
        }
        attribute(paintingImage, "data-away", String(walk.at > 4));
      };
      raf = requestAnimationFrame(draw);
      return () => {
        cancelAnimationFrame(raf);
        gl?.dispose();
        gl?.canvas.remove();
      };
    }
  );

  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      const step = 140 / (motion.scale || 1);
      const moves: Record<string, number> = {
        ArrowUp: motion.focus + step,
        PageUp: motion.focus + step * 4,
        ArrowDown: motion.focus - step,
        PageDown: motion.focus - step * 4,
        Home: 0,
        End: PATH_LENGTH,
      };
      if (!(event.key in moves)) return;
      event.preventDefault();
      motion.focus = clampToPath(moves[event.key]);
      motion.speed = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const strike = (tape: Tape) => {
    if (doomed.has(tape.id)) return;
    doomed.set(tape.id, { tape });
    phase(tape.id, "awaiting");
    motion.strikes.push(tape.id);
  };

  const mend = (tape: Tape) => {
    const pending = doomed.get(tape.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    doomed.delete(tape.id);
    phase(tape.id, "mending");
    setTimeout(() => phase(tape.id, null), MEND_MS);
  };

  // The old man is cut from the painting itself, body and cane apart so the cane can swing,
  // and once he walks off, his strokes on the bridge are masked out of it, so the paper
  // behind shows there as it does everywhere else, lit or not.
  onSettled(() => {
    let cancelled = false;
    void cutTraveller()
      .then((cutout) => {
        if (!cutout || cancelled || !body || !cane) return;
        const { width, height } = cutout;
        for (const [canvas, pixels] of [
          [body, cutout.body],
          [cane, cutout.cane],
        ] as const) {
          Object.assign(canvas, { width, height });
          canvas.getContext("2d")?.putImageData(pixels, 0, 0);
        }
        setHole(cutout.hole);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  });

  const k = scale;
  const px = (length: number) => `${length}px`;
  return (
    <section
      data-control
      role="dialog"
      aria-modal="true"
      aria-label={m.radio.pathTitle}
      class="fixed inset-0 z-10 overflow-clip bg-paper text-ink select-none"
    >
      <div
        ref={(element) => (viewport = element)}
        class="absolute inset-0 cursor-grab touch-none overflow-clip active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          motion.speed = 0;
          motion.drag = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
            at: performance.now(),
          };
        }}
        onPointerMove={(event) => {
          const drag = motion.drag;
          if (!drag || drag.id !== event.pointerId) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (!drag.moved) {
            if (Math.hypot(dx, dy) < MOVE_PX) return;
            drag.moved = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          // Dragging pulls the painting along the path: down to climb, sideways where it winds.
          const heading = pointAt(motion.focus);
          const along =
            (dy * 0.7 - (dx * heading.dx + dy * heading.dy) * 0.6) / (motion.scale || 1);
          motion.focus = clampToPath(motion.focus + along);
          const now = performance.now();
          motion.speed = 0.6 * motion.speed + 0.4 * along * (16 / Math.max(8, now - drag.at));
          Object.assign(drag, { x: event.clientX, y: event.clientY, at: now });
        }}
        onPointerUp={() => {
          const drag = motion.drag;
          if (drag && performance.now() - drag.at > 90) motion.speed = 0;
          motion.drag = null;
        }}
        onPointerCancel={() => {
          motion.drag = null;
        }}
        onWheel={(event) => {
          motion.focus = clampToPath(
            motion.focus - ((event.deltaY + event.deltaX / 2) * 0.9) / (motion.scale || 1)
          );
          motion.speed = 0;
        }}
      >
        <div
          ref={(element) => (world = element)}
          class="absolute top-0 left-0 will-change-transform"
          style={{
            width: px(SCROLL.width * k()),
            height: px(SCROLL.height * k()),
            background: nightAtom()
              ? `linear-gradient(rgb(${PATH_NIGHT_SKY}), rgb(${PATH_NIGHT_GROUND}) 70%)`
              : undefined,
          }}
        >
          <Show when={nightAtom()}>
            <div aria-hidden="true" class="pointer-events-none absolute inset-0">
              <Moonlight scale={k()} />
              <For each={LIT_WINDOWS}>
                {([x, y], index) => (
                  <Firelight
                    at={{ x: x * k(), y: y * k() }}
                    reach={WINDOW_REACH * k()}
                    strength={0.7}
                    waver={`${2.6 + index() * 0.45}s`}
                  />
                )}
              </For>
              <Firelight
                ref={(element) => (glow = element)}
                reach={GLOW_REACH * k()}
                waver="1.4s"
              />
              <For each={shown().filter((tape) => breaks()[tape.id] === "broken")} keyed={idOf}>
                {(tape) => (
                  <Firelight
                    ref={kept(slipFirelights, untrack(tape).id)}
                    reach={SLIP_FIRELIGHT_REACH * k()}
                  />
                )}
              </For>
            </div>
          </Show>
          <img
            ref={(element) => (paintingImage = element)}
            src={painting}
            alt=""
            draggable="false"
            class="absolute inset-0 size-full data-[away=true]:[mask:var(--hole)]"
            style={{
              "--hole": hole()
                ? `url(${hole()}) ${TRAVELLER.left * k()}px ${TRAVELLER.top * k()}px / ${TRAVELLER.width * k()}px ${TRAVELLER.height * k()}px no-repeat exclude, linear-gradient(#000, #000)`
                : undefined,
            }}
          />
          <canvas
            ref={(element) => (sky = element)}
            aria-hidden="true"
            class="pointer-events-none absolute top-0 left-0"
          />
          <svg
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 size-full overflow-visible"
          >
            <path
              ref={(element) => (walked = element)}
              fill="none"
              stroke="var(--color-ink)"
              stroke-opacity="0.55"
              stroke-width="2.8"
              stroke-linecap="round"
              stroke-dasharray="0.5 8"
            />
            <path
              ref={(element) => (ahead = element)}
              fill="none"
              stroke="var(--color-ink)"
              stroke-opacity="0.22"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-dasharray="0.5 9"
            />
            <For each={shown()} keyed={idOf}>
              {(tape) => (
                <g
                  ref={kept(tieEls, untrack(tape).id)}
                  class={[
                    "transition-opacity duration-1000",
                    { "opacity-0": breaks()[tape().id] === "broken" },
                  ]}
                >
                  <path stroke="var(--color-ink)" stroke-opacity="0.45" />
                  <circle
                    r={tape().id === playingId() ? "4.5" : "3.2"}
                    fill={tape().id === playingId() ? "var(--color-seal)" : "var(--color-ink)"}
                  />
                </g>
              )}
            </For>
          </svg>
          <div
            ref={(element) => (traveller = element)}
            aria-hidden="true"
            class={[TRAVELLER_BOX, { "drop-shadow-[0_0_2px_var(--paper)]": !nightAtom() }]}
            style={{
              width: px(TRAVELLER.width * k()),
              height: px(TRAVELLER.height * k()),
              "transform-origin": `${((TRAVELLER.feet[0] - TRAVELLER.left) / TRAVELLER.width) * 100}% ${((TRAVELLER.feet[1] - TRAVELLER.top) / TRAVELLER.height) * 100}%`,
            }}
          >
            {/* The paper he stands on, at night lit by his own glow. */}
            <canvas
              ref={(element) => (body = element)}
              class="absolute inset-0 size-full"
              style={{
                background: nightAtom()
                  ? `radial-gradient(closest-side, rgba(${FIRELIGHT}, ${GLOW_HEART / 2}) 30%, transparent), radial-gradient(closest-side, rgb(${PATH_NIGHT_GROUND}) 40%, transparent)`
                  : "radial-gradient(closest-side, var(--paper) 65%, transparent)",
              }}
            />
            <canvas
              ref={(element) => (cane = element)}
              class="absolute inset-0 size-full"
              style={{
                "transform-origin": `${((CANE.hand[0] - TRAVELLER.left) / TRAVELLER.width) * 100}% ${((CANE.hand[1] - TRAVELLER.top) / TRAVELLER.height) * 100}%`,
              }}
            />
          </div>
          <Show
            when={shown().length > 0}
            fallback={
              <p
                class="absolute w-[min(20rem,80vw)] -translate-x-1/2 -translate-y-full bg-paper/85 px-4 py-2 text-center font-serif text-[1.1rem] font-bold text-ink"
                style={{
                  left: px(
                    Math.min(Math.max(170, TRAVELLER.feet[0] * k()), SCROLL.width * k() - 170)
                  ),
                  top: px(TRAVELLER.top * k() - 24),
                }}
              >
                {m.radio.noRecordings}
              </p>
            }
          >
            <ol>
              <For each={shown()} keyed={idOf}>
                {(tape) => (
                  <li
                    ref={kept(slipEls, untrack(tape).id)}
                    class="absolute top-0 left-0"
                    onFocusIn={(event) => {
                      // Only a slip reached by keyboard; a tapped one is already in view.
                      if (!event.target.matches(":focus-visible")) return;
                      const slot = motion.slots.get(tape().id);
                      if (slot) motion.focus = slot.target;
                    }}
                  >
                    <Slip
                      tape={tape()}
                      current={tape().id === playingId()}
                      broken={breaks()[tape().id] ?? null}
                      burns={nightAtom()}
                      onPlay={() => props.onPlay(tape())}
                      onHold={() => strike(tape())}
                      onMend={() => mend(tape())}
                    />
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </div>
      </div>

      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 bg-background motion-safe:animate-[scroll-unroll_1.4s_cubic-bezier(0.6,0,0.3,1)_0.15s_forwards] motion-reduce:hidden"
      >
        <div class="absolute -inset-x-2 -top-2 h-5 rounded-full bg-ink shadow-[0_4px_10px_color-mix(in_oklch,var(--ink)_35%,transparent)] before:absolute before:inset-y-0.5 before:left-0 before:w-3 before:rounded-full before:bg-gilt after:absolute after:inset-y-0.5 after:right-0 after:w-3 after:rounded-full after:bg-gilt" />
      </div>

      <Seal
        ref={(element) => (leave = element)}
        pressed
        aria-label={m.radio.sealLabels.leavePath}
        class="absolute top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))]"
        onClick={() => props.onLeave()}
      >
        {m.radio.seals.path}
      </Seal>
      <p
        aria-hidden="true"
        lang="zh"
        class="pointer-events-none absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1.75rem,env(safe-area-inset-right))] bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--paper)_85%,transparent),transparent)] px-2.5 py-2 font-brush text-[1.6rem] leading-none text-ink [writing-mode:vertical-rl]"
      >
        {m.radio.pathInscription}
      </p>

      <div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 bg-linear-to-t from-paper/90 from-40% to-transparent pt-8 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <p class="min-w-0 flex-1 text-right font-serif text-sm font-bold tracking-wide text-ink-soft">
          {props.hint ?? (nightAtom() ? m.radio.pathHintNight : m.radio.pathHint)}
        </p>
      </div>
    </section>
  );
}

const idOf = (tape: Tape) => tape.id;

/**
 * Firelight on the paper, `reach` px round where it is put, under the painting's ink layer as the
 * boat's lamp is on the radio: the paper glows and the ink stays as it is.
 */
function Firelight(props: {
  ref?: (element: HTMLDivElement) => void;
  reach: number;
  /** Where it is put, in screen px, when it stays there; otherwise it is moved each frame. */
  at?: { x: number; y: number };
  /** How bright it is, against the old man's glow. */
  strength?: number;
  /** How long it takes to waver, for a steady light; otherwise a burning slip's flare and dying away. */
  waver?: string;
}) {
  const light = (alpha: number) => `rgba(${FIRELIGHT}, ${alpha * (props.strength ?? 1)})`;
  return (
    <div
      ref={props.ref}
      class="absolute top-0 left-0"
      style={{
        width: `${2 * props.reach}px`,
        height: `${2 * props.reach}px`,
        margin: `${-props.reach}px`,
        ...(props.at ? { translate: `${props.at.x}px ${props.at.y}px` } : {}),
      }}
    >
      <div
        class={[
          "size-full",
          props.waver
            ? "motion-safe:animate-[firelight-waver_var(--waver)_ease-in-out_infinite_alternate]"
            : "motion-safe:animate-[slip-firelight_5s_linear_forwards] motion-reduce:hidden",
        ]}
        style={{
          "--waver": props.waver,
          background: `radial-gradient(closest-side, ${light(GLOW_HEART)}, ${light(0.45)} 12%, ${light(0.2)} 35%, ${light(0.06)} 65%, ${light(0)})`,
        }}
      />
    </div>
  );
}

/** Moonlight on the open sky between the peaks, on the paper under the ink like the firelight. */
function Moonlight(props: { scale: number }) {
  const moon = (alpha: number) => `rgba(${MOONLIT}, ${alpha})`;
  return (
    <div
      class="absolute inset-0"
      style={{
        background: MOONLIT_SKY.map(
          ({ x, y, across, down }) =>
            `radial-gradient(${across * props.scale}px ${down * props.scale}px at ${x * props.scale}px ${y * props.scale}px, ${moon(0.38)}, ${moon(0.2)} 45%, ${moon(0)})`
        ).join(", "),
      }}
    />
  );
}

/** Where a burning slip's paper is left, on a mask three times its height: above a ragged charred edge. */
const RAGGED_EDGE = "L90 157L80 146L70 155L60 144L50 156L40 147L30 158L20 145L10 154L0 148";
const svgUrl = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 300' preserveAspectRatio='none'>${body}</svg>`)}")`;
const BURN_MASK = svgUrl(`<path d='M0 0H100V150${RAGGED_EDGE}Z'/>`);
/** The scorch along that edge, and the glowing line where it burns. */
const SCORCH = svgUrl(
  `<path d='M100 150${RAGGED_EDGE}' fill='none' stroke='rgb(40,26,16)' stroke-opacity='0.8' stroke-width='16' stroke-linejoin='round'/>` +
    `<path d='M100 150${RAGGED_EDGE}' fill='none' stroke='rgb(240,128,44)' stroke-width='3.5' stroke-linejoin='round'/>`
);
/** Where the tongues of flame stand along the burning edge, across the slip. */
const TONGUES = [
  { left: "18%", size: 0.85, delay: "-0.2s" },
  { left: "42%", size: 1.15, delay: "-0.5s" },
  { left: "64%", size: 1, delay: "0s" },
  { left: "86%", size: 0.75, delay: "-0.35s" },
];

/**
 * A slip set alight: it burns away from the bottom up behind a charred edge with flames along
 * it, leaving embers that fade while a tap can still bring it back; brought back, it unburns.
 */
function BurningSlip(props: { face: () => JSX.Element; edge: string; mending: boolean }) {
  return (
    <span
      aria-hidden="true"
      class={[
        "absolute inset-0 motion-reduce:opacity-40",
        props.mending
          ? "motion-safe:animate-[slip-unburn_600ms_ease-out_forwards]"
          : "motion-safe:animate-[slip-burn_var(--burn-ms)_cubic-bezier(0.45,0,0.75,1)_forwards]",
      ]}
      style={{ "--burn-ms": `${BURN_MS}ms` }}
    >
      <span
        class={cn(FACE, props.edge, "absolute inset-0")}
        style={{
          "mask-image": BURN_MASK,
          "mask-size": "100% 300%",
          "mask-repeat": "no-repeat",
          "mask-position": "0 var(--burn)",
        }}
      >
        {props.face()}
        <span
          class="absolute inset-0"
          style={{
            "background-image": SCORCH,
            "background-size": "100% 300%",
            "background-repeat": "no-repeat",
            "background-position": "0 var(--burn)",
          }}
        />
      </span>
      <Show when={!props.mending}>
        <span
          class="absolute inset-x-0 h-0 motion-safe:animate-[flames-run_var(--burn-ms)_linear_forwards] motion-reduce:hidden"
          style={{ bottom: "calc(2 * var(--burn) - 50%)" }}
        >
          <For each={TONGUES}>
            {(tongue) => (
              <span
                class="absolute bottom-0 -translate-x-1/2 origin-bottom motion-safe:animate-[flame-flicker_0.8s_ease-in-out_var(--delay)_infinite]"
                style={{
                  left: tongue.left,
                  width: `${0.6 * tongue.size}rem`,
                  height: `${1.15 * tongue.size}rem`,
                  "border-radius": "50% 50% 50% 50% / 62% 62% 38% 38%",
                  background:
                    "radial-gradient(ellipse 50% 60% at 50% 78%, rgb(255 236 176), rgb(248 160 56) 45%, rgb(206 72 34 / 0.85) 75%, transparent)",
                  "--delay": tongue.delay,
                }}
              />
            )}
          </For>
        </span>
        <span
          class="absolute inset-x-1 -bottom-0.5 h-1.5 rounded-full motion-safe:animate-[fade-away_5s_ease-in_forwards] motion-reduce:hidden"
          style={{
            background:
              "radial-gradient(circle at 25% 50%, rgb(250 140 50) 0 1.5px, transparent 2px), radial-gradient(circle at 70% 40%, rgb(250 140 50) 0 1px, transparent 1.5px), rgb(62 58 54 / 0.8)",
          }}
        />
      </Show>
    </span>
  );
}

/** The old man's box, moved and turned with him each frame. */
const TRAVELLER_BOX = "pointer-events-none absolute top-0 left-0";

const FACE =
  "flex flex-col items-center gap-1 border bg-background/95 px-1.5 pt-2 pb-1.5 text-ink shadow-[1px_2px_0_color-mix(in_oklch,var(--ink)_12%,transparent)]";

/** A recording as a paper slip by the path; held, the old man breaks it with his cane and its pieces fade. */
function Slip(props: {
  tape: Tape;
  current: boolean;
  broken: BreakPhase | null;
  /** Set alight by the old man, at night, rather than broken by his cane. */
  burns: boolean;
  onPlay: () => void;
  onHold: () => void;
  onMend: () => void;
}) {
  const m = useMessages();
  const recorded = () => formatShortDateTime(props.tape.recordedAt);
  const length = () => formatTapeTime(props.tape.duration);
  const { holding, handlers } = useHold(
    () => props.onPlay(),
    () => props.onHold()
  );
  const inPieces = () => props.broken === "broken" || props.broken === "mending";
  const edge = () =>
    props.current
      ? "border-seal shadow-[0_0_0_3px_color-mix(in_oklch,var(--seal)_15%,transparent),1px_2px_0_color-mix(in_oklch,var(--ink)_12%,transparent)]"
      : "border-ink/35";
  // The slip's face is drawn once whole and once on each piece it breaks into.
  const face = () => (
    <>
      <Show when={props.current}>
        <span
          aria-hidden="true"
          lang="zh"
          class="absolute -top-2.5 -right-3 rotate-6 rounded-[2px] bg-seal px-0.5 py-1 font-brush text-[0.75rem] leading-none text-paper [writing-mode:vertical-rl]"
        >
          {m.radio.seals.playing}
        </span>
      </Show>
      <span
        lang="zh"
        class="font-brush text-[1.15rem] leading-[1.05] font-bold [writing-mode:vertical-rl]"
      >
        {props.tape.station.name}
      </span>
      <span class="text-center whitespace-nowrap font-serif text-[0.8rem] leading-tight font-bold text-ink-soft tabular-nums">
        {formatMonthDay(props.tape.recordedAt)}
        <br />
        {length()}
      </span>
    </>
  );
  return (
    <div class="absolute -translate-1/2">
      <button
        type="button"
        aria-label={m.radio.playRecording(props.tape.station.name, recorded(), length())}
        aria-hidden={ariaBoolean(inPieces())}
        class={cn(
          FACE,
          edge(),
          "relative cursor-pointer outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          (holding() || props.broken === "awaiting") &&
            "motion-safe:animate-[slip-flutter_120ms_linear_infinite]",
          props.broken === "awaiting" && "pointer-events-none",
          inPieces() && "invisible"
        )}
        {...handlers}
      >
        {face()}
      </button>
      <Show when={inPieces()}>
        <button
          type="button"
          aria-label={(props.burns ? m.radio.unburn : m.radio.mend)(props.tape.station.name)}
          disabled={props.broken !== "broken"}
          class="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ink"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => props.onMend()}
        >
          <Show
            when={props.burns}
            fallback={
              <For each={SHARDS}>
                {(shard) => (
                  <span
                    aria-hidden="true"
                    class={cn(
                      FACE,
                      edge(),
                      "absolute inset-0",
                      props.broken === "broken"
                        ? "motion-safe:animate-[shard-break_700ms_cubic-bezier(0.2,0.7,0.4,1)_forwards,fade-away_5s_linear_forwards] motion-reduce:opacity-40"
                        : "motion-safe:animate-[shard-mend_600ms_ease-out_backwards]"
                    )}
                    style={{
                      "clip-path": shard.clip,
                      "--shard-x": shard.x,
                      "--shard-y": shard.y,
                      "--shard-turn": shard.turn,
                    }}
                  >
                    {face()}
                  </span>
                )}
              </For>
            }
          >
            <BurningSlip face={face} edge={edge()} mending={props.broken === "mending"} />
          </Show>
        </button>
      </Show>
    </div>
  );
}
