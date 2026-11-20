import { useEffect, useRef } from "react";
import { useSelector } from "@tanstack/react-store";
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
  const room = useSelector(roomAtom);
  const name = useSelector(listenerNameAtom);
  const player = useSelector(playerAtom);
  const playStation = usePlayStation();

  // What was last passed on to the hint corner, so each piece of news shows once.
  const seen = useRef({ follow: 0, line: 0, error: null as string | null });

  useEffect(() => {
    const follow = room.follow;
    if (!follow || follow.seq === seen.current.follow) return;
    seen.current.follow = follow.seq;
    void playStation(follow.station);
    say(m.together.tuned(follow.name, follow.station.name));
  });

  // Read fresh: a station just followed has already replaced the one this render saw.
  useEffect(() => {
    const { source, station, status } = playerAtom.get();
    if (source === "station" && station && isActive(status)) void shareStation(station);
  }, [player.station, player.status, room.status, room.following]);

  useEffect(() => {
    const line = room.lines.at(-1);
    if (!line || line.id === seen.current.line) return;
    seen.current.line = line.id;
    if (line.kind === "joined") say(m.together.joined(line.name));
    if (line.kind === "left") say(m.together.left(line.name));
  });

  useEffect(() => {
    if (room.error === seen.current.error) return;
    seen.current.error = room.error;
    if (room.error) say(room.error);
  });

  return {
    room,
    /** The name this listener goes by in a room. */
    name,
    setName: (next: string) => listenerNameAtom.set(next),
    open: () => void openRoom(name),
    join: (invite: string) => void joinRoom(invite, name),
    say: (text: string) => void sayToRoom(text),
    leave: () => void leaveRoom(),
  };
}
