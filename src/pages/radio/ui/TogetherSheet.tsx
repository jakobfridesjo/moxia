import { createSignal, createUniqueId, For, Show } from "solid-js";
import { ScanQrCode, X } from "lucide";
import { camera, canScan } from "@/shared/api/commands.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { ariaBoolean } from "@/shared/lib/aria.ts";
import { Icon } from "@/shared/ui/Icon.tsx";
import { Button } from "@/shared/ui/shadcn/button.tsx";
import { Input } from "@/shared/ui/shadcn/input.tsx";
import type { RoomState } from "@/pages/radio/model/room-store.ts";
import { InviteQr } from "@/pages/radio/ui/InviteQr.tsx";
import { ScanFrame } from "@/pages/radio/ui/ScanFrame.tsx";

interface TogetherSheetProps {
  room: RoomState;
  name: string;
  onName: (name: string) => void;
  onOpen: () => void;
  onJoin: (invite: string) => void;
  onLeave: () => void;
  onClose: () => void;
}

const TABS = ["invite", "join"] as const;

/** A hanging scroll over the painting: open a room and invite to it, or join one. */
export function TogetherSheet(props: TogetherSheetProps) {
  const m = useMessages();
  const [tab, setTab] = createSignal<(typeof TABS)[number]>("invite");
  const [pasted, setPasted] = createSignal("");
  const [scanning, setScanning] = createSignal(false);
  const [scanError, setScanError] = createSignal<string | null>(null);
  const ids = {
    title: createUniqueId(),
    name: createUniqueId(),
    invite: createUniqueId(),
    paste: createUniqueId(),
  };
  const busy = () => props.room.status === "opening" || props.room.status === "joining";
  const named = () => props.name.trim().length > 0;
  // A scanned invite is joined at once when there is a name to join under; else it waits pasted.
  const scanInvite = async () => {
    setScanError(null);
    setScanning(true);
    try {
      const scanned = await camera.scanQrCode();
      if (scanned === null) {
        setScanError(m.together.cameraRefused);
        return;
      }
      setPasted(scanned);
      if (named()) props.onJoin(scanned);
    } catch (error) {
      if (error !== "cancelled") setScanError(m.together.scanFailed);
    } finally {
      setScanning(false);
    }
  };
  const cancelScan = () => void camera.cancelScan().catch(() => undefined);

  return (
    <section
      data-control
      role="dialog"
      aria-modal="true"
      aria-labelledby={ids.title}
      class="fixed inset-0 z-10 flex items-center justify-center bg-paper/80 px-[max(1.5rem,env(safe-area-inset-left))] py-[max(2rem,env(safe-area-inset-top))] text-ink select-text"
    >
      <div class="flex max-h-full w-full max-w-md flex-col">
        <div aria-hidden="true" class="-mx-2.5 h-3 shrink-0 rounded-full bg-ink/85" />
        <div class="relative flex min-h-0 flex-col gap-5 overflow-y-auto border-x border-ink/10 bg-paper px-6 pt-5 pb-6 shadow-lg">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={m.together.close}
            onClick={() => props.onClose()}
            class="absolute top-2 right-2"
          >
            <Icon icon={X} />
          </Button>
          <header class="flex items-baseline gap-3">
            <h2 id={ids.title} lang="zh" class="font-brush text-4xl font-bold tracking-[0.2em]">
              {m.together.heading}
            </h2>
            <span class="text-ink-soft">{m.together.title}</span>
          </header>

          <Show
            when={props.room.status === "in" && props.room.invite}
            fallback={
              <>
                <div class="grid gap-1.5">
                  <label for={ids.name} class="text-sm font-bold">
                    {m.together.name}
                  </label>
                  <Input
                    id={ids.name}
                    value={props.name}
                    maxlength={40}
                    autocomplete="nickname"
                    placeholder={m.together.namePlaceholder}
                    disabled={busy()}
                    onInput={(event) => props.onName(event.currentTarget.value)}
                    class="h-11 text-base"
                  />
                </div>

                <div role="tablist" class="flex gap-1 border-b border-ink/15">
                  <For each={TABS}>
                    {(each) => (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={ariaBoolean(tab() === each)}
                        disabled={busy()}
                        onClick={() => setTab(each)}
                        class={[
                          "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 outline-none focus-visible:ring-2 focus-visible:ring-ink",
                          tab() === each ? "border-seal font-bold" : "border-transparent",
                        ]}
                      >
                        <span
                          aria-hidden="true"
                          lang="zh"
                          class={[
                            "font-brush text-xl",
                            tab() === each ? "text-seal" : "text-ink-soft",
                          ]}
                        >
                          {m.together.glyphs[each]}
                        </span>
                        {m.together[each]}
                      </button>
                    )}
                  </For>
                </div>

                <Show
                  when={tab() === "invite"}
                  fallback={
                    <form
                      role="tabpanel"
                      class="grid gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (named() && pasted().trim()) props.onJoin(pasted());
                      }}
                    >
                      <Show when={canScan}>
                        <Button
                          variant="outline"
                          size="lg"
                          disabled={busy() || scanning()}
                          onClick={() => void scanInvite()}
                          class="h-12"
                        >
                          <Icon icon={ScanQrCode} />
                          {m.together.scan}
                        </Button>
                      </Show>
                      <Show when={scanning()}>
                        <ScanFrame onCancel={cancelScan} />
                      </Show>
                      <Show when={scanError()}>
                        <p role="alert" class="text-sm text-seal">
                          {scanError()}
                        </p>
                      </Show>
                      <label for={ids.paste} class="text-sm font-bold">
                        {m.together.paste}
                      </label>
                      <Input
                        id={ids.paste}
                        value={pasted()}
                        autocomplete="off"
                        spellcheck="false"
                        disabled={busy()}
                        onInput={(event) => setPasted(event.currentTarget.value)}
                        class="h-11 font-mono text-sm"
                      />
                      <p class="text-sm text-ink-soft">{m.together.joinHelp}</p>
                      <Button
                        type="submit"
                        size="lg"
                        disabled={!named() || !pasted().trim() || busy()}
                        class="h-12"
                      >
                        {props.room.status === "joining" ? m.together.joining : m.together.join}
                      </Button>
                    </form>
                  }
                >
                  <div role="tabpanel" class="grid gap-3">
                    <Button
                      size="lg"
                      disabled={!named() || busy()}
                      onClick={() => props.onOpen()}
                      class="h-12"
                    >
                      {props.room.status === "opening" ? m.together.opening : m.together.open}
                    </Button>
                  </div>
                </Show>
                <Show when={props.room.error}>
                  <p role="alert" class="text-sm font-bold text-seal">
                    {props.room.error}
                  </p>
                </Show>
              </>
            }
          >
            <InRoom room={props.room} inviteId={ids.invite} onLeave={props.onLeave} />
          </Show>
        </div>
        <div aria-hidden="true" class="-mx-2.5 h-3 shrink-0 rounded-full bg-ink/85" />
      </div>
    </section>
  );
}

function InRoom(props: { room: RoomState; inviteId: string; onLeave: () => void }) {
  const m = useMessages();
  const [copied, setCopied] = createSignal<"copied" | "failed" | null>(null);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied("failed");
      document.getElementById(props.inviteId)?.focus();
    }
  };

  return (
    <Show when={props.room.invite}>
      {(invite) => (
        <div class="flex flex-col items-center gap-4">
          <div class="w-full max-w-56 border border-ink/15 p-2">
            <InviteQr qr={invite().qr} label={m.together.qrLabel} />
          </div>
          <p class="text-center text-sm text-ink-soft">{m.together.inviteHelp}</p>
          <div class="grid w-full gap-1.5">
            <label for={props.inviteId} class="text-sm font-bold">
              {m.together.inviteText}
            </label>
            <Input
              id={props.inviteId}
              readonly
              value={invite().text}
              onFocus={(event) => event.currentTarget.select()}
              class="h-11 font-mono text-xs"
            />
          </div>
          <Button size="lg" onClick={() => void copy(invite().text)} class="h-12 w-full">
            {copied() === "copied" ? m.together.copied : m.together.copy}
          </Button>
          <Show when={copied() === "failed"}>
            <p role="alert" class="text-sm text-seal">
              {m.together.copyFailed}
            </p>
          </Show>
          <p role="status" class="font-bold">
            {props.room.count > 1 ? m.together.listening(props.room.count) : m.together.waiting}
          </p>
          <p class="text-center text-sm text-ink-soft">{m.together.anyoneCanJoin}</p>
          <Button variant="outline" size="lg" onClick={() => props.onLeave()} class="h-12 w-full">
            <span aria-hidden="true" lang="zh" class="font-brush text-lg text-seal">
              {m.together.glyphs.leave}
            </span>
            {m.together.leave}
          </Button>
        </div>
      )}
    </Show>
  );
}
