import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { useMessages } from "@/shared/i18n/messages.ts";
import { formatClockTime } from "@/shared/lib/date.ts";
import { formatMegabytes } from "@/shared/lib/number-format.ts";
import { ModelDownloadFailure, ModelDownloadProgress } from "@/shared/ui/ModelDownloadProgress.tsx";
import { Button } from "@/shared/ui/shadcn/button.tsx";
import type { RoomLine, RoomState } from "@/pages/radio/model/room-store.ts";
import {
  isTranslatable,
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
export function RoomChat({ room, onSay, onLeave, onClose }: RoomChatProps) {
  const m = useMessages();
  const t = m.together;
  const [draft, setDraft] = useState("");
  const ids = { title: useId(), message: useId() };
  const list = useRef<HTMLOListElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const lastLine = room.lines.at(-1)?.id;

  useEffect(() => field.current?.focus(), []);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [lastLine]);

  const send = () => {
    if (!draft.trim()) return;
    onSay(draft);
    setDraft("");
    field.current?.focus();
  };

  return (
    <section
      data-control
      role="dialog"
      aria-labelledby={ids.title}
      className="fixed inset-x-0 bottom-0 z-10 flex h-[65svh] flex-col text-ink select-text"
    >
      <div aria-hidden className="h-14 shrink-0 bg-linear-to-b from-paper/0 to-paper/97" />
      <div className="flex min-h-0 flex-1 flex-col bg-paper/97 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <header className="flex items-center gap-2 border-b border-ink/15 pr-2 pb-2 pl-5">
          <h2 id={ids.title} className="flex-1 text-ink-soft">
            {t.listening(room.count)}
          </h2>
          <Button variant="outline" onClick={onLeave} className="h-11 px-3">
            <span aria-hidden lang="zh" className="font-brush text-lg text-seal">
              {t.glyphs.leave}
            </span>
            {t.leave}
          </Button>
          <Button variant="ghost" size="icon-lg" aria-label={t.close} onClick={onClose}>
            <X />
          </Button>
        </header>

        <ol
          ref={list}
          aria-label={t.messages}
          aria-live="polite"
          className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-3.5"
        >
          {room.lines.length === 0 && (
            <li className="text-center text-ink-soft">{t.nothingSaid}</li>
          )}
          {room.lines.map((line) => (
            <li key={line.id}>
              <Line line={line} />
            </li>
          ))}
        </ol>

        <form
          className="mx-3 flex items-center gap-2.5 border-y-2 border-ink/75 py-1.5 pr-1.5 pl-4"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label htmlFor={ids.message} className="sr-only">
            {t.message}
          </label>
          <input
            ref={field}
            id={ids.message}
            value={draft}
            maxLength={500}
            autoComplete="off"
            placeholder={t.write}
            onChange={(event) => setDraft(event.target.value)}
            className="h-11 min-w-0 flex-1 bg-transparent font-brush text-xl outline-none placeholder:text-ink-soft"
          />
          <Seal aria-label={t.send} pressed onClick={send}>
            {t.glyphs.send}
          </Seal>
        </form>
      </div>
    </section>
  );
}

function Line({ line }: { line: RoomLine }) {
  const t = useMessages().together;
  const at = formatClockTime(line.at);
  if (line.kind === "said") return <SaidLine name={line.name ?? t.you} at={at} text={line.text} />;
  const text =
    line.kind === "tuned"
      ? line.name === null
        ? t.youTuned(line.station)
        : t.tuned(line.name, line.station)
      : t[line.kind](line.name);
  return (
    <p className="text-center text-sm text-ink-soft">
      {text} · {at}
    </p>
  );
}

function SaidLine({ name, at, text }: { name: string; at: string; text: string }) {
  const header = (
    <div className="flex items-baseline gap-2 text-sm">
      <strong>{name}</strong>
      <span className="text-ink-soft">{at}</span>
    </div>
  );
  const said = <p className="font-brush text-lg leading-snug break-words">{text}</p>;
  if (!isTranslatable(text))
    return (
      <div>
        {header}
        {said}
      </div>
    );
  return <TranslatableLine header={header} said={said} text={text} />;
}

function TranslatableLine({
  header,
  said,
  text,
}: {
  header: ReactNode;
  said: ReactNode;
  text: string;
}) {
  const t = useMessages().together;
  const translation = useMessageTranslation(text);
  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex-1">{header}</div>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={translation.shown}
          onClick={translation.toggle}
          className="-my-1 h-8 gap-1 px-2 text-ink-soft aria-pressed:text-ink"
        >
          <span aria-hidden lang="zh" className="font-brush text-base text-seal">
            {t.glyphs.translate}
          </span>
          {t.translate}
        </Button>
      </div>
      {said}
      {translation.shown && <Translation {...translation} />}
    </div>
  );
}

function Translation({
  translation,
  loading,
  error,
  missing,
}: ReturnType<typeof useMessageTranslation>) {
  const t = useMessages().together;
  if (missing) return <TranslatorDownload translator={missing} />;
  if (loading) return <p className="mt-1 text-sm text-ink-soft">{t.translating}</p>;
  if (error) return <p className="mt-1 text-sm text-ink-soft">{error}</p>;
  return (
    <p lang="en" className="mt-1 leading-snug break-words text-ink-soft">
      {translation}
    </p>
  );
}

function TranslatorDownload({ translator }: { translator: MissingTranslator }) {
  const m = useMessages();
  const { download } = translator;
  if (download?.state === "downloading")
    return (
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-sm text-ink-soft">{m.together.translatorDownloading}</p>
        <ModelDownloadProgress progress={download} label={m.translator.modelName} />
        <Button variant="outline" size="sm" className="self-start" onClick={translator.onCancel}>
          {m.common.cancel}
        </Button>
      </div>
    );
  return (
    <div className="mt-2 flex flex-col items-start gap-2">
      {download?.state === "failed" ? (
        <ModelDownloadFailure download={download} />
      ) : (
        <p className="text-sm text-ink-soft">
          {m.together.translatorMissing(formatMegabytes(translator.bytes))}
        </p>
      )}
      <Button variant="outline" size="sm" onClick={translator.onDownload}>
        {download ? m.common.tryAgain : m.models.download}
      </Button>
    </div>
  );
}
