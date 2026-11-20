/*
 * Telling talk from music by the loudness the player reports, about twenty
 * readings a second on the meter's 0–1 scale. Speech dips between syllables and
 * words several times a second; music, even quiet music, holds its level. Heavily
 * compressed talk (crosstalk with a laughing audience) dips too little to tell, so
 * a station tagged as talk starts out talking and needs less to stay so.
 */

const READINGS_PER_SECOND = 20;
/** How much of the recent past the rate is taken over, in readings. */
const WINDOW = 6 * READINGS_PER_SECOND;
/** How much sound must be heard before the loudness, not the station's tags, decides. */
const SETTLE = 3 * READINGS_PER_SECOND;
/** Readings this low are silence (a stream starting, a gap), not a dip in a voice. */
const SILENCE = 0.02;
/** How far a dip falls below the loudness either side of it, on the meter's scale (about 5 dB). */
const DIP = 0.15;
/** How many readings either side a dip is measured against. */
const REACH = 3;

/** Dips a second that start talk, and below which it ends; looser for a talk station. */
const RATES = {
  station: { on: 1.6, off: 0.9 },
  talkStation: { on: 1.2, off: 0.3 },
};

/** Tags radio-browser stations use for news, talk and the spoken word. */
const TALK_TAGS = [
  "news",
  "talk",
  "spoken",
  "religio",
  "buddhis",
  "christian",
  "sermon",
  "story",
  "crosstalk",
  "相声",
  "新闻",
  "新聞",
  "资讯",
  "資訊",
  "宗教",
  "佛教",
  "佛学",
  "佛學",
  "讲",
  "講",
];

/** Whether a station's tags say it mostly talks. */
export function isTalkStation(tags: string[]) {
  return tags.some((tag) => TALK_TAGS.some((talk) => tag.toLowerCase().includes(talk)));
}

export interface Talk {
  talking: boolean;
  /** How open the voice is now, 0 between syllables to 1 at their loudest. */
  voice: number;
}

/** How many times a second `heard` dips between louder readings either side. */
function dipRate(heard: number[]) {
  let dips = 0;
  for (let i = REACH; i < heard.length - REACH; i++) {
    const before = heard.slice(i - REACH, i);
    const after = heard.slice(i + 1, i + REACH + 1);
    if (heard[i] > Math.min(...before, ...after)) continue;
    if (Math.min(Math.max(...before), Math.max(...after)) - heard[i] >= DIP) dips++;
  }
  return (dips * READINGS_PER_SECOND) / heard.length;
}

/** A listener fed one loudness reading at a time, saying each time whether it hears talk. */
export function listenForTalk(talkStation: boolean) {
  const rates = talkStation ? RATES.talkStation : RATES.station;
  const heard: number[] = [];
  let talking = talkStation;
  return (reading: number): Talk => {
    if (reading > SILENCE) {
      heard.push(reading);
      if (heard.length > WINDOW) heard.shift();
    }
    if (heard.length >= SETTLE) {
      const rate = dipRate(heard);
      if (rate >= rates.on) talking = true;
      else if (rate < rates.off) talking = false;
    }
    const sorted = heard.toSorted((a, b) => a - b);
    const low = sorted[Math.floor(sorted.length * 0.15)] ?? 0;
    const high = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const voice = high > low ? Math.min(1, Math.max(0, (reading - low) / (high - low))) : 0;
    return { talking, voice };
  };
}
