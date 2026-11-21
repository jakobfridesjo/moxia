import { createAtom } from "@/shared/lib/atom.ts";
import {
  commandErrorMessage,
  commands,
  type InviteCode,
  type RoomEvent,
  type Station,
} from "@/shared/api/commands.ts";
import { currentMessages } from "@/shared/i18n/messages.ts";
import { toastError } from "@/shared/lib/toast.ts";

type RoomStatus = "out" | "opening" | "joining" | "in";

/** Something that happened in the room. `name` is null for this listener; `at` a `Date.now()`. */
export type RoomLine = { id: number; at: number } & (
  | { kind: "said"; name: string | null; text: string }
  | { kind: "joined" | "left"; name: string }
  | { kind: "tuned"; name: string | null; station: string }
);

export interface RoomState {
  status: RoomStatus;
  invite: InviteCode | null;
  /** How many are in the room, counting this listener. */
  count: number;
  /** Oldest first. */
  lines: RoomLine[];
  /** What the room listens to, as last heard or told. */
  onAir: Station | null;
  /**
   * Whether this listener's own changes of station go to the room: at once for the one who
   * opened it, and for one who joins once they have heard what it listens to.
   */
  following: boolean;
  /** The last station someone else tuned to, for the radio to follow; `seq` counts them. */
  follow: { station: Station; name: string; seq: number } | null;
  error: string | null;
}

/** How many lines the room keeps. */
const KEPT_LINES = 200;

const OUT: RoomState = {
  status: "out",
  invite: null,
  count: 1,
  lines: [],
  onAir: null,
  following: false,
  follow: null,
  error: null,
};

export const roomAtom = createAtom<RoomState>(OUT);

let lineCount = 0;

function addLine(lines: RoomLine[], line: RoomLine) {
  return [...lines, line].slice(-KEPT_LINES);
}

function line<T extends Omit<RoomLine, "id" | "at">>(fields: T, at: number) {
  return { ...fields, id: ++lineCount, at } as RoomLine;
}

/** `state` after the room reported `event` at `at`. */
export function applyRoomEvent(state: RoomState, event: RoomEvent, at = Date.now()): RoomState {
  switch (event.kind) {
    // Rust counts someone new after telling what they listen to, so a newcomer follows by now.
    case "listeners":
      return { ...state, count: event.count, following: true };
    case "joined":
    case "left":
      return {
        ...state,
        lines: addLine(state.lines, line({ kind: event.kind, name: event.name }, at)),
      };
    case "said":
      return {
        ...state,
        lines: addLine(state.lines, line({ kind: "said", name: event.name, text: event.text }, at)),
      };
    case "tuned":
      return {
        ...state,
        onAir: event.station,
        follow: {
          station: event.station,
          name: event.name,
          seq: (state.follow?.seq ?? 0) + 1,
        },
        lines: addLine(
          state.lines,
          line({ kind: "tuned", name: event.name, station: event.station.name }, at)
        ),
      };
    case "closed":
      return { ...OUT, lines: state.lines, error: currentMessages().together.closed };
  }
}

/** Counts rooms, so events from one already left are dropped. */
let roomCount = 0;

function listen(room: number) {
  return (event: RoomEvent) => {
    if (room === roomCount) roomAtom.set((state) => applyRoomEvent(state, event));
  };
}

async function enter(
  status: "opening" | "joining",
  start: (onEvent: (event: RoomEvent) => void) => Promise<InviteCode>,
  fallback: string
) {
  const room = ++roomCount;
  roomAtom.set({ ...OUT, status });
  try {
    const invite = await start(listen(room));
    if (room !== roomCount) return;
    roomAtom.set((state) => ({
      ...state,
      status: "in",
      invite,
      following: state.following || status === "opening",
    }));
  } catch (error) {
    if (room !== roomCount) return;
    roomAtom.set({ ...OUT, error: commandErrorMessage(error, fallback) });
  }
}

/** Opens a room as `name`; the radio others join follows this listener's station. */
export function openRoom(name: string) {
  return enter(
    "opening",
    (onEvent) => commands.openRoom(name, onEvent),
    currentMessages().together.openFailed
  );
}

/** Joins the room `invite` leads to as `name`, taking up whatever it listens to. */
export function joinRoom(invite: string, name: string) {
  return enter(
    "joining",
    (onEvent) => commands.joinRoom(invite, name, onEvent),
    currentMessages().together.joinFailed
  );
}

export async function sayToRoom(text: string) {
  const said = text.trim();
  if (!said || roomAtom.get().status !== "in") return;
  roomAtom.set((state) => ({
    ...state,
    lines: addLine(state.lines, line({ kind: "said", name: null, text: said }, Date.now())),
  }));
  try {
    await commands.sayToRoom(said);
  } catch (error) {
    toastError(commandErrorMessage(error, currentMessages().together.sayFailed));
  }
}

/** Tells the room this listener tuned to `station`, unless the room already listens to it. */
export async function shareStation(station: Station) {
  const state = roomAtom.get();
  if (state.status !== "in" || !state.following || state.onAir?.id === station.id) return;
  roomAtom.set({
    ...state,
    onAir: station,
    lines: addLine(
      state.lines,
      line({ kind: "tuned", name: null, station: station.name }, Date.now())
    ),
  });
  try {
    await commands.tuneRoom(station);
  } catch (error) {
    toastError(commandErrorMessage(error, currentMessages().together.tuneFailed));
  }
}

export async function leaveRoom() {
  roomCount += 1;
  roomAtom.set(OUT);
  await commands.leaveRoom().catch(() => undefined);
}

/** Back to no room, for tests that share one page. */
export function resetRoom() {
  roomCount += 1;
  roomAtom.set(OUT);
}
