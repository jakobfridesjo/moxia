import type { DownloadProgress } from "@/shared/api/commands.ts";
import type { ModelDownload } from "@/shared/api/model-downloads.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { formatMegabytes, formatPercent } from "@/shared/lib/number-format.ts";

/** A running download's bar, with how much of it has arrived. */
export function ModelDownloadProgress({
  progress,
  label,
}: {
  progress: DownloadProgress;
  /** Names the download for screen readers. */
  label: string;
}) {
  const m = useMessages();
  const { downloaded, total } = progress;
  const percent = total > 0 ? Math.min((downloaded / total) * 100, 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
        <span>{m.models.downloading(formatMegabytes(downloaded), formatMegabytes(total))}</span>
        <span>{formatPercent(downloaded, total)}</span>
      </div>
    </div>
  );
}

/** Where a download stopped and why, and that trying again resumes it. */
export function ModelDownloadFailure({
  download,
}: {
  download: ModelDownload & { state: "failed" };
}) {
  const m = useMessages();
  return (
    <div
      role="alert"
      className="flex flex-col gap-0.5 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <p>
        {m.models.stopped(formatMegabytes(download.downloaded), formatMegabytes(download.total))}{" "}
        {m.models.resumes}
      </p>
      <p className="text-xs">{download.error}</p>
    </div>
  );
}
