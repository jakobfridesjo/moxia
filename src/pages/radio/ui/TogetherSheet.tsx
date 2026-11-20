import { useId, useState } from "react";
import { X } from "lucide-react";
import { useMessages } from "@/shared/i18n/messages.ts";
import { cn } from "@/shared/lib/class-names.ts";
import { Button } from "@/shared/ui/shadcn/button.tsx";
import { Input } from "@/shared/ui/shadcn/input.tsx";
import type { RoomState } from "@/pages/radio/model/room-store.ts";
import { InviteQr } from "@/pages/radio/ui/InviteQr.tsx";

interface TogetherSheetProps {
  room: RoomState;
  name: string;
  onName: (name: string) => void;
  onOpen: () => void;
  onJoin: (invite: string) => void;
  onLeave: () => void;
  onClose: () => void;
}

/** A hanging scroll over the painting: open a room and invite to it, or join one. */
export function TogetherSheet({
  room,
  name,
  onName,
  onOpen,
  onJoin,
  onLeave,
  onClose,
}: TogetherSheetProps) {
  const m = useMessages();
  const t = m.together;
  const [tab, setTab] = useState<"invite" | "join">("invite");
  const [pasted, setPasted] = useState("");
  const ids = { title: useId(), name: useId(), invite: useId(), paste: useId() };
  const busy = room.status === "opening" || room.status === "joining";
  const named = name.trim().length > 0;

  return (
    <section
      data-control
      role="dialog"
      aria-modal
      aria-labelledby={ids.title}
      className="fixed inset-0 z-10 flex items-center justify-center bg-paper/80 px-[max(1.5rem,env(safe-area-inset-left))] py-[max(2rem,env(safe-area-inset-top))] text-ink select-text"
    >
      <div className="flex max-h-full w-full max-w-md flex-col">
        <div aria-hidden className="-mx-2.5 h-3 shrink-0 rounded-full bg-ink/85" />
        <div className="relative flex min-h-0 flex-col gap-5 overflow-y-auto border-x border-ink/10 bg-paper px-6 pt-5 pb-6 shadow-lg">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t.close}
            onClick={onClose}
            className="absolute top-2 right-2"
          >
            <X />
          </Button>
          <header className="flex items-baseline gap-3">
            <h2 id={ids.title} lang="zh" className="font-brush text-4xl font-bold tracking-[0.2em]">
              {t.heading}
            </h2>
            <span className="text-ink-soft">{t.title}</span>
          </header>

          {room.status === "in" && room.invite ? (
            <InRoom room={room} inviteId={ids.invite} onLeave={onLeave} />
          ) : (
            <>
              <div className="grid gap-1.5">
                <label htmlFor={ids.name} className="text-sm font-bold">
                  {t.name}
                </label>
                <Input
                  id={ids.name}
                  value={name}
                  maxLength={40}
                  autoComplete="nickname"
                  placeholder={t.namePlaceholder}
                  disabled={busy}
                  onChange={(event) => onName(event.target.value)}
                  className="h-11 text-base"
                />
              </div>

              <div role="tablist" className="flex gap-1 border-b border-ink/15">
                {(["invite", "join"] as const).map((each) => (
                  <button
                    key={each}
                    type="button"
                    role="tab"
                    aria-selected={tab === each}
                    disabled={busy}
                    onClick={() => setTab(each)}
                    className={cn(
                      "-mb-px flex min-h-11 items-center gap-2 border-b-2 border-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ink",
                      tab === each && "border-seal font-bold"
                    )}
                  >
                    <span
                      aria-hidden
                      lang="zh"
                      className={cn(
                        "font-brush text-xl",
                        tab === each ? "text-seal" : "text-ink-soft"
                      )}
                    >
                      {t.glyphs[each]}
                    </span>
                    {t[each]}
                  </button>
                ))}
              </div>

              {tab === "invite" ? (
                <div role="tabpanel" className="grid gap-3">
                  <Button size="lg" disabled={!named || busy} onClick={onOpen} className="h-12">
                    {room.status === "opening" ? t.opening : t.open}
                  </Button>
                </div>
              ) : (
                <form
                  role="tabpanel"
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (named && pasted.trim()) onJoin(pasted);
                  }}
                >
                  <label htmlFor={ids.paste} className="text-sm font-bold">
                    {t.paste}
                  </label>
                  <Input
                    id={ids.paste}
                    value={pasted}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    onChange={(event) => setPasted(event.target.value)}
                    className="h-11 font-mono text-sm"
                  />
                  <p className="text-sm text-ink-soft">{t.joinHelp}</p>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={!named || !pasted.trim() || busy}
                    className="h-12"
                  >
                    {room.status === "joining" ? t.joining : t.join}
                  </Button>
                </form>
              )}
              {room.error && (
                <p role="alert" className="text-sm font-bold text-seal">
                  {room.error}
                </p>
              )}
            </>
          )}
        </div>
        <div aria-hidden className="-mx-2.5 h-3 shrink-0 rounded-full bg-ink/85" />
      </div>
    </section>
  );
}

function InRoom({
  room,
  inviteId,
  onLeave,
}: {
  room: RoomState;
  inviteId: string;
  onLeave: () => void;
}) {
  const t = useMessages().together;
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const invite = room.invite;
  if (!invite) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.text);
      setCopied("copied");
    } catch {
      setCopied("failed");
      document.getElementById(inviteId)?.focus();
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full max-w-56 border border-ink/15 p-2">
        <InviteQr qr={invite.qr} label={t.qrLabel} />
      </div>
      <p className="text-center text-sm text-ink-soft">{t.inviteHelp}</p>
      <div className="grid w-full gap-1.5">
        <label htmlFor={inviteId} className="text-sm font-bold">
          {t.inviteText}
        </label>
        <Input
          id={inviteId}
          readOnly
          value={invite.text}
          onFocus={(event) => event.target.select()}
          className="h-11 font-mono text-xs"
        />
      </div>
      <Button size="lg" onClick={() => void copy()} className="h-12 w-full">
        {copied === "copied" ? t.copied : t.copy}
      </Button>
      {copied === "failed" && (
        <p role="alert" className="text-sm text-seal">
          {t.copyFailed}
        </p>
      )}
      <p role="status" className="font-bold">
        {room.count > 1 ? t.listening(room.count) : t.waiting}
      </p>
      <p className="text-center text-sm text-ink-soft">{t.anyoneCanJoin}</p>
      <Button variant="outline" size="lg" onClick={onLeave} className="h-12 w-full">
        <span aria-hidden lang="zh" className="font-brush text-lg text-seal">
          {t.glyphs.leave}
        </span>
        {t.leave}
      </Button>
    </div>
  );
}
