import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { commandErrorMessage, commands, type Station, type Tape } from "@/shared/api/commands.ts";
import { modelsQuery, stationsQuery, tapesQuery } from "@/shared/api/queries.ts";
import { subtitlesAtom } from "@/shared/config/preferences.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { formatTapeTime } from "@/shared/lib/duration.ts";
import { toastError } from "@/shared/lib/toast.ts";
import { useNow } from "@/shared/lib/use-now.ts";
import { dialOrder, nextCountry } from "@/pages/radio/model/station-order.ts";
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

export function useRadioManager() {
  const m = useMessages();
  const queryClient = useQueryClient();
  const player = useSelector(playerAtom);
  const stations = useQuery(stationsQuery());
  const order = useMemo(() => dialOrder(stations.data ?? []), [stations.data]);
  const tapes = useTapes().data ?? [];
  const presets = usePresets();
  const playStation = usePlayStation();
  const mode = radioMode(player);
  const { recording, deck } = player;
  const now = useNow(250, recording !== null || mode === "playback");
  const subtitles = useSelector(subtitlesStatusAtom);
  const models = useQuery(modelsQuery());
  const subtitlesReady =
    models.data?.some((entry) => entry.model === "subtitles" && entry.downloaded) ?? false;

  // Subtitles left on last time come back on once Rust has the models to hand.
  useEffect(() => {
    if (subtitlesReady && subtitlesAtom.get() && subtitlesStatusAtom.get() === "off")
      void setSubtitles(true);
  }, [subtitlesReady]);

  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(null), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  // The station to go back to after listening to a recording.
  const lastLive = useRef<Station | null>(null);
  useEffect(() => {
    if (player.source === "station" && player.station) lastLive.current = player.station;
  }, [player.source, player.station]);

  // Before anything plays, the radio shows the first preset, or else the first station.
  const firstPreset = presets.slots.find((slot) => slot.station)?.station ?? null;
  const station = player.station ?? firstPreset ?? order[0] ?? null;
  const tape = (mode === "playback" || mode === "paused") && deck ? deck.tape : null;

  const remove = useMutation({
    mutationFn: (id: string) => commands.deleteTape(id),
    onSuccess: () => setHint(m.radio.deleted),
    onError: (error) => toastError(commandErrorMessage(error, m.radio.deleteFailed)),
    onSettled: () => queryClient.invalidateQueries(tapesQuery()),
  });

  const playRecording = (recorded: Tape) => {
    loadTape(recorded);
    void playDeck();
  };

  return {
    mode,
    station,
    tape,
    loading: stations.isPending,
    recording: recording !== null,
    nowPlaying: player.nowPlaying,
    connecting: player.status === "connecting" || player.status === "buffering",
    error: player.error,
    recordingTime: recording ? formatTapeTime((now - recording.since) / 1000) : null,
    tapePosition: deck ? deckPosition(deck, now) : 0,
    tapes,
    presets: presets.slots,
    hint,
    subtitles,
    /** Whether the speech models are on this device, so subtitles can be turned on here. */
    subtitlesReady,

    /** Steps to the next or previous station, or recording while one plays. */
    seek: (step: -1 | 1) => {
      if (tape) {
        const next = stepThrough(tapes, tape, step);
        if (next) playRecording(next);
        return;
      }
      const next = stepThrough(order, player.station ?? station, step);
      if (next) void playStation(next);
    },

    /** Jumps to the next or previous country's stations, and so to its painting. */
    changeScene: (step: -1 | 1) => {
      const next = nextCountry(order, player.station ?? station, step);
      if (next) void playStation(next);
    },

    /** Stops what plays, or plays again what was stopped. */
    toggle: () => {
      if (mode === "live" || mode === "playback") void stopPlayback();
      else if (mode === "paused") void playDeck();
      else if (station) void playStation(station);
    },

    record: async () => {
      if (recording) {
        const saved = await stopRecording();
        if (saved) setHint(m.radio.saved(formatTapeTime(saved.duration)));
      } else if (mode === "live" && player.status === "playing") {
        await startRecording();
      } else {
        setHint(m.radio.recordNeedsLive);
      }
    },

    playRecording,

    deleteRecording: (doomed: Tape) => {
      if (playerAtom.get().deck?.tape.id === doomed.id) {
        if (mode === "playback") void stopPlayback();
        unloadTape();
      }
      remove.mutate(doomed.id);
    },

    backToLive: () => {
      const live = lastLive.current ?? station;
      if (live) void playStation(live);
    },

    playPreset: (key: number) => {
      const slot = presets.slots.find((each) => each.key === key);
      if (slot?.station) void playStation(slot.station);
      else setHint(m.radio.presetEmpty(key));
    },

    // Reads what plays when pressed, so the keys holding it need not re-render at every station.
    storePreset: (key: number) => {
      const now = playerAtom.get();
      if (radioMode(now) === "live" && now.station) presets.store(now.station, key);
      else setHint(m.radio.presetNeedsLive);
    },

    toggleSubtitles: async () => {
      if (subtitles !== "off") {
        await setSubtitles(false);
        return;
      }
      await setSubtitles(true);
      if (subtitlesStatusAtom.get() === "on") setHint(m.radio.subtitlesOn);
    },

    say: setHint,
  };
}
