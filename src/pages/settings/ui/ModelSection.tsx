import { Match, Show, Switch } from "solid-js";
import { Check, Download } from "lucide";
import { useMessages } from "@/shared/i18n/messages.ts";
import { formatMegabytes } from "@/shared/lib/number-format.ts";
import { Icon } from "@/shared/ui/Icon.tsx";
import { ModelDownloadFailure, ModelDownloadProgress } from "@/shared/ui/ModelDownloadProgress.tsx";
import { Button } from "@/shared/ui/shadcn/button.tsx";
import type { ModelSettings } from "@/pages/settings/model/use-model-settings.ts";

interface ModelSectionProps {
  name: string;
  /** The models it is made of. */
  sources: string;
  /** What it is needed for, shown until it is downloaded. */
  uses: string;
  settings: ModelSettings;
}

/** A downloadable model's size and state, with downloading, cancelling and deleting it. */
export function ModelSection(props: ModelSectionProps) {
  const m = useMessages();
  const downloading = () => {
    const download = props.settings.download;
    return download?.state === "downloading" ? download : undefined;
  };
  const failed = () => {
    const download = props.settings.download;
    return download?.state === "failed" ? download : undefined;
  };

  return (
    <Show when={props.settings.status}>
      {(status) => (
        <section aria-label={props.name} class="flex flex-col gap-3 rounded-lg border p-3">
          <div class="flex items-start gap-3">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="font-medium">{props.name}</span>
              <span class="text-sm text-muted-foreground">
                {props.sources} · {formatMegabytes(status().bytes)}
              </span>
              <Show
                when={status().downloaded}
                fallback={
                  <Show when={!props.settings.download}>
                    <span class="mt-1 text-sm text-muted-foreground">{props.uses}</span>
                  </Show>
                }
              >
                <span class="mt-1 flex items-center gap-1 text-sm">
                  <Icon icon={Check} class="size-3.5" />
                  {m.models.downloaded}
                </span>
              </Show>
            </div>
            <Switch
              fallback={
                <Button size="sm" onClick={() => void props.settings.startDownload()}>
                  <span data-icon="inline-start" class="contents">
                    <Icon icon={Download} />
                  </span>
                  {m.models.download}
                </Button>
              }
            >
              <Match when={status().downloaded && props.settings.confirmingDelete}>
                <div class="flex gap-2">
                  <Button variant="outline" size="sm" onClick={props.settings.keep}>
                    {m.common.cancel}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={props.settings.deleting}
                    onClick={props.settings.confirmDelete}
                  >
                    {m.models.confirmDelete(formatMegabytes(status().bytes))}
                  </Button>
                </div>
              </Match>
              <Match when={status().downloaded}>
                <Button variant="outline" size="sm" onClick={props.settings.askToDelete}>
                  {m.common.delete}
                </Button>
              </Match>
              <Match when={downloading()}>
                <Button variant="outline" size="sm" onClick={props.settings.cancelDownload}>
                  {m.common.cancel}
                </Button>
              </Match>
              <Match when={failed()}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void props.settings.startDownload()}
                >
                  {m.common.tryAgain}
                </Button>
              </Match>
            </Switch>
          </div>
          <Show when={!status().downloaded && downloading()}>
            {(download) => <ModelDownloadProgress progress={download()} label={props.name} />}
          </Show>
          <Show when={!status().downloaded && failed()}>
            {(download) => <ModelDownloadFailure download={download()} />}
          </Show>
        </section>
      )}
    </Show>
  );
}
