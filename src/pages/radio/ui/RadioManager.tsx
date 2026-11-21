import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMessages } from "@/shared/i18n/messages.ts";
import { formatShortDateTime } from "@/shared/lib/date.ts";
import { formatTapeTime } from "@/shared/lib/duration.ts";
import { cn } from "@/shared/lib/class-names.ts";
import { nightAtom } from "@/shared/lib/night.ts";
import { noteAt } from "@/pages/radio/model/radio-state.ts";
import { useLocalSky } from "@/pages/radio/model/use-local-sky.ts";
import { useMediaControls } from "@/pages/radio/model/use-media-controls.ts";
import { useListenTogether } from "@/pages/radio/model/use-listen-together.ts";
import { useRadioManager } from "@/pages/radio/model/use-radio-manager.ts";
import { CategorySeal } from "@/pages/radio/ui/CategorySeal.tsx";
import { ChatDrift } from "@/pages/radio/ui/ChatDrift.tsx";
import { InkScene, type Move } from "@/pages/radio/ui/InkScene.tsx";
import { Inscription } from "@/pages/radio/ui/Inscription.tsx";
import { PresetBlock } from "@/pages/radio/ui/PresetBlock.tsx";
import { Seal, SealInk } from "@/pages/radio/ui/Seal.tsx";
import { MountainPath } from "@/pages/radio/ui/MountainPath.tsx";
import { RoomChat } from "@/pages/radio/ui/RoomChat.tsx";
import { TogetherSheet } from "@/pages/radio/ui/TogetherSheet.tsx";

/** How far a finger moves sideways before a tap becomes a swipe, in px. */
const SWIPE_PX = 50;
/** How long the hint shows when the radio opens, in ms. */
const WELCOME_MS = 5000;

/** The radio: an ink painting whose inscription names the station, with seals for keys. */
function RadioManager() {
  const m = useMessages();
  const radio = useRadioManager();
  const navigate = useNavigate();
  const together = useListenTogether(radio.say);
  const [pathOpen, setPathOpen] = useState(false);
  const [sheet, setSheet] = useState<"together" | "chat" | null>(null);
  const inRoom = together.room.status === "in";
  const [welcome, setWelcome] = useState(true);
  const [move, setMove] = useState<Move | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const keys = useRef<HTMLDivElement>(null);
  const { mode, station, tape } = radio;
  const showing = tape?.station ?? station;
  const playingBack = mode === "playback" || mode === "paused";

  useEffect(() => {
    const timer = setTimeout(() => setWelcome(false), WELCOME_MS);
    return () => clearTimeout(timer);
  }, []);

  // The painting moves the way the finger did: mist blows after it, a new place soaks in where it lifted.
  const seek = (step: -1 | 1) => {
    setMove((last) => ({
      id: (last?.id ?? 0) + 1,
      kind: "station",
      direction: step > 0 ? -1 : 1,
      at: [0.5, 0.5],
    }));
    radio.seek(step);
  };

  const changeScene = (step: -1 | 1, from?: [number, number]) => {
    const at = from ?? [0.5, step > 0 ? 0.75 : 0.25];
    setMove((last) => ({ id: (last?.id ?? 0) + 1, kind: "place", direction: step, at }));
    radio.changeScene(step);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (pathOpen) {
        if (event.key === "Escape") setPathOpen(false);
        return;
      }
      if (sheet) {
        if (event.key === "Escape") setSheet(null);
        return;
      }
      const onControl = event.target instanceof HTMLElement && event.target.closest("button, a");
      const preset = /^Digit([1-6])$/.exec(event.code);
      if (event.key === "ArrowRight") seek(1);
      else if (event.key === "ArrowLeft") seek(-1);
      else if (event.key === "ArrowUp") changeScene(1);
      else if (event.key === "ArrowDown") changeScene(-1);
      else if (event.key === " " && !onControl) radio.toggle();
      else if (preset) {
        const key = Number(preset[1]);
        if (event.shiftKey) radio.storePreset(key);
        else radio.playPreset(key);
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const nowLine = radio.error
    ? radio.error
    : radio.reconnecting
      ? m.radio.reconnecting
      : radio.connecting
        ? m.radio.connecting
        : tape
          ? (noteAt(tape.notes, radio.tapePosition)?.title ?? null)
          : mode === "live"
            ? radio.nowPlaying
              ? m.radio.onAir(radio.nowPlaying)
              : m.radio.live
            : station && m.radio.stopped;
  const placeLine = tape
    ? formatShortDateTime(tape.recordedAt)
    : showing && [m.countries[showing.countryCode], showing.state].filter(Boolean).join(" · ");
  const extraLine = radio.recordingTime
    ? m.radio.recording(radio.recordingTime)
    : tape
      ? `${formatTapeTime(radio.tapePosition)} / ${formatTapeTime(tape.duration)}`
      : null;
  const title = showing?.name ?? (radio.loading ? m.radio.loading : m.radio.appName);
  const programme = tape
    ? (noteAt(tape.notes, radio.tapePosition)?.title ?? null)
    : mode === "live"
      ? radio.nowPlaying
      : null;
  // The inscription is written in Chinese; what needs reading in the interface's language shows below it.
  const notice =
    radio.error ??
    (radio.reconnecting
      ? m.radio.reconnecting
      : radio.connecting
        ? m.radio.connecting
        : extraLine) ??
    (radio.subtitles === "loading" ? m.radio.subtitlesLoading : null);
  const region = showing?.countryCode ?? "CN";
  const sky = useLocalSky(region, showing ?? null);
  const playing = mode === "live" || mode === "playback";
  useMediaControls(
    { title: showing?.name ?? null, artist: programme, playing },
    { toggle: radio.toggle, seek: radio.seek, playing }
  );
  const hint =
    radio.hint ??
    notice ??
    (welcome || mode === "idle" || mode === "stopped" || mode === "paused"
      ? playingBack
        ? m.radio.hintPlayback
        : m.radio.hint
      : programme);

  return (
    <>
      <main
        aria-label={m.radio.label}
        aria-describedby="radio-gestures"
        className="fixed inset-0 touch-none overflow-hidden bg-paper text-ink select-none"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("[data-control]")) return;
          down.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = down.current;
          down.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) seek(dx < 0 ? 1 : -1);
          else if (Math.abs(dy) > SWIPE_PX)
            changeScene(dy < 0 ? 1 : -1, [
              event.clientX / window.innerWidth,
              event.clientY / window.innerHeight,
            ]);
          else if (Math.hypot(dx, dy) < 12) radio.toggle();
        }}
      >
        <p id="radio-gestures" className="sr-only">
          {m.radio.gestures}
        </p>
        <InkScene
          region={region}
          station={showing ?? null}
          listening={(mode === "live" && !radio.reconnecting) || mode === "playback"}
          writing={radio.recording}
          move={move}
          sky={sky}
          covered={pathOpen}
          keys={keys}
        />

        <div role="status" aria-live="polite" className="sr-only">
          {[title, nowLine, placeLine, extraLine].filter(Boolean).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <SealInk />
        <Inscription
          title={title}
          station={showing ?? null}
          recordedAt={tape?.recordedAt ?? null}
        />

        <div
          ref={keys}
          className="absolute top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] grid grid-cols-2 gap-2"
        >
          <Seal
            aria-label={m.radio.sealLabels.settings}
            onClick={() => void navigate({ to: "/settings" })}
          >
            {m.radio.seals.settings}
          </Seal>
          <Seal
            pressed={pathOpen}
            aria-label={m.radio.sealLabels.recordings}
            onClick={() => {
              radio.openRecordings();
              setPathOpen(true);
            }}
          >
            {m.radio.seals.path}
          </Seal>
          <Seal
            pressed={radio.subtitles !== "off"}
            aria-label={
              radio.subtitles === "off"
                ? m.radio.sealLabels.subtitlesOn
                : m.radio.sealLabels.subtitlesOff
            }
            onClick={() => {
              if (radio.subtitlesReady || radio.subtitles !== "off") void radio.toggleSubtitles();
              else {
                radio.say(m.radio.subtitlesNeedDownload);
                void navigate({ to: "/settings" });
              }
            }}
          >
            {m.radio.seals.subtitles}
          </Seal>
          <div className="relative grid">
            <Seal
              pressed={inRoom}
              aria-label={
                inRoom
                  ? m.radio.sealLabels.togetherIn(together.room.count)
                  : m.radio.sealLabels.together
              }
              onClick={() => setSheet("together")}
            >
              {m.radio.seals.together}
            </Seal>
            {inRoom && (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-full ml-2.5 -translate-y-1/2 font-brush text-2xl font-bold text-seal [text-shadow:0_0_2px_var(--paper),0_0_6px_var(--paper),0_0_12px_var(--paper)]"
              >
                {together.room.count}
              </span>
            )}
          </div>
        </div>

        {inRoom && sheet !== "chat" && <ChatDrift lines={together.room.lines} />}

        <div className="absolute right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] flex items-end">
          <PresetBlock
            slots={radio.presets}
            onAirId={mode === "live" ? (station?.id ?? null) : null}
            onPlay={radio.playPreset}
            onStore={radio.storePreset}
          />
          <div className="flex h-11 flex-1 items-center justify-center">
            {!playingBack && <CategorySeal category={radio.category} onPick={radio.pickCategory} />}
          </div>
          <div className="flex items-center gap-4">
            {inRoom && (
              <Seal aria-label={m.radio.sealLabels.chat} onClick={() => setSheet("chat")}>
                {m.radio.seals.chat}
              </Seal>
            )}
            <Seal
              shape="round"
              pressed={radio.recording}
              aria-label={
                radio.recording ? m.radio.sealLabels.stopRecording : m.radio.sealLabels.rec
              }
              onClick={() => void radio.record()}
            >
              {m.radio.seals.rec}
            </Seal>
          </div>
        </div>

        {pathOpen && (
          <MountainPath
            tapes={radio.tapes}
            playing={mode === "playback" ? tape : null}
            hint={radio.hint ?? notice}
            onPlay={(chosen) =>
              chosen.id === tape?.id ? radio.toggle() : radio.playRecording(chosen)
            }
            onBreak={(broken) => {
              if (mode === "playback" && broken.id === tape?.id) radio.toggle();
              radio.say(nightAtom.get() ? m.radio.unburnHint : m.radio.mendHint);
            }}
            onDelete={radio.deleteRecording}
            onLeave={() => {
              setPathOpen(false);
              radio.leaveRecordings();
            }}
          />
        )}

        <p
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-[max(1.75rem,env(safe-area-inset-right))] bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+6.5rem)] max-w-[80%] text-right font-serif text-sm font-bold tracking-wide text-ink [text-shadow:0_0_1px_var(--paper),0_0_2px_var(--paper),0_0_2px_var(--paper),0_0_3px_var(--paper),0_0_6px_var(--paper),0_0_12px_var(--paper),0_0_20px_var(--paper)] transition-opacity duration-700",
            hint ? "opacity-100" : "opacity-0"
          )}
        >
          {hint}
        </p>
      </main>
      {sheet === "together" && (
        <TogetherSheet
          room={together.room}
          name={together.name}
          onName={together.setName}
          onOpen={together.open}
          onJoin={together.join}
          onLeave={() => {
            together.leave();
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "chat" && inRoom && (
        <RoomChat
          room={together.room}
          onSay={together.say}
          onLeave={() => {
            together.leave();
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

export default RadioManager;
