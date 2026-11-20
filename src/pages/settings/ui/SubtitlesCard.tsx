import { READINGS, SCRIPTS } from "@/shared/api/commands.ts";
import { SCRIPT_NAMES, useMessages } from "@/shared/i18n/messages.ts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/shadcn/card.tsx";
import { Spinner } from "@/shared/ui/shadcn/spinner.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/shadcn/toggle-group.tsx";
import { useSubtitlesSettings } from "@/pages/settings/model/use-subtitles-settings.ts";
import { ModelSection } from "@/pages/settings/ui/ModelSection.tsx";

const OPTIONS = ["on", "off"] as const;

/** Subtitles on or off, and the speech models they need: downloading, progress, deleting. */
export function SubtitlesCard() {
  const m = useMessages();
  const subtitles = useSubtitlesSettings();
  const { downloaded } = subtitles;

  return (
    <Card className="w-full max-w-2xl shrink-0">
      <CardHeader>
        <CardTitle>{m.subtitles.title}</CardTitle>
        <CardDescription>{m.subtitles.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ToggleGroup
          aria-label={m.subtitles.title}
          variant="outline"
          disabled={!downloaded}
          value={[subtitles.on && downloaded ? "on" : "off"]}
          onValueChange={(next) => {
            const chosen = OPTIONS.find((option) => option === next[0]);
            if (chosen) subtitles.setOn(chosen === "on");
          }}
        >
          {OPTIONS.map((option) => (
            <ToggleGroupItem key={option} value={option} className="px-3">
              {m.subtitles.options[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label={m.subtitles.script}
          variant="outline"
          value={[subtitles.script]}
          onValueChange={(next) => {
            const chosen = SCRIPTS.find((script) => script === next[0]);
            if (chosen) subtitles.setScript(chosen);
          }}
        >
          {SCRIPTS.map((script) => (
            <ToggleGroupItem key={script} value={script} className="px-3">
              <span lang={SCRIPT_NAMES[script].lang}>{SCRIPT_NAMES[script].name}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label={m.subtitles.reading}
          variant="outline"
          value={[subtitles.reading]}
          onValueChange={(next) => {
            const chosen = READINGS.find((reading) => reading === next[0]);
            if (chosen) subtitles.setReading(chosen);
          }}
        >
          {READINGS.map((reading) => (
            <ToggleGroupItem key={reading} value={reading} className="px-3">
              {m.subtitles.readings[reading]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {subtitles.loading && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden />
            {m.subtitles.loading}
          </p>
        )}

        <ModelSection
          name={m.subtitles.modelName}
          sources={m.subtitles.sources}
          uses={m.subtitles.uses}
          settings={subtitles.models}
        />
        {subtitles.models.status && !downloaded && (
          <p className="text-sm text-muted-foreground">{m.subtitles.needsDownload}</p>
        )}
      </CardContent>
    </Card>
  );
}
