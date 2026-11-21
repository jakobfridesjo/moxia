import type { QueryClient } from "@tanstack/solid-query";
import { createAtom } from "@/shared/lib/atom.ts";
import {
  commandErrorMessage,
  commands,
  type DownloadProgress,
  type Model,
} from "@/shared/api/commands.ts";
import { modelsQuery } from "@/shared/api/queries.ts";
import { currentMessages } from "@/shared/i18n/messages.ts";

export type ModelDownload =
  | ({ state: "downloading" } & DownloadProgress)
  | ({ state: "failed"; error: string } & DownloadProgress);

/**
 * Each model's running download, or the one an error stopped; absent once it finishes or is
 * cancelled. Kept outside the components, so a download carries on while the person goes back to the radio.
 */
export const modelDownloadsAtom = createAtom<Partial<Record<Model, ModelDownload>>>({});

export function resetModelDownloads() {
  modelDownloadsAtom.set({});
}

/** Downloads what `model` still lacks; resolves to whether it finished. */
export async function downloadModel(queryClient: QueryClient, model: Model) {
  if (modelDownloadsAtom.get()[model]?.state === "downloading") return false;
  const statuses = queryClient.getQueryData(modelsQuery().queryKey);
  const total = statuses?.find((entry) => entry.model === model)?.bytes ?? 0;
  const show = (progress: DownloadProgress) =>
    setDownload(model, { state: "downloading", ...progress });
  show({ downloaded: modelDownloadsAtom.get()[model]?.downloaded ?? 0, total });
  try {
    const finished = await commands.downloadModel(model, show);
    setDownload(model, undefined);
    await queryClient.invalidateQueries({ queryKey: modelsQuery().queryKey });
    return finished;
  } catch (error) {
    const progress = modelDownloadsAtom.get()[model] ?? { downloaded: 0, total };
    setDownload(model, {
      state: "failed",
      downloaded: progress.downloaded,
      total: progress.total,
      error: commandErrorMessage(error, currentMessages().models.downloadFailed),
    });
    return false;
  }
}

/** The download stops at its next chunk; what arrived stays for next time. */
export function cancelModelDownload(model: Model) {
  return commands.cancelModelDownload(model);
}

function setDownload(model: Model, download: ModelDownload | undefined) {
  modelDownloadsAtom.set((all) => {
    const next = { ...all };
    if (download) next[model] = download;
    else delete next[model];
    return next;
  });
}
