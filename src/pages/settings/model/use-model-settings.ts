import { createSignal } from "solid-js";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { commandErrorMessage, commands, type Model } from "@/shared/api/commands.ts";
import {
  cancelModelDownload,
  downloadModel,
  modelDownloadsAtom,
} from "@/shared/api/model-downloads.ts";
import { modelsQuery, useCommandQuery } from "@/shared/api/queries.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { toastError } from "@/shared/lib/toast.ts";

/** A downloadable model, on this device or not: downloading, cancelling and deleting it. */
export function useModelSettings(model: Model, { onDeleted }: { onDeleted?: () => void } = {}) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const models = useCommandQuery(modelsQuery);
  const download = () => modelDownloadsAtom()[model];
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);

  const remove = useMutation(() => ({
    mutationFn: () => commands.deleteModel(model),
    onSuccess: () => {
      onDeleted?.();
      return queryClient.invalidateQueries({ queryKey: modelsQuery().queryKey });
    },
    onError: (error: unknown) => toastError(commandErrorMessage(error, m.models.deleteFailed)),
    onSettled: () => setConfirmingDelete(false),
  }));

  return {
    get status() {
      return models.data?.find((entry) => entry.model === model) ?? null;
    },
    get download() {
      return download();
    },
    /** Resolves to whether the download finished. */
    startDownload: () => downloadModel(queryClient, model),
    cancelDownload: () => void cancelModelDownload(model),
    get confirmingDelete() {
      return confirmingDelete();
    },
    askToDelete: () => setConfirmingDelete(true),
    keep: () => setConfirmingDelete(false),
    confirmDelete: () => void remove.mutate(),
    get deleting() {
      return remove.isPending;
    },
  };
}

export type ModelSettings = ReturnType<typeof useModelSettings>;
