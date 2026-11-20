/*
 * How the figures hold their heads: each mood a voice is heard in is a rest pose, a gesture on
 * stressed syllables and a spring that sets how the head moves between them. What plays sets
 * the rest: talk, singing, music or quiet. Pitch is in units of the leaf's own `turn` (1 lifts
 * the chin as far as the cut allows, -1 drops it), lean in leaf units the way a figure faces.
 */
import type { Burst, Emotion, Sound } from "@/shared/api/commands.ts";
import type { Caption } from "@/features/player/model/subtitles.ts";
import type { Talk } from "@/pages/radio/lib/talk.ts";

type Gesture = "beat" | "bounce" | "sink" | "chop" | "tremor" | "startle" | "recoil";

export interface Mood {
  /** Where the speaker's head rests, and how far it leans. */
  rest: number;
  lean: number;
  gesture: Gesture;
  /** How strong the gesture is. */
  strength: number;
  /** How wide the jaw opens, against a neutral voice. */
  jaw: number;
  /** The head's spring: how fast it swings, in Hz, and how soon it settles (1 never overshoots). */
  frequency: number;
  damping: number;
  /** How much of the speaker's rest the one listening takes on, and how far he leans. */
  echo: number;
  leanEcho: number;
}

export const MOODS: Record<Emotion, Mood> = {
  neutral: {
    rest: 0,
    lean: 0,
    gesture: "beat",
    strength: 0.35,
    jaw: 1,
    frequency: 2.2,
    damping: 0.8,
    echo: 0,
    leanEcho: 0.8,
  },
  happy: {
    rest: 0.35,
    lean: -0.5,
    gesture: "bounce",
    strength: 0.45,
    jaw: 1.2,
    frequency: 3.2,
    damping: 0.45,
    echo: 0.5,
    leanEcho: 0.8,
  },
  sad: {
    rest: -0.6,
    lean: 1,
    gesture: "sink",
    strength: 0.15,
    jaw: 0.55,
    frequency: 0.9,
    damping: 1,
    echo: 0.4,
    leanEcho: 1,
  },
  angry: {
    rest: -0.25,
    lean: 2.5,
    gesture: "chop",
    strength: 0.7,
    jaw: 1.4,
    frequency: 5,
    damping: 0.55,
    echo: -0.3,
    leanEcho: -1,
  },
  fearful: {
    rest: 0.15,
    lean: -2,
    gesture: "tremor",
    strength: 0.08,
    jaw: 0.7,
    frequency: 4,
    damping: 0.35,
    echo: 0.3,
    leanEcho: -0.5,
  },
  surprised: {
    rest: 0.5,
    lean: -1.5,
    gesture: "startle",
    strength: 0.9,
    jaw: 1.5,
    frequency: 6,
    damping: 0.5,
    echo: 0.5,
    leanEcho: -0.5,
  },
  disgusted: {
    rest: 0.25,
    lean: -1.5,
    gesture: "recoil",
    strength: 0.4,
    jaw: 0.65,
    frequency: 1.8,
    damping: 0.9,
    echo: 0.2,
    leanEcho: -0.8,
  },
};

type Blend = Omit<Mood, "gesture">;
const BLENDED: (keyof Blend)[] = [
  "rest",
  "lean",
  "strength",
  "jaw",
  "frequency",
  "damping",
  "echo",
  "leanEcho",
];

/** How sure the model must be of an emotion before it shows at all, and before it shows in full. */
const FAINTEST_SURE = 0.35;
const FULLEST_SURE = 0.8;
/** SenseVoice is trained on speech, so the emotion it hears in singing counts half. */
const SUNG_EMOTION = 0.5;
/** A mood outlasts its line by this long, in ms, then gives way to neutral. */
const MOOD_LINGERS_MS = 4000;
/** How long a change of mood takes to blend in, in seconds. */
const BLENDING = 0.4;
/** Talk over music gestures less. */
const UNDER_MUSIC = 0.7;
/** A sung phrase, in seconds: the head sways once over it. */
const SUNG_PHRASE = 3.2;
/** How long the loudness the heads drift with during music is averaged over, in seconds. */
const DRIFT_AVERAGE = 4;
/** How long the partner stays awake after the last words or song, in ms. */
const PARTNER_DOZES_MS = 15000;
/** How fast a sleeping partner wakes to talk, and settles back to sleep, per second. */
const WAKING = 1.2;
/** A pause this long, in seconds, makes the next syllable a stressed one. */
const PAUSE = 0.35;
/** The heads' spring while nobody speaks. */
const RESTING_SPRING = { frequency: 1.4, damping: 0.9 };
const MAX_PITCH = 1.2;
const MAX_LEAN = 3;

export interface FigurePose {
  pitch: number;
  lean: number;
  /** How open the mouth is, 0 to 1. */
  jaw: number;
}

export interface Poses {
  /** The listener and his partner. */
  figures: [FigurePose, FigurePose];
  /** How far a sleeping partner has woken, 0 to 1. */
  awake: number;
}

export interface Hearing {
  /** As `performance.now()`, and the seconds since the last frame. */
  now: number;
  seconds: number;
  playing: boolean;
  /** The listener writes, his head bent over the scroll. */
  writing: boolean;
  /** Whether the models hear what plays: then `captions` and `sound` say, else `talk` guesses. */
  subtitled: boolean;
  captions: Caption[];
  /** What the models say plays; null before they have said. */
  sound: Sound | null;
  /** What the levels make of talk, without the models. */
  talk: Talk;
  /** How loud it plays now, 0 to 1. */
  loudness: number;
}

interface Syllable {
  /** When it is said, as `performance.now()`, and for how long, in seconds. */
  at: number;
  length: number;
  stressed: boolean;
  /** The last before a pause. */
  ending: boolean;
  /** How wide the jaw opens on it, 0 to 1. */
  peak: number;
}

const WORD = /[\p{L}\p{N}]/u;

/** A steady pseudo-random number from 0 to 1 for `n`. */
function noise(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** The syllables of `caption`: its letters and characters, timed as the models heard them. */
export function syllables(caption: Caption): Syllable[] {
  const glyphs = Array.from(caption.text);
  const spoken = caption.said
    .slice(0, glyphs.length)
    .map((at, index) => ({ at, word: WORD.test(glyphs[index]), index }))
    .filter(({ word }) => word);
  const lengths = spoken.map(({ at }, index) => {
    const next = spoken[index + 1]?.at ?? Math.min(caption.duration, at + 0.35);
    return Math.min(0.45, Math.max(0.08, next - at));
  });
  const median = [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)] ?? 0;
  const afterPause = spoken.map(
    ({ at, index }, i) =>
      i === 0 || at - spoken[i - 1].at > PAUSE || index - spoken[i - 1].index > 1
  );
  return spoken.map(({ at, index }, i) => {
    // The last before a pause runs on into it, so its length says nothing of how it is held.
    const ending = i === spoken.length - 1 || afterPause[i + 1];
    return {
      at: caption.at + at * 1000,
      length: lengths[i],
      stressed: afterPause[i] || (!ending && lengths[i] > median * 1.6),
      ending,
      peak: 0.65 + 0.35 * noise(index),
    };
  });
}

/** How strongly a mood the model is `sure` of shows, 0 to 1. */
export function moodStrength(sure: number) {
  const x = Math.min(1, Math.max(0, (sure - FAINTEST_SURE) / (FULLEST_SURE - FAINTEST_SURE)));
  return x * x * (3 - 2 * x);
}

interface Head {
  pitch: number;
  pitchSpeed: number;
  lean: number;
  leanSpeed: number;
  jaw: number;
}

/** The listener does all the talking; his partner, where the leaf has one, only listens. */
const SPEAKER = 0;
const PARTNER = 1;

/** A nudge to a figure's head at `at`: speed added to its pitch and lean, and the jaw held open. */
interface Kick {
  at: number;
  figure: 0 | 1;
  pitch: number;
  lean?: number;
  jaw?: number;
  jawMs?: number;
}

const BEAT_KICK = -9;
/** What each gesture adds to the pitch's speed, per unit of strength. */
const GESTURE_KICK: Partial<Record<Gesture, number>> = {
  beat: BEAT_KICK,
  bounce: 12,
  sink: -5,
  chop: -16,
  startle: -3,
  recoil: -3,
};

function burstKicks(burst: Burst, at: number): Kick[] {
  switch (burst) {
    case "laughter":
      return [0, 1, 2, 3].flatMap((beat) => [
        { at: at + beat * 160, figure: SPEAKER, pitch: 7, jaw: 0.75, jawMs: 120 },
        { at: at + 60 + beat * 160, figure: PARTNER, pitch: 4.2 },
      ]);
    case "applause":
      return [
        { at, figure: SPEAKER, pitch: 5 },
        { at: at + 100, figure: PARTNER, pitch: -4 },
        { at: at + 700, figure: PARTNER, pitch: -4 },
      ];
    case "cry":
      return [
        { at, figure: SPEAKER, pitch: -6 },
        { at: at + 200, figure: PARTNER, pitch: -2, lean: 15 },
      ];
    case "cough":
      return [{ at, figure: SPEAKER, pitch: -14, lean: 30, jaw: 0.8, jawMs: 100 }];
  }
}

/** Opens the jaw over `syllable` at `now`: quick to open, slower to close, held through a sung note. */
function jawOver(syllable: Syllable, now: number, sung: boolean) {
  const through = (now - syllable.at) / 1000 / syllable.length;
  if (through < 0 || through > 1) return 0;
  const open = sung
    ? Math.min(through / 0.1, 1, (1 - through) / 0.15) * 0.9
    : through < 0.15
      ? through / 0.15
      : Math.max(0, 1 - (through - 0.15) / 0.75);
  return syllable.peak * open;
}

function spring(
  head: Head,
  pitch: number,
  lean: number,
  { frequency, damping }: { frequency: number; damping: number },
  seconds: number
) {
  const w = 2 * Math.PI * frequency;
  const steps = Math.max(1, Math.ceil(seconds * 240));
  const h = seconds / steps;
  for (let step = 0; step < steps; step++) {
    head.pitchSpeed += (-w * w * (head.pitch - pitch) - 2 * damping * w * head.pitchSpeed) * h;
    head.pitch += head.pitchSpeed * h;
    head.leanSpeed += (-w * w * (head.lean - lean) - 2 * damping * w * head.leanSpeed) * h;
    head.lean += head.leanSpeed * h;
  }
  head.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, head.pitch));
  head.lean = Math.min(MAX_LEAN, Math.max(-MAX_LEAN, head.lean));
}

/** A mover fed what is heard each frame, saying how the figures hold their heads. */
export function makeMover() {
  const heads: [Head, Head] = [0, 1].map(() => ({
    pitch: -1,
    pitchSpeed: 0,
    lean: 0,
    leanSpeed: 0,
    jaw: 0,
  })) as [Head, Head];
  const mood: Blend = { ...MOODS.neutral };
  let awake = 0;
  let drift = 0;
  let voicedAt = -Infinity;
  let kicks: Kick[] = [];
  const timed = new WeakMap<Caption, Syllable[]>();
  /** How many of each caption's syllables have had their gestures. */
  const done = new WeakMap<Caption, number>();
  let quietFor = 0;

  const syllablesOf = (caption: Caption) => {
    let known = timed.get(caption);
    if (!known) {
      known = syllables(caption);
      timed.set(caption, known);
    }
    return known;
  };

  return (hearing: Hearing): Poses => {
    const { now, seconds, playing, writing, subtitled, captions, talk } = hearing;
    const saying = subtitled
      ? captions.findLast(
          (caption) => now >= caption.at && now < caption.at + caption.duration * 1000
        )
      : undefined;
    const lingering = subtitled
      ? captions.findLast(
          (caption) =>
            now >= caption.at && now < caption.at + caption.duration * 1000 + MOOD_LINGERS_MS
        )
      : undefined;
    const talking = subtitled ? saying !== undefined : talk.talking;
    let sound: Sound | "stopped" = !playing
      ? "stopped"
      : subtitled
        ? (hearing.sound ?? (talking ? "talk" : "music"))
        : talking
          ? "talk"
          : "music";
    if (talking && (sound === "quiet" || sound === "music")) sound = "talk";
    const sung = sound === "singing";
    const voiced = sound === "talk" || sound === "talkOverMusic" || sung;
    if (voiced) voicedAt = now;

    const emotion = lingering?.emotion ?? "neutral";
    const shown = lingering ? moodStrength(lingering.emotionSure) * (sung ? SUNG_EMOTION : 1) : 0;
    const blendIn = 1 - Math.exp(-seconds / BLENDING);
    for (const key of BLENDED) {
      const target = MOODS.neutral[key] + (MOODS[emotion][key] - MOODS.neutral[key]) * shown;
      mood[key] += (target - mood[key]) * blendIn;
    }
    const gesture = shown > 0.5 ? MOODS[emotion].gesture : "beat";
    const gentler = sound === "talkOverMusic" ? UNDER_MUSIC : 1;

    // New lines bring their bursts and opening gestures; passing syllables their stresses.
    let jaw = 0;
    if (saying && voiced) {
      const said = syllablesOf(saying);
      let next = done.get(saying);
      if (next === undefined) {
        next = 0;
        if (saying.burst) kicks.push(...burstKicks(saying.burst, saying.at));
        if (gesture === "startle") {
          kicks.push({ at: now, figure: SPEAKER, pitch: mood.strength * 22, lean: -60 });
          kicks.push({ at: now, figure: PARTNER, pitch: mood.strength * 9, lean: -20 });
        }
        if (gesture === "recoil")
          kicks.push({ at: now, figure: SPEAKER, pitch: mood.strength * 6, lean: -30 });
      }
      for (; next < said.length && said[next].at <= now; next++) {
        const syllable = said[next];
        const kick = GESTURE_KICK[gesture];
        if (syllable.stressed && !sung && kick)
          kicks.push({
            at: syllable.at,
            figure: SPEAKER,
            pitch: kick * mood.strength * gentler,
            lean: gesture === "chop" ? 25 * mood.strength : 0,
          });
        const nods =
          emotion === "neutral" || emotion === "happy" || emotion === "sad" || shown < 0.5;
        if (syllable.ending && !sung && nods)
          kicks.push({
            at: syllable.at + syllable.length * 1000 + 100,
            figure: PARTNER,
            pitch: -3.2 * gentler,
          });
      }
      done.set(saying, next);
      const current = said.findLast((syllable) => syllable.at <= now);
      jaw = current ? jawOver(current, now, sung) : 0;
    } else if (!subtitled && talking) {
      jaw = talk.voice;
      // A syllable after a pause is a stressed one.
      if (talk.voice > 0.5 && quietFor > PAUSE)
        kicks.push({ at: now, figure: SPEAKER, pitch: BEAT_KICK * mood.strength });
    }
    quietFor = talking && talk.voice > 0.15 ? 0 : quietFor + seconds;

    const awakeTarget = sound !== "stopped" && now - voicedAt < PARTNER_DOZES_MS ? 1 : 0;
    awake += (awakeTarget - awake) * Math.min(1, seconds * WAKING);
    drift += (hearing.loudness - drift) * Math.min(1, seconds / DRIFT_AVERAGE);
    const phrase = saying ? ((now - saying.at) / 1000 / SUNG_PHRASE) * Math.PI * 2 : now / 1000;
    const held = saying
      ? syllablesOf(saying).some(
          (s) => s.at <= now && now < s.at + s.length * 1000 && s.length > 0.4
        )
      : false;

    const poses = heads.map((head, index) => {
      const figure = index as 0 | 1;
      const speaks = voiced && talking && figure === SPEAKER;
      let pitch = 0.05;
      let lean = 0;
      let mouth = 0;
      let springing = RESTING_SPRING;
      if (sound === "stopped" || (figure === 0 && writing)) pitch = -1;
      else if (sound === "quiet") pitch = -0.6 + Math.sin(now / 800 + figure) * 0.05;
      else if (sound === "music") pitch = -0.35 + 0.5 * (drift - 0.5);
      else if (speaks) {
        springing = mood;
        mouth = Math.min(1, jaw * (sung ? 1 : mood.jaw));
        if (sung) pitch = 0.1 + 0.35 * Math.sin(phrase) + (held ? 0.25 : 0);
        else {
          pitch = mood.rest;
          lean = mood.lean;
          if (gesture === "tremor")
            pitch +=
              mood.strength * 4 * Math.sin((now / 1000) * Math.PI * 14) * (jaw > 0 ? 1 : 0.4);
        }
      } else if (sung) pitch = -0.3 + 0.25 * Math.sin(phrase - Math.PI / 2);
      else if (talking) {
        pitch = 0.05 + mood.rest * mood.echo * gentler;
        lean = mood.leanEcho;
      }
      if (figure === 1) pitch *= awake;

      const due = kicks.filter((kick) => kick.figure === figure && kick.at <= now);
      for (const kick of due) {
        head.pitchSpeed += kick.pitch;
        head.leanSpeed += kick.lean ?? 0;
      }
      const jawKick = due.reduce(
        (open, kick) => (now < kick.at + (kick.jawMs ?? 0) ? Math.max(open, kick.jaw ?? 0) : open),
        0
      );
      spring(head, pitch, lean, springing, seconds);
      head.jaw += (Math.max(mouth, jawKick) - head.jaw) * (1 - Math.exp(-seconds / 0.035));
      return { pitch: head.pitch, lean: head.lean, jaw: head.jaw };
    }) as [FigurePose, FigurePose];
    // A kick acts once; one that holds the jaw open stays until it shuts.
    kicks = kicks
      .map((kick) => (kick.at <= now ? { ...kick, pitch: 0, lean: 0 } : kick))
      .filter((kick) => kick.at > now || now < kick.at + (kick.jawMs ?? 0));
    return { figures: poses, awake };
  };
}
