import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onSettled,
  Show,
} from "solid-js";
import { X } from "lucide";
import { useMessages } from "@/shared/i18n/messages.ts";
import { ariaBoolean } from "@/shared/lib/aria.ts";
import { formatClockTime } from "@/shared/lib/date.ts";
import { formatMegabytes } from "@/shared/lib/number-format.ts";
import { Icon } from "@/shared/ui/Icon.tsx";
import { ModelDownloadFailure, ModelDownloadProgress } from "@/shared/ui/ModelDownloadProgress.tsx";
import { Button } from "@/shared/ui/shadcn/button.tsx";
import type { RoomLine, RoomState } from "@/pages/radio/model/room-store.ts";
import {
  isTranslatable,
  type MessageTranslation,
  type MissingTranslator,
  useMessageTranslation,
} from "@/pages/radio/model/use-message-translation.ts";
import { Seal } from "@/pages/radio/ui/Seal.tsx";

interface RoomChatProps {
  room: RoomState;
  onSay: (text: string) => void;
  onLeave: () => void;
  onClose: () => void;
}

/** The whole conversation, over the lower part of the painting, with a line to write in. */
export function RoomChat(props: RoomChatProps) {
  const m = useMessages();
  const [draft, setDraft] = createSignal("");
  const ids = { title: createUniqueId(), message: createUniqueId() };
  let list: HTMLOListElement | undefined;
  let field: HTMLInputElement | undefined;

  onSettled(() => field?.focus());
  createEffect(
    createMemo(() => props.room.lines.at(-1)?.id),
    () => {
      list?.lastElementChild?.scrollIntoView({ block: "end" });
    }
  );

  const send = () => {
    if (!draft().trim()) return;
    props.onSay(draft());
    setDraft("");
    field?.focus();
  };

  return (
    <section
      data-control
      role="dialog"
      aria-labelledby={ids.title}
      class="fixed inset-x-0 bottom-0 z-10 flex h-[65svh] flex-col text-ink select-text"
    >
      <div aria-hidden="true" class="h-14 shrink-0 bg-linear-to-b from-paper/0 to-paper/97" />
      <div class="flex min-h-0 flex-1 flex-col bg-paper/97 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <header class="flex items-center gap-2 border-b border-ink/15 pr-2 pb-2 pl-5">
          <h2 id={ids.title} class="flex-1 text-ink-soft">
            {m.together.listening(props.room.count)}
          </h2>
          <Button variant="outline" onClick={() => props.onLeave()} class="h-11 px-3">
            <span aria-hidden="true" lang="zh" class="font-brush text-lg text-seal">
              {m.together.glyphs.leave}
            </span>
            {m.together.leave}
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={m.together.close}
            onClick={() => props.onClose()}
          >
            <Icon icon={X} />
          </Button>
        </header>

        <ol
          ref={(element) => (list = element)}
          aria-label={m.together.messages}
          aria-live="polite"
          class="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-3.5"
        >
          <Show when={props.room.lines.length === 0}>
            <li class="text-center text-ink-soft">{m.together.nothingSaid}</li>
          </Show>
          <For each={props.room.lines}>
            {(line) => (
              <li>
                <Line line={line} />
              </li>
            )}
          </For>
        </ol>

        <form
          class="mx-3 flex items-center gap-2.5 border-y-2 border-ink/75 py-1.5 pr-1.5 pl-4"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label for={ids.message} class="sr-only">
            {m.together.message}
          </label>
          <input
            ref={(element) => (field = element)}
            id={ids.message}
            value={draft()}
            maxlength={500}
            autocomplete="off"
            placeholder={m.together.write}
            onInput={(event) => setDraft(event.currentTarget.value)}
            class="h-11 min-w-0 flex-1 bg-transparent font-brush text-xl outline-none placeholder:text-ink-soft"
          />
          <Seal aria-label={m.together.send} pressed onClick={send}>
            {m.together.glyphs.send}
          </Seal>
        </form>
      </div>
    </section>
  );
}

/** A line never changes once it is in the room, so it is read once. */
function Line(props: { line: RoomLine }) {
  const m = useMessages();
  const line = props.line;
  const at = formatClockTime(line.at);
  if (line.kind === "said")
    return <SaidLine name={line.name ?? m.together.you} at={at} text={line.text} />;
  const text = () =>
    line.kind === "tuned"
      ? line.name === null
        ? m.together.youTuned(line.station)
        : m.together.tuned(line.name, line.station)
      : m.together[line.kind](line.name);
  return (
    <p class="text-center text-sm text-ink-soft">
      {text()} · {at}
    </p>
  );
}

function SaidLine(props: { name: string; at: string; text: string }) {
  const header = (
    <div class="flex items-baseline gap-2 text-sm">
      <strong>{props.name}</strong>
      <span class="text-ink-soft">{props.at}</span>
    </div>
  );
  const said = <p class="font-brush text-lg leading-snug break-words">{props.text}</p>;
  const text = props.text;
  if (!isTranslatable(text))
    return (
      <div>
        {header}
        {said}
      </div>
    );
  return <TranslatableLine header={header} said={said} text={text} />;
}

function TranslatableLine(props: { header: JSX.Element; said: JSX.Element; text: string }) {
  const m = useMessages();
  const translation = useMessageTranslation(props.text);
  return (
    <div>
      <div class="flex items-center gap-2">
        <div class="flex-1">{props.header}</div>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={ariaBoolean(translation.shown)}
          onClick={translation.toggle}
          class="-my-1 h-8 gap-1 px-2 text-ink-soft aria-pressed:text-ink"
        >
          <span aria-hidden="true" lang="zh" class="font-brush text-base text-seal">
            {m.together.glyphs.translate}
          </span>
          {m.together.translate}
        </Button>
      </div>
      {props.said}
      <Show when={translation.shown}>
        <Translation of={translation} />
      </Show>
    </div>
  );
}

function Translation(props: { of: MessageTranslation }) {
  const m = useMessages();
  return (
    <Show
      when={props.of.missing}
      fallback={
        <Show
          when={props.of.loading ? m.together.translating : props.of.error}
          fallback={
            <p lang="en" class="mt-1 leading-snug break-words text-ink-soft">
              {props.of.translation}
            </p>
          }
        >
          {(note) => <p class="mt-1 text-sm text-ink-soft">{note()}</p>}
        </Show>
      }
    >
      {(missing) => <TranslatorDownload translator={missing()} />}
    </Show>
  );
}

function TranslatorDownload(props: { translator: MissingTranslator }) {
  const m = useMessages();
  const downloading = () => {
    const download = props.translator.download;
    return download?.state === "downloading" ? download : undefined;
  };
  const failed = () => {
    const download = props.translator.download;
    return download?.state === "failed" ? download : undefined;
  };
  return (
    <Show
      when={downloading()}
      fallback={
        <div class="mt-2 flex flex-col items-start gap-2">
          <Show
            when={failed()}
            fallback={
              <p class="text-sm text-ink-soft">
                {m.together.translatorMissing(formatMegabytes(props.translator.bytes))}
              </p>
            }
          >
            {(download) => <ModelDownloadFailure download={download()} />}
          </Show>
          <Button variant="outline" size="sm" onClick={() => props.translator.onDownload()}>
            {props.translator.download ? m.common.tryAgain : m.models.download}
          </Button>
        </div>
      }
    >
      {(download) => (
        <div class="mt-2 flex flex-col gap-2">
          <p class="text-sm text-ink-soft">{m.together.translatorDownloading}</p>
          <ModelDownloadProgress progress={download()} label={m.translator.modelName} />
          <Button
            variant="outline"
            size="sm"
            class="self-start"
            onClick={() => props.translator.onCancel()}
          >
            {m.common.cancel}
          </Button>
        </div>
      )}
    </Show>
  );
}
