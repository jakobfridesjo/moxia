import { Check, Download } from "lucide-react";
import { useMessages } from "@/shared/i18n/messages.ts";
import { formatMegabytes } from "@/shared/lib/number-format.ts";
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
export function ModelSection({ name, sources, uses, settings }: ModelSectionProps) {
  const m = useMessages();
  const { status, download } = settings;
  if (!status) return null;
  const { downloaded, bytes } = status;

  return (
    <section aria-label={name} className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{name}</span>
          <span className="text-sm text-muted-foreground">
            {sources} · {formatMegabytes(bytes)}
          </span>
          {downloaded ? (
            <span className="mt-1 flex items-center gap-1 text-sm">
              <Check className="size-3.5" aria-hidden />
              {m.models.downloaded}
            </span>
          ) : (
            !download && <span className="mt-1 text-sm text-muted-foreground">{uses}</span>
          )}
        </div>
        {downloaded ? (
          settings.confirmingDelete ? (
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={settings.keep}>
                {m.common.cancel}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={settings.deleting}
                onClick={settings.confirmDelete}
              >
                {m.models.confirmDelete(formatMegabytes(bytes))}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={settings.askToDelete}>
              {m.common.delete}
            </Button>
          )
        ) : download?.state === "downloading" ? (
          <Button type="button" variant="outline" size="sm" onClick={settings.cancelDownload}>
            {m.common.cancel}
          </Button>
        ) : download?.state === "failed" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void settings.startDownload()}
          >
            {m.common.tryAgain}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => void settings.startDownload()}>
            <Download data-icon="inline-start" />
            {m.models.download}
          </Button>
        )}
      </div>
      {!downloaded && download?.state === "downloading" && (
        <ModelDownloadProgress progress={download} label={name} />
      )}
      {!downloaded && download?.state === "failed" && <ModelDownloadFailure download={download} />}
    </section>
  );
}
