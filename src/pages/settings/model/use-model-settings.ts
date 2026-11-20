import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { commandErrorMessage, commands, type Model } from "@/shared/api/commands.ts";
import {
  cancelModelDownload,
  downloadModel,
  modelDownloadsAtom,
} from "@/shared/api/model-downloads.ts";
import { modelsQuery } from "@/shared/api/queries.ts";
import { useMessages } from "@/shared/i18n/messages.ts";
import { toastError } from "@/shared/lib/toast.ts";

/** A downloadable model, on this device or not: downloading, cancelling and deleting it. */
export function useModelSettings(model: Model, { onDeleted }: { onDeleted?: () => void } = {}) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const models = useQuery(modelsQuery());
  const status = models.data?.find((entry) => entry.model === model) ?? null;
  const download = useSelector(modelDownloadsAtom, (downloads) => downloads[model]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const remove = useMutation({
    mutationFn: () => commands.deleteModel(model),
    onSuccess: () => {
      onDeleted?.();
      return queryClient.invalidateQueries({ queryKey: modelsQuery().queryKey });
    },
    onError: (error) => toastError(commandErrorMessage(error, m.models.deleteFailed)),
    onSettled: () => setConfirmingDelete(false),
  });

  return {
    status,
    download,
    /** Resolves to whether the download finished. */
    startDownload: () => downloadModel(queryClient, model),
    cancelDownload: () => void cancelModelDownload(model),
    confirmingDelete,
    askToDelete: () => setConfirmingDelete(true),
    keep: () => setConfirmingDelete(false),
    confirmDelete: () => remove.mutate(),
    deleting: remove.isPending,
  };
}

export type ModelSettings = ReturnType<typeof useModelSettings>;
