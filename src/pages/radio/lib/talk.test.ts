import { describe, expect, it } from "vitest";
import { isTalkStation, listenForTalk, type Talk } from "@/pages/radio/lib/talk.ts";

/** Seconds of a voice: syllables four times a second, and a breath after every two seconds. */
function speech(seconds: number) {
  const readings: number[] = [];
  while (readings.length < seconds * 20) {
    for (let syllable = 0; syllable < 8; syllable++) readings.push(0.8, 0.85, 0.8, 0.45, 0.4);
    for (let breath = 0; breath < 12; breath++) readings.push(0.3);
  }
  return readings.slice(0, seconds * 20);
}

/** Seconds of music: loud throughout, wavering a little. */
const music = (seconds: number) =>
  Array.from({ length: seconds * 20 }, (_, i) => 0.75 + Math.sin(i * 1.3) * 0.03);

const silence = (seconds: number) => Array.from({ length: seconds * 20 }, () => 0);

function hearAll(readings: number[], talkStation = false): Talk[] {
  const hear = listenForTalk(talkStation);
  return readings.map(hear);
}

describe("listenForTalk", () => {
  it("hears speech as talk once it has heard enough", () => {
    const heard = hearAll(speech(8));
    expect(heard[20].talking).toBe(false);
    expect(heard.at(-1)?.talking).toBe(true);
  });

  it("does not hear music as talk", () => {
    expect(hearAll(music(10)).some((talk) => talk.talking)).toBe(false);
  });

  it("does not take a silent start for the pauses of speech", () => {
    expect(hearAll([...silence(5), ...music(8)]).some((talk) => talk.talking)).toBe(false);
  });

  it("lets music end the talk", () => {
    expect(hearAll([...speech(8), ...music(8)]).at(-1)?.talking).toBe(false);
  });

  it("starts a talk station talking, until its music says otherwise", () => {
    const heard = hearAll(music(10), true);
    expect(heard[0].talking).toBe(true);
    expect(heard.at(-1)?.talking).toBe(false);
  });

  it("opens the voice on syllables and closes it between them", () => {
    const heard = hearAll(speech(6));
    expect(heard[105].voice).toBeGreaterThan(0.8);
    expect(heard[108].voice).toBeLessThan(0.5);
  });
});

describe("isTalkStation", () => {
  it("knows news, talk and religious stations by their tags", () => {
    expect(isTalkStation(["News", "pop"])).toBe(true);
    expect(isTalkStation(["相声"])).toBe(true);
    expect(isTalkStation(["佛教"])).toBe(true);
  });

  it("does not take music, or a city's name, for talk", () => {
    expect(isTalkStation(["pop", "classical"])).toBe(false);
    expect(isTalkStation(["佛山"])).toBe(false);
  });
});
