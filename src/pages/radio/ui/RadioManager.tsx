import { createSignal, For, onSettled, Show } from "solid-js";
import { useNavigate } from "@tanstack/solid-router";
import { useMessages } from "@/shared/i18n/messages.ts";
import { formatShortDateTime } from "@/shared/lib/date.ts";
import { formatTapeTime } from "@/shared/lib/duration.ts";
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
  const [pathOpen, setPathOpen] = createSignal(false);
  const [sheet, setSheet] = createSignal<"together" | "chat" | null>(null);
  const inRoom = () => together.room.status === "in";
  const [welcome, setWelcome] = createSignal(true);
  const [move, setMove] = createSignal<Move | null>(null);
  let down: { x: number; y: number } | null = null;
  let keys: HTMLDivElement | undefined;
  const showing = () => radio.tape?.station ?? radio.station;
  const playingBack = () => radio.mode === "playback" || radio.mode === "paused";

  onSettled(() => {
    const timer = setTimeout(() => setWelcome(false), WELCOME_MS);
    return () => clearTimeout(timer);
  });

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

  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (pathOpen()) {
        if (event.key === "Escape") setPathOpen(false);
        return;
      }
      if (sheet()) {
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

  const note = () => {
    const tape = radio.tape;
    return tape ? (noteAt(tape.notes, radio.tapePosition)?.title ?? null) : null;
  };
  const nowLine = () => {
    if (radio.error) return radio.error;
    if (radio.reconnecting) return m.radio.reconnecting;
    if (radio.connecting) return m.radio.connecting;
    if (radio.tape) return note();
    if (radio.mode === "live")
      return radio.nowPlaying ? m.radio.onAir(radio.nowPlaying) : m.radio.live;
    return radio.station && m.radio.stopped;
  };
  const placeLine = () => {
    const tape = radio.tape;
    if (tape) return formatShortDateTime(tape.recordedAt);
    const shown = showing();
    return shown && [m.countries[shown.countryCode], shown.state].filter(Boolean).join(" · ");
  };
  const extraLine = () => {
    const tape = radio.tape;
    if (radio.recordingTime) return m.radio.recording(radio.recordingTime);
    return tape ? `${formatTapeTime(radio.tapePosition)} / ${formatTapeTime(tape.duration)}` : null;
  };
  const title = () => showing()?.name ?? (radio.loading ? m.radio.loading : m.radio.appName);
  const programme = () => (radio.tape ? note() : radio.mode === "live" ? radio.nowPlaying : null);
  // The inscription is written in Chinese; what needs reading in the interface's language shows below it.
  const notice = () =>
    radio.error ??
    (radio.reconnecting
      ? m.radio.reconnecting
      : radio.connecting
        ? m.radio.connecting
        : extraLine()) ??
    (radio.subtitles === "loading" ? m.radio.subtitlesLoading : null);
  const region = () => showing()?.countryCode ?? "CN";
  const sky = useLocalSky(region, () => showing() ?? null);
  const playing = () => radio.mode === "live" || radio.mode === "playback";
  useMediaControls(
    {
      get title() {
        return showing()?.name ?? null;
      },
      get artist() {
        return programme();
      },
      get playing() {
        return playing();
      },
    },
    {
      toggle: radio.toggle,
      seek: radio.seek,
      get playing() {
        return playing();
      },
    }
  );
  const hint = () =>
    radio.hint ??
    notice() ??
    (welcome() || radio.mode === "idle" || radio.mode === "stopped" || radio.mode === "paused"
      ? playingBack()
        ? m.radio.hintPlayback
        : m.radio.hint
      : programme());

  const leavePath = () => {
    setPathOpen(false);
    radio.leaveRecordings();
  };
  const leaveRoom = () => {
    together.leave();
    setSheet(null);
  };

  return (
    <>
      <main
        aria-label={m.radio.label}
        aria-describedby="radio-gestures"
        class="fixed inset-0 touch-none overflow-hidden bg-paper text-ink select-none"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("[data-control]")) return;
          down = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = down;
          down = null;
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
        <p id="radio-gestures" class="sr-only">
          {m.radio.gestures}
        </p>
        <InkScene
          region={region()}
          station={showing() ?? null}
          listening={(radio.mode === "live" && !radio.reconnecting) || radio.mode === "playback"}
          writing={radio.recording}
          move={move()}
          sky={sky}
          covered={pathOpen()}
          keys={() => keys}
        />

        <div role="status" aria-live="polite" class="sr-only">
          <For
            each={[title(), nowLine(), placeLine(), extraLine()].filter((line): line is string =>
              Boolean(line)
            )}
            keyed={false}
          >
            {(line) => <p>{line()}</p>}
          </For>
        </div>
        <SealInk />
        <Inscription
          title={title()}
          station={showing() ?? null}
          recordedAt={radio.tape?.recordedAt ?? null}
        />

        <div
          ref={(element) => (keys = element)}
          class="absolute top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] grid grid-cols-2 gap-2"
        >
          <Seal
            aria-label={m.radio.sealLabels.settings}
            onClick={() => void navigate({ to: "/settings" })}
          >
            {m.radio.seals.settings}
          </Seal>
          <Seal
            pressed={pathOpen()}
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
          <div class="relative grid">
            <Seal
              pressed={inRoom()}
              aria-label={
                inRoom()
                  ? m.radio.sealLabels.togetherIn(together.room.count)
                  : m.radio.sealLabels.together
              }
              onClick={() => setSheet("together")}
            >
              {m.radio.seals.together}
            </Seal>
            <Show when={inRoom()}>
              <span
                aria-hidden="true"
                class="pointer-events-none absolute top-1/2 left-full ml-2.5 -translate-y-1/2 font-brush text-2xl font-bold text-seal [text-shadow:0_0_2px_var(--paper),0_0_6px_var(--paper),0_0_12px_var(--paper)]"
              >
                {together.room.count}
              </span>
            </Show>
          </div>
        </div>

        <Show when={inRoom() && sheet() !== "chat"}>
          <ChatDrift lines={together.room.lines} />
        </Show>

        <div class="absolute right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] flex items-end">
          <PresetBlock
            slots={radio.presets}
            onAirId={radio.mode === "live" ? (radio.station?.id ?? null) : null}
            onPlay={radio.playPreset}
            onStore={radio.storePreset}
          />
          <div class="flex h-11 flex-1 items-center justify-center">
            <Show when={!playingBack()}>
              <CategorySeal category={radio.category} onPick={radio.pickCategory} />
            </Show>
          </div>
          <div class="flex items-center gap-4">
            <Show when={inRoom()}>
              <Seal aria-label={m.radio.sealLabels.chat} onClick={() => setSheet("chat")}>
                {m.radio.seals.chat}
              </Seal>
            </Show>
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

        <Show when={pathOpen()}>
          <MountainPath
            tapes={radio.tapes}
            playing={radio.mode === "playback" ? radio.tape : null}
            hint={radio.hint ?? notice()}
            onPlay={(chosen) =>
              chosen.id === radio.tape?.id ? radio.toggle() : radio.playRecording(chosen)
            }
            onBreak={(broken) => {
              if (radio.mode === "playback" && broken.id === radio.tape?.id) radio.toggle();
              radio.say(nightAtom.get() ? m.radio.unburnHint : m.radio.mendHint);
            }}
            onDelete={radio.deleteRecording}
            onLeave={leavePath}
          />
        </Show>

        <p
          aria-hidden="true"
          class={[
            "pointer-events-none absolute right-[max(1.75rem,env(safe-area-inset-right))] bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+6.5rem)] max-w-[80%] text-right font-serif text-sm font-bold tracking-wide text-ink [text-shadow:0_0_1px_var(--paper),0_0_2px_var(--paper),0_0_2px_var(--paper),0_0_3px_var(--paper),0_0_6px_var(--paper),0_0_12px_var(--paper),0_0_20px_var(--paper)] transition-opacity duration-700",
            hint() ? "opacity-100" : "opacity-0",
          ]}
        >
          {hint()}
        </p>
      </main>
      <Show when={sheet() === "together"}>
        <TogetherSheet
          room={together.room}
          name={together.name}
          onName={together.setName}
          onOpen={together.open}
          onJoin={together.join}
          onLeave={leaveRoom}
          onClose={() => setSheet(null)}
        />
      </Show>
      <Show when={sheet() === "chat" && inRoom()}>
        <RoomChat
          room={together.room}
          onSay={together.say}
          onLeave={leaveRoom}
          onClose={() => setSheet(null)}
        />
      </Show>
    </>
  );
}

export default RadioManager;
