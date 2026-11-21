import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSelector } from "@tanstack/react-store";
import type { Tape } from "@/shared/api/commands.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { environmentAtom, shadersAtom } from "@/shared/config/preferences.ts";
import { nightAtom } from "@/shared/lib/night.ts";
import { usePageVisible } from "@/shared/lib/use-page-visible.ts";
import { AMBIENT_FRAME_MS, FRAME_SLACK_MS } from "@/pages/radio/lib/ink-pace.ts";
import { createInkGL } from "@/pages/radio/lib/ink-gl.ts";
import { formatMonthDay, formatShortDateTime } from "@/shared/lib/date.ts";
import { formatTapeTime } from "@/shared/lib/duration.ts";
import { cn } from "@/shared/lib/class-names.ts";
import { playCrack } from "@/shared/lib/key-sound.ts";
import {
  PATH_LENGTH,
  PLACES,
  SCROLL,
  TRAVELLER,
  CANE,
  travellerPart,
  clampToPath,
  pathData,
  placeAt,
  pointAt,
  slotAt,
  type PlaceName,
} from "@/pages/radio/lib/scroll-path.ts";
import { MOVE_PX, useHold } from "@/pages/radio/model/use-hold.ts";
import { listenToAir } from "@/pages/radio/lib/air.ts";
import { makeWeather, type Weather } from "@/pages/radio/lib/ink-weather.ts";
import { DAY_TONE, PATH_NIGHT_TONE } from "@/pages/radio/lib/ink-tone.ts";
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
 * (left): the cane turned forward about his hand, and his lean, forward negative.
 */
function blowPose(elapsed: number) {
  const between = (from: number, to: number, start: number, end: number) => {
    const u = Math.min(1, Math.max(0, (elapsed - start) / (end - start)));
    return from + (to - from) * (1 - (1 - u) ** 2);
  };
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

/** Where the camera, the walker and every slip are, kept outside React and drawn each frame. */
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
  /** Paper over where he stood. */
  covered: ImageData;
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
    return { width, height, ...parts, covered };
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
export function MountainPath({
  tapes,
  playing,
  hint,
  onPlay,
  onBreak,
  onDelete,
  onLeave,
}: {
  tapes: Tape[];
  playing: Tape | null;
  hint: string | null;
  onPlay: (tape: Tape) => void;
  onBreak: (tape: Tape) => void;
  onDelete: (tape: Tape) => void;
  onLeave: () => void;
}) {
  const m = useMessages();
  // At night the painting turns pale on dark paper, and its weather with it.
  const night = useSelector(nightAtom);
  const tone = useRef(night ? PATH_NIGHT_TONE : DAY_TONE);
  useLayoutEffect(() => {
    tone.current = night ? PATH_NIGHT_TONE : DAY_TONE;
  }, [night]);
  const [breaks, setBreaks] = useState<Record<string, BreakPhase>>({});
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [scale, setScale] = useState(0);
  /** Every slip held to be broken, until it is deleted or mended; its timer runs once it is broken. */
  const doomed = useRef(new Map<string, { tape: Tape; timer?: ReturnType<typeof setTimeout> }>());
  const remove = useRef(onDelete);
  const broke = useRef(onBreak);
  useLayoutEffect(() => {
    remove.current = onDelete;
    broke.current = onBreak;
  });

  const shown = tapes.filter((tape) => !gone.has(tape.id));
  const motion = useRef<Motion>({
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
  });

  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const traveller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLCanvasElement>(null);
  const cane = useRef<HTMLCanvasElement>(null);
  const patch = useRef<HTMLCanvasElement>(null);
  const sky = useRef<HTMLCanvasElement>(null);
  const walked = useRef<SVGPathElement>(null);
  const ahead = useRef<SVGPathElement>(null);
  const slipEls = useRef(new Map<string, HTMLElement>());
  const tieEls = useRef(new Map<string, SVGGElement>());

  // Every recording has a place on the path; the others glide along to make room.
  const shownIds = shown.map((tape) => tape.id).join(" ");
  useLayoutEffect(() => {
    const slots = motion.current.slots;
    const ids = shownIds ? shownIds.split(" ") : [];
    ids.forEach((id, index) => {
      const target = slotAt(index, ids.length);
      // Counted from the oldest, so a new recording at the bridge leaves the rest on their sides.
      const side = (ids.length - 1 - index) % 2 ? 1 : -1;
      const slot = slots.get(id);
      if (slot) Object.assign(slot, { target, side });
      else slots.set(id, { at: target, target, side });
    });
    for (const id of slots.keys()) if (!ids.includes(id)) slots.delete(id);
  }, [shownIds]);

  // The traveller walks to the recording that starts playing.
  const playingId = playing?.id ?? null;
  const sounding = useRef(false);
  useEffect(() => {
    sounding.current = playingId !== null;
  }, [playingId]);
  const walkedTo = useRef(playingId);
  useEffect(() => {
    if (walkedTo.current === playingId) return;
    walkedTo.current = playingId;
    const state = motion.current;
    if (!playingId || !state.slots.has(playingId) || state.strikes.length) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    walkTo(state, standBy(state, playingId, slipEls.current), performance.now(), still);
  }, [playingId]);

  const phase = (id: string, next: BreakPhase | null) =>
    setBreaks((all) => {
      const rest = { ...all };
      delete rest[id];
      return next ? { ...rest, [id]: next } : rest;
    });

  // The cane lands: the slip breaks, and is deleted once its pieces have faded.
  const hit = useRef((_id: string) => {});
  useLayoutEffect(() => {
    hit.current = (id) => {
      const pending = doomed.current.get(id);
      if (!pending) return;
      phase(id, "broken");
      playCrack();
      broke.current(pending.tape);
      pending.timer = setTimeout(() => {
        doomed.current.delete(id);
        phase(id, null);
        setGone((ids) => new Set(ids).add(id));
        remove.current(pending.tape);
      }, FADE_MS);
    };
  });

  // Leaving the path deletes every slip held to be broken at once, broken yet or not.
  useEffect(() => {
    const pending = doomed.current;
    return () => {
      for (const { tape, timer } of pending.values()) {
        clearTimeout(timer);
        remove.current(tape);
      }
      pending.clear();
    };
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      motion.current.view = { width, height };
      motion.current.scale = (width * SCREENS_ACROSS) / SCROLL.width;
      setScale(motion.current.scale);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const visible = usePageVisible();
  const environment = useSelector(environmentAtom);
  const shaders = useSelector(shadersAtom);
  useEffect(() => {
    if (!visible) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let lastTrail = -1;
    /** Where the camera was, and when, as the weather was last drawn. */
    let drawnSky = { x: Number.NaN, y: Number.NaN, at: performance.now() };
    const hearAir = listenToAir();
    // Its weather is drawn only on a hardware GPU, when shaders are on: its mist on a layer over
    // the 2D canvas of what moves, riding the camera with it.
    const gl = shaders ? createInkGL() : null;
    const skyCanvas = sky.current;
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
        .then(() => (weather = makeWeather("path", image, SCROLL, tone.current, layers)))
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
      element: HTMLElement | null | undefined,
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
      if (layers && weather && weather.tone !== tone.current)
        weather = makeWeather("path", image, SCROLL, tone.current, layers);
      const state = motion.current;
      const { scale: k, view } = state;
      if (!k) return;

      const walk = state.walk;
      const striking = state.strikes[0];
      const strikeSlot = striking ? state.slots.get(striking) : undefined;
      if (striking && !strikeSlot) state.strikes.shift();
      else if (striking && strikeSlot && walk.at === walk.to && !state.swing) {
        const stand = standBy(state, striking, slipEls.current);
        if (Math.abs(walk.at - stand) > STAND_STEP) walkTo(state, stand, now, still);
        else state.swing = { id: striking, start: now, hit: false };
      }
      const swing = state.swing;
      const swingElapsed = swing ? (still ? SWING_MS : now - swing.start) : 0;
      if (swing && !swing.hit && swingElapsed >= HIT_MS) {
        swing.hit = true;
        hit.current(swing.id);
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
      style(world.current, "transform", `translate3d(${-camera.x}px, ${-camera.y}px, 0)`);
      // The weather covers only the screen, so it rides along with the camera.
      const weatherCanvas = sky.current;
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
        const shown = gl ? [weatherCanvas, gl.canvas] : [weatherCanvas];
        if (resized) {
          Object.assign(weatherCanvas, { width, height });
          for (const canvas of shown)
            Object.assign(canvas.style, { width: `${view.width}px`, height: `${view.height}px` });
        }
        const skySeconds = Math.min(0.1, (now - drawnSky.at) / 1000);
        drawnSky = { x: camera.x, y: camera.y, at: now };
        for (const canvas of shown) style(canvas, "translate", `${camera.x}px ${camera.y}px`);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        gl?.clear(width, height);
        ctx.setTransform(k * ratio, 0, 0, k * ratio, -camera.x * ratio, -camera.y * ratio);
        const air = hearAir({ playing: sounding.current, seconds: skySeconds });
        if (environment) weather.draw(ctx, air, skySeconds, still);
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
        const slip = slipEls.current.get(id);
        style(slip, "translate", `${x}px ${y}px`);
        style(slip, "zIndex", String(Math.max(0, Math.round(y))));
        const tie = tieEls.current.get(id);
        attribute(tie?.firstElementChild, "d", `M${stone.x * k} ${stone.y * k}L${x} ${y}`);
        attribute(tie?.lastElementChild, "cx", String(stone.x * k));
        attribute(tie?.lastElementChild, "cy", String(stone.y * k));
      }
      if (Math.abs(highestSlip - lastTrail) > 0.5) {
        lastTrail = highestSlip;
        walked.current?.setAttribute("d", pathData(0, highestSlip, k));
        ahead.current?.setAttribute("d", pathData(highestSlip, PATH_LENGTH, k));
      }

      const feet = pointAt(walk.at);
      const walking = walk.at !== walk.to;
      // He faces the way he walks, and keeps facing it when he stops; a nearly upright
      // stretch of path does not turn him round.
      const heading = feet.dx * Math.sign(walk.to - walk.from);
      if (walking && Math.abs(heading) > TURN_HEADING) state.facesRight = heading > 0;
      if (traveller.current) {
        const stride = (2 * Math.PI * (now - walk.start)) / STRIDE_MS;
        const bob = -Math.abs(Math.sin(stride)) * BOB_PX * gait;
        const pose = swing ? blowPose(swingElapsed) : null;
        const lean = pose ? pose.lean : Math.sin(stride) * ROCK_DEG * gait;
        const caneTurn = pose ? pose.cane : Math.sin(stride) * CANE_SWING_DEG * gait;
        style(cane.current, "rotate", `${caneTurn}deg`);
        style(
          traveller.current,
          "translate",
          `${(feet.x - TRAVELLER.feet[0] + TRAVELLER.left) * k}px ${(feet.y - TRAVELLER.feet[1] + TRAVELLER.top) * k + bob}px`
        );
        style(
          traveller.current,
          "transform",
          `scaleX(${state.facesRight ? -1 : 1}) rotate(${lean}deg)`
        );
      }
      style(patch.current, "opacity", walk.at > 4 ? "1" : "0");
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      gl?.dispose();
      gl?.canvas.remove();
    };
  }, [visible, environment, shaders]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = motion.current;
      const step = 140 / (state.scale || 1);
      const moves: Record<string, number> = {
        ArrowUp: state.focus + step,
        PageUp: state.focus + step * 4,
        ArrowDown: state.focus - step,
        PageDown: state.focus - step * 4,
        Home: 0,
        End: PATH_LENGTH,
      };
      if (!(event.key in moves)) return;
      event.preventDefault();
      state.focus = clampToPath(moves[event.key]);
      state.speed = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const strike = (tape: Tape) => {
    if (doomed.current.has(tape.id)) return;
    doomed.current.set(tape.id, { tape });
    phase(tape.id, "awaiting");
    motion.current.strikes.push(tape.id);
  };

  const mend = (tape: Tape) => {
    const pending = doomed.current.get(tape.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    doomed.current.delete(tape.id);
    phase(tape.id, "mending");
    setTimeout(() => phase(tape.id, null), MEND_MS);
  };

  // The old man is cut from the painting itself, body and cane apart so the cane can swing,
  // and once he walks off, paper covers the strokes he left on the bridge. At night he turns
  // pale with the painting.
  useEffect(() => {
    let cancelled = false;
    void cutTraveller()
      .then((cutout) => {
        const canvases = [body.current, cane.current, patch.current];
        if (!cutout || cancelled || canvases.some((canvas) => !canvas)) return;
        const { width, height } = cutout;
        const [bodyCanvas, caneCanvas, patchCanvas] = canvases as HTMLCanvasElement[];
        for (const [canvas, pixels] of [
          [bodyCanvas, cutout.body],
          [caneCanvas, cutout.cane],
          [patchCanvas, cutout.covered],
        ] as const) {
          Object.assign(canvas, { width, height });
          canvas.getContext("2d")?.putImageData(pixels, 0, 0);
        }
        for (const canvas of night ? canvases : [patchCanvas]) {
          const recolour = canvas?.getContext("2d");
          if (!canvas || !recolour) continue;
          recolour.globalCompositeOperation = "source-in";
          recolour.fillStyle = getComputedStyle(canvas).color;
          recolour.fillRect(0, 0, width, height);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [night]);

  const k = scale;
  return (
    <section
      data-control
      role="dialog"
      aria-modal
      aria-label={m.radio.pathTitle}
      className="fixed inset-0 z-10 overflow-clip bg-paper text-ink select-none"
    >
      <div
        ref={viewport}
        className="absolute inset-0 cursor-grab touch-none overflow-clip active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          motion.current.speed = 0;
          motion.current.drag = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
            at: performance.now(),
          };
        }}
        onPointerMove={(event) => {
          const state = motion.current;
          const drag = state.drag;
          if (!drag || drag.id !== event.pointerId) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (!drag.moved) {
            if (Math.hypot(dx, dy) < MOVE_PX) return;
            drag.moved = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          // Dragging pulls the painting along the path: down to climb, sideways where it winds.
          const heading = pointAt(state.focus);
          const along = (dy * 0.7 - (dx * heading.dx + dy * heading.dy) * 0.6) / (state.scale || 1);
          state.focus = clampToPath(state.focus + along);
          const now = performance.now();
          state.speed = 0.6 * state.speed + 0.4 * along * (16 / Math.max(8, now - drag.at));
          Object.assign(drag, { x: event.clientX, y: event.clientY, at: now });
        }}
        onPointerUp={() => {
          const drag = motion.current.drag;
          if (drag && performance.now() - drag.at > 90) motion.current.speed = 0;
          motion.current.drag = null;
        }}
        onPointerCancel={() => {
          motion.current.drag = null;
        }}
        onWheel={(event) => {
          const state = motion.current;
          state.focus = clampToPath(
            state.focus - ((event.deltaY + event.deltaX / 2) * 0.9) / (state.scale || 1)
          );
          state.speed = 0;
        }}
      >
        <div
          ref={world}
          className="absolute top-0 left-0 will-change-transform"
          style={{ width: SCROLL.width * k, height: SCROLL.height * k }}
        >
          <img
            src={painting}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full dark:brightness-90 dark:invert dark:sepia-[0.25]"
          />
          <canvas ref={sky} aria-hidden className="pointer-events-none absolute top-0 left-0" />
          <canvas
            ref={patch}
            aria-hidden
            className="absolute text-paper opacity-0 transition-opacity duration-500"
            style={{
              left: TRAVELLER.left * k,
              top: TRAVELLER.top * k,
              width: TRAVELLER.width * k,
              height: TRAVELLER.height * k,
            }}
          />
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
          >
            <path
              ref={walked}
              fill="none"
              stroke="var(--color-ink)"
              strokeOpacity={0.55}
              strokeWidth={2.8}
              strokeLinecap="round"
              strokeDasharray="0.5 8"
            />
            <path
              ref={ahead}
              fill="none"
              stroke="var(--color-ink)"
              strokeOpacity={0.22}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeDasharray="0.5 9"
            />
            {shown.map((tape) => (
              <g
                key={tape.id}
                ref={(element) => {
                  if (element) tieEls.current.set(tape.id, element);
                  else tieEls.current.delete(tape.id);
                }}
                className={cn(
                  "transition-opacity duration-1000",
                  breaks[tape.id] === "broken" && "opacity-0"
                )}
              >
                <path stroke="var(--color-ink)" strokeOpacity={0.45} />
                <circle
                  r={tape.id === playingId ? 4.5 : 3.2}
                  fill={tape.id === playingId ? "var(--color-seal)" : "var(--color-ink)"}
                />
              </g>
            ))}
          </svg>
          {(Object.keys(PLACES) as PlaceName[]).map((place) => {
            const { x, y } = pointAt(placeAt(place));
            return (
              <span
                key={place}
                aria-hidden
                lang="zh"
                className="pointer-events-none absolute -translate-1/2 bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--paper)_80%,transparent),transparent)] px-2 py-1.5 font-brush text-[1.1rem] leading-none text-ink-soft [writing-mode:vertical-rl]"
                style={{ left: x * k + 34, top: Math.max(36, y * k - 30) }}
              >
                {m.radio.pathPlaces[place]}
              </span>
            );
          })}
          <div
            ref={traveller}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 drop-shadow-[0_0_2px_var(--paper)]"
            style={{
              width: TRAVELLER.width * k,
              height: TRAVELLER.height * k,
              transformOrigin: `${((TRAVELLER.feet[0] - TRAVELLER.left) / TRAVELLER.width) * 100}% ${((TRAVELLER.feet[1] - TRAVELLER.top) / TRAVELLER.height) * 100}%`,
            }}
          >
            <canvas
              ref={body}
              className="absolute inset-0 size-full bg-[radial-gradient(closest-side,var(--paper)_65%,transparent)] text-ink"
            />
            <canvas
              ref={cane}
              className="absolute inset-0 size-full text-ink"
              style={{
                transformOrigin: `${((CANE.hand[0] - TRAVELLER.left) / TRAVELLER.width) * 100}% ${((CANE.hand[1] - TRAVELLER.top) / TRAVELLER.height) * 100}%`,
              }}
            />
          </div>
          {shown.length === 0 ? (
            <p
              className="absolute w-[min(20rem,80vw)] -translate-x-1/2 -translate-y-full bg-paper/85 px-4 py-2 text-center font-serif text-[1.1rem] font-bold text-ink"
              style={{
                left: Math.min(Math.max(170, TRAVELLER.feet[0] * k), SCROLL.width * k - 170),
                top: TRAVELLER.top * k - 24,
              }}
            >
              {m.radio.noRecordings}
            </p>
          ) : (
            <ol>
              {shown.map((tape) => (
                <li
                  key={tape.id}
                  ref={(element) => {
                    if (element) slipEls.current.set(tape.id, element);
                    else slipEls.current.delete(tape.id);
                  }}
                  className="absolute top-0 left-0"
                  onFocus={(event) => {
                    // Only a slip reached by keyboard; a tapped one is already in view.
                    if (!event.target.matches(":focus-visible")) return;
                    const slot = motion.current.slots.get(tape.id);
                    if (slot) motion.current.focus = slot.target;
                  }}
                >
                  <Slip
                    tape={tape}
                    current={tape.id === playingId}
                    broken={breaks[tape.id] ?? null}
                    onPlay={() => onPlay(tape)}
                    onHold={() => strike(tape)}
                    onMend={() => mend(tape)}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-background motion-safe:animate-[scroll-unroll_1.4s_cubic-bezier(0.6,0,0.3,1)_0.15s_forwards] motion-reduce:hidden"
      >
        <div className="absolute -inset-x-2 -top-2 h-5 rounded-full bg-ink shadow-[0_4px_10px_color-mix(in_oklch,var(--ink)_35%,transparent)] before:absolute before:inset-y-0.5 before:left-0 before:w-3 before:rounded-full before:bg-gilt after:absolute after:inset-y-0.5 after:right-0 after:w-3 after:rounded-full after:bg-gilt" />
      </div>

      <Seal
        pressed
        autoFocus
        aria-label={m.radio.sealLabels.leavePath}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))]"
        onClick={onLeave}
      >
        {m.radio.seals.path}
      </Seal>
      <p
        aria-hidden
        lang="zh"
        className="pointer-events-none absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1.75rem,env(safe-area-inset-right))] bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--paper)_85%,transparent),transparent)] px-2.5 py-2 font-brush text-[1.6rem] leading-none text-ink [writing-mode:vertical-rl]"
      >
        {m.radio.pathInscription}
      </p>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 bg-linear-to-t from-paper/90 from-40% to-transparent pt-8 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <p className="min-w-0 flex-1 text-right font-serif text-sm font-bold tracking-wide text-ink-soft">
          {hint ?? m.radio.pathHint}
        </p>
      </div>
    </section>
  );
}

const FACE =
  "flex flex-col items-center gap-1 border bg-background/95 px-1.5 pt-2 pb-1.5 text-ink shadow-[1px_2px_0_color-mix(in_oklch,var(--ink)_12%,transparent)]";

/** A recording as a paper slip by the path; held, the old man breaks it with his cane and its pieces fade. */
function Slip({
  tape,
  current,
  broken,
  onPlay,
  onHold,
  onMend,
}: {
  tape: Tape;
  current: boolean;
  broken: BreakPhase | null;
  onPlay: () => void;
  onHold: () => void;
  onMend: () => void;
}) {
  const m = useMessages();
  const recorded = formatShortDateTime(tape.recordedAt);
  const length = formatTapeTime(tape.duration);
  const { holding, handlers } = useHold(onPlay, onHold);
  const inPieces = broken === "broken" || broken === "mending";
  const edge = current
    ? "border-seal shadow-[0_0_0_3px_color-mix(in_oklch,var(--seal)_15%,transparent),1px_2px_0_color-mix(in_oklch,var(--ink)_12%,transparent)]"
    : "border-ink/35";
  const face = (
    <>
      {current && (
        <span
          aria-hidden
          lang="zh"
          className="absolute -top-2.5 -right-3 rotate-6 rounded-[2px] bg-seal px-0.5 py-1 font-brush text-[0.75rem] leading-none text-paper [writing-mode:vertical-rl]"
        >
          {m.radio.seals.playing}
        </span>
      )}
      <span
        lang="zh"
        className="font-brush text-[1.15rem] leading-[1.05] font-bold [writing-mode:vertical-rl]"
      >
        {tape.station.name}
      </span>
      <span className="text-center whitespace-nowrap font-serif text-[0.8rem] leading-tight font-bold text-ink-soft tabular-nums">
        {formatMonthDay(tape.recordedAt)}
        <br />
        {length}
      </span>
    </>
  );
  return (
    <div className="absolute -translate-1/2">
      <button
        type="button"
        aria-label={m.radio.playRecording(tape.station.name, recorded, length)}
        aria-hidden={inPieces}
        className={cn(
          FACE,
          edge,
          "relative cursor-pointer outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          (holding || broken === "awaiting") &&
            "motion-safe:animate-[slip-flutter_120ms_linear_infinite]",
          broken === "awaiting" && "pointer-events-none",
          inPieces && "invisible"
        )}
        {...handlers}
      >
        {face}
      </button>
      {inPieces && (
        <button
          type="button"
          aria-label={m.radio.mend(tape.station.name)}
          disabled={broken !== "broken"}
          className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ink"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onMend}
        >
          {SHARDS.map((shard) => (
            <span
              key={shard.clip}
              aria-hidden
              className={cn(
                FACE,
                edge,
                "absolute inset-0",
                broken === "broken"
                  ? "motion-safe:animate-[shard-break_700ms_cubic-bezier(0.2,0.7,0.4,1)_forwards,fade-away_5s_linear_forwards] motion-reduce:opacity-40"
                  : "motion-safe:animate-[shard-mend_600ms_ease-out_backwards]"
              )}
              style={
                {
                  clipPath: shard.clip,
                  "--shard-x": shard.x,
                  "--shard-y": shard.y,
                  "--shard-turn": shard.turn,
                } as CSSProperties
              }
            >
              {face}
            </span>
          ))}
        </button>
      )}
    </div>
  );
}
