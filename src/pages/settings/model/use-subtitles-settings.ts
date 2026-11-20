import { useSelector } from "@tanstack/react-store";
import { subtitleScriptAtom, subtitlesAtom } from "@/shared/config/preferences.ts";
import {
  forgetSubtitles,
  setSubtitleScript,
  setSubtitles,
  subtitlesStatusAtom,
} from "@/features/player/model/subtitles.ts";
import { useModelSettings } from "@/pages/settings/model/use-model-settings.ts";

/** The speech models subtitles need, on this device or not, and subtitles on or off. */
export function useSubtitlesSettings() {
  const models = useModelSettings("subtitles", { onDeleted: forgetSubtitles });
  const on = useSelector(subtitlesAtom);
  const script = useSelector(subtitleScriptAtom);
  const status = useSelector(subtitlesStatusAtom);

  return {
    models: {
      ...models,
      /** Downloads the models, and turns subtitles on once they are here. */
      startDownload: async () => {
        const finished = await models.startDownload();
        if (finished) await setSubtitles(true);
        return finished;
      },
    },
    downloaded: models.status?.downloaded ?? false,
    on,
    loading: status === "loading",
    setOn: (wanted: boolean) => void setSubtitles(wanted),
    script,
    setScript: setSubtitleScript,
  };
}
