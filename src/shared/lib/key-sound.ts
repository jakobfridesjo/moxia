import { keySoundsAtom } from "@/shared/config/preferences.ts";

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** The shared audio context; null where the webview has no Web Audio. */
function audio() {
  try {
    context ??= new AudioContext();
  } catch {
    return null;
  }
  return context;
}

/** A tenth of a second of white noise, made once. */
function noiseBuffer(context: AudioContext) {
  if (!noise) {
    const length = Math.round(context.sampleRate / 10);
    noise = context.createBuffer(1, length, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** A gain that strikes at `gain` at `at` and dies away over `seconds`. */
function decay(context: AudioContext, at: number, gain: number, seconds: number) {
  const level = context.createGain();
  level.gain.setValueAtTime(gain, at);
  level.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  level.connect(context.destination);
  return level;
}

// The ring of a hard tile: a few close, inharmonic partials that die almost at once.
const TILE_PARTIALS = [
  { ratio: 1, gain: 0.09, seconds: 0.06 },
  { ratio: 1.63, gain: 0.06, seconds: 0.045 },
  { ratio: 2.41, gain: 0.04, seconds: 0.03 },
];

/** One tile striking another, `loudness` from 0 to 1, starting at `at`. */
function knock(context: AudioContext, at: number, loudness: number, pitch: number) {
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context);
  const body = context.createBiquadFilter();
  body.type = "bandpass";
  body.frequency.value = pitch * 1.4;
  body.Q.value = 1.2;
  source.connect(body).connect(decay(context, at, 0.5 * loudness, 0.018));
  source.start(at);
  source.stop(at + 0.03);

  for (const partial of TILE_PARTIALS) {
    const tone = context.createOscillator();
    tone.type = "triangle";
    tone.frequency.value = pitch * partial.ratio;
    tone.connect(decay(context, at, partial.gain * loudness, partial.seconds));
    tone.start(at);
    tone.stop(at + partial.seconds);
  }
}

/** The clack of a mahjong tile set down on another, when key sounds are on. */
export function playKeyClick() {
  if (!keySoundsAtom.get()) return;
  const context = audio();
  if (!context) return;
  // No two tiles land quite alike.
  const pitch = 2200 + Math.random() * 500;
  const now = context.currentTime;
  knock(context, now, 1, pitch);
  // The tile settles: a softer, slightly higher second knock just after.
  knock(context, now + 0.03 + Math.random() * 0.025, 0.35, pitch * 1.08);
}

/** The crack of a cane breaking a paper slip, when key sounds are on. */
export function playCrack() {
  if (!keySoundsAtom.get()) return;
  const context = audio();
  if (!context) return;
  const now = context.currentTime;
  // The cane knocks, and a moment later the slip snaps.
  knock(context, now, 1, 900);
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context);
  const snap = context.createBiquadFilter();
  snap.type = "highpass";
  snap.frequency.value = 2500;
  source.connect(snap).connect(decay(context, now + 0.02, 0.6, 0.08));
  source.start(now + 0.02);
  source.stop(now + 0.1);
}
