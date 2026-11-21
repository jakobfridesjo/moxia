import { Show } from "solid-js";
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
import { useSubtitlesSettings } from "@/pages/settings/model/use-subtitles-settings.ts";
import { Choices } from "@/pages/settings/ui/Choices.tsx";
import { ModelSection } from "@/pages/settings/ui/ModelSection.tsx";

const OPTIONS = ["on", "off"] as const;

/** Subtitles on or off, and the speech models they need: downloading, progress, deleting. */
export function SubtitlesCard() {
  const m = useMessages();
  const subtitles = useSubtitlesSettings();

  return (
    <Card class="w-full max-w-2xl shrink-0">
      <CardHeader>
        <CardTitle>{m.subtitles.title}</CardTitle>
        <CardDescription>{m.subtitles.description}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <Choices
          label={m.subtitles.title}
          options={OPTIONS}
          disabled={!subtitles.downloaded}
          value={subtitles.on && subtitles.downloaded ? "on" : "off"}
          onChange={(option) => subtitles.setOn(option === "on")}
          render={(option) => m.subtitles.options[option]}
        />
        <Choices
          label={m.subtitles.script}
          options={SCRIPTS}
          value={subtitles.script}
          onChange={subtitles.setScript}
          render={(script) => (
            <span lang={SCRIPT_NAMES[script].lang}>{SCRIPT_NAMES[script].name}</span>
          )}
        />
        <Choices
          label={m.subtitles.reading}
          options={READINGS}
          value={subtitles.reading}
          onChange={subtitles.setReading}
          render={(reading) => m.subtitles.readings[reading]}
        />
        <Show when={subtitles.loading}>
          <p role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner decorative />
            {m.subtitles.loading}
          </p>
        </Show>

        <ModelSection
          name={m.subtitles.modelName}
          sources={m.subtitles.sources}
          uses={m.subtitles.uses}
          settings={subtitles.models}
        />
        <Show when={subtitles.models.status && !subtitles.downloaded}>
          <p class="text-sm text-muted-foreground">{m.subtitles.needsDownload}</p>
        </Show>
      </CardContent>
    </Card>
  );
}
