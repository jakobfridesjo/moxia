import { describe, expect, it } from "vitest";
import type { Emotion } from "@/shared/api/commands.ts";
import type { Caption } from "@/features/player/model/subtitles.ts";
import {
  makeMover,
  MOODS,
  moodStrength,
  syllables,
  type Hearing,
  type Poses,
} from "@/pages/radio/lib/mood.ts";

const FRAME_MS = 1000 / 30;
const SILENT = { talking: false, voice: 0 } as const;

/** A line said from `at` ms, a character every quarter second. */
function line(text: string, emotion: Emotion, emotionSure = 0.9, at = 0): Caption {
  const said = Array.from(text, (_, index) => index * 0.25);
  return {
    text,
    duration: said.length * 0.25,
    said,
    readings: [],
    at,
    emotion,
    emotionSure,
    burst: null,
  };
}

/** Poses frame by frame over `seconds`, from `from` ms, hearing what `hearing` says at each time. */
function watch(
  seconds: number,
  hearing: (now: number) => Partial<Hearing>,
  mover = makeMover(),
  from = 0
): Poses[] {
  const poses: Poses[] = [];
  for (let now = from; now < from + seconds * 1000; now += FRAME_MS) {
    poses.push(
      mover({
        now,
        seconds: FRAME_MS / 1000,
        playing: true,
        writing: false,
        subtitled: true,
        captions: [],
        sound: "talk",
        talk: SILENT,
        loudness: 0.5,
        ...hearing(now),
      })
    );
  }
  return poses;
}

const pitches = (poses: Poses[], figure: 0 | 1) => poses.map((pose) => pose.figures[figure].pitch);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

describe("syllables", () => {
  it("stresses the first after a pause or a stop, and ends the one before", () => {
    const caption = line("今天，好天气", "neutral");
    const timed = syllables(caption);
    expect(timed.map((syllable) => syllable.stressed)).toEqual([true, false, true, false, false]);
    expect(timed.map((syllable) => syllable.ending)).toEqual([false, true, false, false, true]);
    expect(timed[2].at).toBe(750);
  });
});

describe("moodStrength", () => {
  it("shows nothing of a mood the model is unsure of, and all of one it is sure of", () => {
    expect(moodStrength(0.3)).toBe(0);
    expect(moodStrength(0.6)).toBeGreaterThan(0.3);
    expect(moodStrength(0.9)).toBe(1);
  });
});

describe("makeMover", () => {
  const sad = line("可惜他明天就要走了我们都很难过", "sad");
  const happy = line("哈哈今天真是太开心了我们都很高兴", "happy");

  it("lowers a sad speaker's head and lifts a happy one's", () => {
    const sadPoses = watch(3, () => ({ captions: [sad] }));
    const happyPoses = watch(3, () => ({ captions: [happy] }));
    expect(mean(pitches(sadPoses, 0).slice(-30))).toBeLessThan(-0.4);
    expect(mean(pitches(happyPoses, 0).slice(-30))).toBeGreaterThan(0.15);
  });

  it("keeps to neutral when the model is unsure of the emotion", () => {
    const unsure = line("可惜他明天就要走了我们都很难过", "sad", 0.3);
    const poses = watch(3, () => ({ captions: [unsure] }));
    expect(Math.abs(mean(pitches(poses, 0).slice(-30)))).toBeLessThan(0.15);
  });

  it("has the partner lean away from anger and toward calm", () => {
    const angry = line("这件事实在太不公平了我绝对不能接受", "angry");
    const calm = line("下面是今晚的天气预报明天多云转晴", "neutral");
    const lean = (caption: Caption) =>
      watch(3, () => ({ captions: [caption] })).at(-1)!.figures[1].lean;
    expect(lean(angry)).toBeLessThan(0);
    expect(lean(calm)).toBeGreaterThan(0);
  });

  it("opens the jaw on each syllable and shuts it between", () => {
    const poses = watch(2, () => ({ captions: [line("一二三四五六七八", "neutral")] }));
    const jaws = poses.map((pose) => pose.figures[0].jaw);
    expect(Math.max(...jaws)).toBeGreaterThan(0.4);
    expect(Math.min(...jaws.slice(5))).toBeLessThan(0.1);
    expect(poses.every((pose) => pose.figures[1].jaw < 0.01)).toBe(true);
  });

  it("drifts with the music's loudness instead of nodding to a beat", () => {
    const poses = watch(12, () => ({ sound: "music", loudness: 0.6 }));
    const lastSecond = pitches(poses, 0).slice(-30);
    expect(Math.max(...lastSecond) - Math.min(...lastSecond)).toBeLessThan(0.01);
    expect(mean(lastSecond)).toBeLessThan(0);
  });

  it("lets both doze once nothing plays", () => {
    const mover = makeMover();
    watch(3, () => ({ captions: [happy] }), mover);
    const poses = watch(4, () => ({ playing: false }), mover, 3000);
    expect(poses.at(-1)!.figures[0].pitch).toBeLessThan(-0.9);
    expect(poses.at(-1)!.awake).toBeLessThan(0.05);
  });

  it("works the jaw from the levels without subtitles", () => {
    const poses = watch(1, () => ({
      subtitled: false,
      talk: { talking: true, voice: 0.8 },
    }));
    expect(poses.at(-1)!.figures[0].jaw).toBeGreaterThan(0.7);
  });

  it("bounces both figures when the line is laughed", () => {
    const laughed = { ...line("哈哈哈哈", "happy"), burst: "laughter" as const };
    const poses = watch(1, () => ({ captions: [laughed] }));
    expect(Math.max(...pitches(poses, 1))).toBeGreaterThan(0.2);
  });

  it("gives every mood a gesture", () => {
    expect(Object.values(MOODS).every((mood) => mood.strength > 0)).toBe(true);
  });
});
