import { Show } from "solid-js";
import { Volume2, VolumeX } from "lucide";
import { volumeAtom } from "@/shared/config/preferences.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { cn } from "@/shared/lib/class-names.ts";
import { Icon } from "@/shared/ui/Icon.tsx";
import { Slider } from "@/shared/ui/shadcn/slider.tsx";
import { changeVolume } from "@/features/player/model/player-store.ts";

export function VolumeControl(props: { class?: string }) {
  const m = useMessages();

  return (
    <div class={cn("flex w-36 shrink-0 items-center gap-2", props.class)}>
      <Show
        when={volumeAtom() === 0}
        fallback={<Icon icon={Volume2} class="size-4 text-muted-foreground" />}
      >
        <Icon icon={VolumeX} class="size-4 text-muted-foreground" />
      </Show>
      <Slider
        label={m.player.volume}
        value={Math.round(volumeAtom() * 100)}
        onChange={(percent) => changeVolume(percent / 100)}
      />
    </div>
  );
}
