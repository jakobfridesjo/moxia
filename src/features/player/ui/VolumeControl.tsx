import { useId } from "react";
import { useSelector } from "@tanstack/react-store";
import { Volume2, VolumeX } from "lucide-react";
import { volumeAtom } from "@/shared/config/preferences.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { cn } from "@/shared/lib/class-names.ts";
import { Slider } from "@/shared/ui/shadcn/slider.tsx";
import { changeVolume } from "@/features/player/model/player-store.ts";

export function VolumeControl({ className }: { className?: string }) {
  const m = useMessages();
  const volume = useSelector(volumeAtom);
  const percent = Math.round(volume * 100);
  const labelId = useId();

  return (
    <div className={cn("flex w-36 shrink-0 items-center gap-2", className)}>
      {volume === 0 ? (
        <VolumeX className="size-4 text-muted-foreground" aria-hidden />
      ) : (
        <Volume2 className="size-4 text-muted-foreground" aria-hidden />
      )}
      <span id={labelId} className="sr-only">
        {m.player.volume}
      </span>
      <Slider
        aria-labelledby={labelId}
        value={[percent]}
        onValueChange={(value: number | readonly number[]) => {
          const next = typeof value === "number" ? value : value[0];
          if (next !== undefined) changeVolume(next / 100);
        }}
      />
    </div>
  );
}
