import { createEffect, createMemo } from "solid-js";
import { listenerNameAtom } from "@/shared/config/preferences.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { isActive, playerAtom } from "@/features/player/model/player-store.ts";
import { usePlayStation } from "@/features/player/model/use-play-station.ts";
import {
  joinRoom,
  leaveRoom,
  openRoom,
  roomAtom,
  sayToRoom,
  shareStation,
} from "@/pages/radio/model/room-store.ts";

/**
 * Keeps the radio and the room listening together in step: plays what others tune to, tells the
 * room what this listener tunes to, and puts who comes, goes and tunes in the hint corner.
 */
export function useListenTogether(say: (hint: string) => void) {
  const m = useMessages();
  const playStation = usePlayStation();

  // What was last passed on to the hint corner, so each piece of news shows once.
  const seen = { follow: 0, line: 0, error: null as string | null };

  createEffect(
    createMemo(() => roomAtom().follow),
    (follow) => {
      if (!follow || follow.seq === seen.follow) return;
      seen.follow = follow.seq;
      void playStation(follow.station);
      say(m.together.tuned(follow.name, follow.station.name));
    }
  );

  const tunedTo = createMemo(() => playerAtom().station);
  const playerStatus = createMemo(() => playerAtom().status);
  const roomStatus = createMemo(() => roomAtom().status);
  const following = createMemo(() => roomAtom().following);
  createEffect(
    () => [tunedTo(), playerStatus(), roomStatus(), following()],
    () => {
      // Read fresh: a station just followed has already replaced the one this run saw.
      const { source, station, status } = playerAtom.get();
      if (source === "station" && station && isActive(status)) void shareStation(station);
    }
  );

  createEffect(
    createMemo(() => roomAtom().lines.at(-1)),
    (line) => {
      if (!line || line.id === seen.line) return;
      seen.line = line.id;
      if (line.kind === "joined") say(m.together.joined(line.name));
      if (line.kind === "left") say(m.together.left(line.name));
    }
  );

  createEffect(
    createMemo(() => roomAtom().error),
    (error) => {
      if (error === seen.error) return;
      seen.error = error;
      if (error) say(error);
    }
  );

  return {
    get room() {
      return roomAtom();
    },
    /** The name this listener goes by in a room. */
    get name() {
      return listenerNameAtom();
    },
    setName: (next: string) => listenerNameAtom.set(next),
    open: () => void openRoom(listenerNameAtom()),
    join: (invite: string) => void joinRoom(invite, listenerNameAtom()),
    say: (text: string) => void sayToRoom(text),
    leave: () => void leaveRoom(),
  };
}
