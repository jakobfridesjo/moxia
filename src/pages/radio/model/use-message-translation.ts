import { createSignal } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { commandErrorMessage } from "@/shared/api/commands.ts";
import {
  cancelModelDownload,
  downloadModel,
  modelDownloadsAtom,
  type ModelDownload,
} from "@/shared/api/model-downloads.ts";
import { modelsQuery, translationQuery, useCommandQuery } from "@/shared/api/queries.ts";
import { useMessages } from "@/shared/i18n/messages.ts";

const CHINESE = /\p{Script=Han}/u;

/** Whether `text` has anything the translator, which reads only Chinese, could translate. */
export function isTranslatable(text: string) {
  return CHINESE.test(text);
}

/** The translator is not on this device: its size, its download if one runs, and how to get it. */
export interface MissingTranslator {
  bytes: number;
  download: ModelDownload | undefined;
  onDownload: () => void;
  onCancel: () => void;
}

/**
 * One chat message's English, asked for by pressing it. While the translator is not on the
 * device, offers to download it, and translates once it is here.
 */
export function useMessageTranslation(text: string) {
  const m = useMessages();
  const queryClient = useQueryClient();
  const [shown, setShown] = createSignal(false);
  const models = useCommandQuery(() => ({ ...modelsQuery(), enabled: shown() }));
  const status = () => models.data?.find((entry) => entry.model === "translator");
  // While the list of models is unknown, translating may still work.
  const ready = () => status()?.downloaded ?? true;
  const download = () => modelDownloadsAtom().translator;
  const translation = useCommandQuery(() => ({
    ...translationQuery(text),
    enabled: shown() && ready(),
  }));

  return {
    get shown() {
      return shown();
    },
    toggle: () => setShown((was) => !was),
    get translation() {
      return translation.data;
    },
    get loading() {
      return translation.isFetching;
    },
    get error() {
      return translation.isError
        ? commandErrorMessage(translation.error, m.together.translateFailed)
        : null;
    },
    get missing(): MissingTranslator | null {
      const translator = status();
      if (ready() || !translator) return null;
      return {
        bytes: translator.bytes,
        download: download(),
        onDownload: () => void downloadModel(queryClient, "translator"),
        onCancel: () => void cancelModelDownload("translator"),
      };
    },
  };
}

export type MessageTranslation = ReturnType<typeof useMessageTranslation>;
