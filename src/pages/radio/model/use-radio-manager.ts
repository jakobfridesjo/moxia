import { createEffect, createMemo, createSignal } from "solid-js";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { commandErrorMessage, commands, type Station, type Tape } from "@/shared/api/commands.ts";
import { modelsQuery, stationsQuery, tapesQuery, useCommandQuery } from "@/shared/api/queries.ts";
import { categoryAtom, subtitlesAtom, type CategoryFilter } from "@/shared/config/preferences.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { formatTapeTime } from "@/shared/lib/duration.ts";
import { toastError } from "@/shared/lib/toast.ts";
import { useNow } from "@/shared/lib/use-now.ts";
import {
  dialOrder,
  inCategory,
  nextCountry,
  seekStation,
} from "@/pages/radio/model/station-order.ts";
import {
  deckPosition,
  loadTape,
  playDeck,
  playerAtom,
  startRecording,
  stopPlayback,
  stopRecording,
  unloadTape,
} from "@/features/player/model/player-store.ts";
import { setSubtitles, subtitlesStatusAtom } from "@/features/player/model/subtitles.ts";
import { usePlayStation } from "@/features/player/model/use-play-station.ts";
import { useTapes } from "@/features/player/model/use-tapes.ts";
import { usePresets } from "@/pages/radio/model/use-presets.ts";
import { radioMode, stepThrough } from "@/pages/radio/model/radio-state.ts";

/** How long a message stays in the hint corner. */
const HINT_MS = 2400;

const NO_TAPES: Tape[] = [];

export function useRadioManager() {
  const m = useMessages();
  const queryClient = useQueryClient();
  const stations = useCommandQuery(stationsQuery);
  const order = createMemo(() => dialOrder(stations.data ?? []));
  const dial = createMemo(() => order().filter((station) => inCategory(station, categoryAtom())));
  const tapesQueried = useTapes();
  const tapes = createMemo(() => tapesQueried.data ?? NO_TAPES);
  const presets = usePresets();
  const playStation = usePlayStation();
  const mode = createMemo(() => radioMode(playerAtom()));
  const recording = createMemo(() => playerAtom().recording);
  const deck = createMemo(() => playerAtom().deck);
  const now = useNow(250, () => recording() !== null || mode() === "playback");
  const models = useCommandQuery(modelsQuery);
  const subtitlesReady = createMemo(
    () => models.data?.some((entry) => entry.model === "subtitles" && entry.downloaded) ?? false
  );

  // Subtitles left on last time come back on once Rust has the models to hand.
  createEffect(subtitlesReady, (ready) => {
    if (ready && subtitlesAtom.get() && subtitlesStatusAtom.get() === "off")
      void setSubtitles(true);
  });

  const [hint, setHint] = createSignal<string | null>(null);
  createEffect(hint, (shown) => {
    if (!shown) return;
    const timer = setTimeout(() => setHint(null), HINT_MS);
    return () => clearTimeout(timer);
  });

  // Before anything plays, the radio shows the first preset, or else the first station of the category.
  const station = createMemo(
    () =>
      playerAtom().station ??
      presets.slots.find((slot) => slot.station)?.station ??
      dial()[0] ??
      order()[0] ??
      null
  );
  const tape = createMemo(() => {
    const loaded = deck();
    return (mode() === "playback" || mode() === "paused") && loaded ? loaded.tape : null;
  });
  // The radio's station when the mountain path opened, to play again once it closes.
  let radioStation: Station | null = null;

  const remove = useMutation(() => ({
    mutationFn: (id: string) => commands.deleteTape(id),
    onSuccess: () => {
      setHint(m.radio.deleted);
    },
    onError: (error: unknown) => toastError(commandErrorMessage(error, m.radio.deleteFailed)),
    onSettled: () => queryClient.invalidateQueries(tapesQuery()),
  }));

  const playRecording = (recorded: Tape) => {
    loadTape(recorded);
    void playDeck();
  };

  return {
    get mode() {
      return mode();
    },
    get station() {
      return station();
    },
    get tape() {
      return tape();
    },
    get loading() {
      return stations.isPending;
    },
    get recording() {
      return recording() !== null;
    },
    get nowPlaying() {
      return playerAtom().nowPlaying;
    },
    get connecting() {
      return playerAtom().status === "connecting" || playerAtom().status === "buffering";
    },
    /** The station dropped, and is being tried again behind the mist. */
    get reconnecting() {
      return playerAtom().status === "reconnecting";
    },
    get error() {
      return playerAtom().error;
    },
    get recordingTime() {
      const since = recording()?.since;
      return since === undefined ? null : formatTapeTime((now() - since) / 1000);
    },
    get tapePosition() {
      const loaded = deck();
      return loaded ? deckPosition(loaded, now()) : 0;
    },
    get tapes() {
      return tapes();
    },
    get presets() {
      return presets.slots;
    },
    get hint() {
      return hint();
    },
    get subtitles() {
      return subtitlesStatusAtom();
    },
    /** Whether the speech models are on this device, so subtitles can be turned on here. */
    get subtitlesReady() {
      return subtitlesReady();
    },
    get category() {
      return categoryAtom();
    },

    /** Steps to the next or previous station, or recording while one plays. */
    seek: (step: -1 | 1) => {
      const playing = tape();
      if (playing) {
        const next = stepThrough(tapes(), playing, step);
        if (next) playRecording(next);
        return;
      }
      const next = seekStation(order(), playerAtom().station ?? station(), step, categoryAtom());
      if (next) void playStation(next);
    },

    /** Narrows seeking to one category; what plays stays on until the next seek. */
    pickCategory: (picked: CategoryFilter) => {
      categoryAtom.set(picked);
      const count = order().filter((each) => inCategory(each, picked)).length;
      setHint(m.radio.categoryPicked(m.radio.categories[picked], count));
    },

    /** Jumps to the next or previous country with stations in the category, and so to its painting. */
    changeScene: (step: -1 | 1) => {
      const next = nextCountry(dial(), playerAtom().station ?? station(), step);
      if (next) void playStation(next);
    },

    /** Stops what plays, or plays again what was stopped. */
    toggle: () => {
      const tuned = station();
      if (mode() === "live" || mode() === "playback") void stopPlayback();
      else if (mode() === "paused") void playDeck();
      else if (tuned) void playStation(tuned);
    },

    record: async () => {
      if (recording()) {
        const saved = await stopRecording();
        if (saved) setHint(m.radio.saved(formatTapeTime(saved.duration)));
      } else if (mode() === "live" && playerAtom().status === "playing") {
        await startRecording();
      } else {
        setHint(m.radio.recordNeedsLive);
      }
    },

    playRecording,

    deleteRecording: (doomed: Tape) => {
      if (playerAtom.get().deck?.tape.id === doomed.id) {
        if (mode() === "playback") void stopPlayback();
        unloadTape();
      }
      void remove.mutate(doomed.id);
    },

    openRecordings: () => {
      radioStation = station();
    },

    /** Recordings play only on the mountain path: leaving it, the radio plays its station again. */
    leaveRecordings: () => {
      if (!playerAtom.get().deck) return;
      unloadTape();
      const back = radioStation ?? station();
      if (back) void playStation(back);
    },

    playPreset: (key: number) => {
      const slot = presets.slots.find((each) => each.key === key);
      if (slot?.station) void playStation(slot.station);
      else setHint(m.radio.presetEmpty(key));
    },

    // Reads what plays when pressed, straight from the store.
    storePreset: (key: number) => {
      const playing = playerAtom.get();
      if (radioMode(playing) === "live" && playing.station) presets.store(playing.station, key);
      else setHint(m.radio.presetNeedsLive);
    },

    toggleSubtitles: async () => {
      if (subtitlesStatusAtom() !== "off") {
        await setSubtitles(false);
        return;
      }
      await setSubtitles(true);
      if (subtitlesStatusAtom.get() === "on") setHint(m.radio.subtitlesOn);
    },

    say: (text: string | null) => {
      setHint(text);
    },
  };
}
