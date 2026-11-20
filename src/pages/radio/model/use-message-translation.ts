import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { commandErrorMessage } from "@/shared/api/commands.ts";
import {
  cancelModelDownload,
  downloadModel,
  modelDownloadsAtom,
} from "@/shared/api/model-downloads.ts";
import { modelsQuery, translationQuery } from "@/shared/api/queries.ts";
import { useMessages } from "@/shared/i18n/messages.ts";

const CHINESE = /\p{Script=Han}/u;

/** Whether `text` has anything the translator, which reads only Chinese, could translate. */
export function isTranslatable(text: string) {
  return CHINESE.test(text);
}

/**
 * One chat message's English, asked for by pressing it. While the translator is not on the
 * device, offers to download it, and translates once it is here.
 */
export function useMessageTranslation(text: string) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState(false);
  const models = useQuery({ ...modelsQuery(), enabled: shown });
  const status = models.data?.find((entry) => entry.model === "translator");
  // While the list of models is unknown, translating may still work.
  const ready = status?.downloaded ?? true;
  const download = useSelector(modelDownloadsAtom, (downloads) => downloads.translator);
  const translation = useQuery({ ...translationQuery(text), enabled: shown && ready });

  return {
    shown,
    toggle: () => setShown((was) => !was),
    translation: translation.data,
    loading: translation.isFetching,
    error: translation.isError
      ? commandErrorMessage(translation.error, m.together.translateFailed)
      : null,
    missing:
      ready || !status
        ? null
        : {
            bytes: status.bytes,
            download,
            onDownload: () => void downloadModel(queryClient, "translator"),
            onCancel: () => void cancelModelDownload("translator"),
          },
  };
}

export type MissingTranslator = NonNullable<ReturnType<typeof useMessageTranslation>["missing"]>;
