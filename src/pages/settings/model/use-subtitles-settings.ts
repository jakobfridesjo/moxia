import {
  subtitleReadingAtom,
  subtitleScriptAtom,
  subtitlesAtom,
} from "@/shared/config/preferences.ts";
import {
  forgetSubtitles,
  setSubtitleReading,
  setSubtitleScript,
  setSubtitles,
  subtitlesStatusAtom,
} from "@/features/player/model/subtitles.ts";
import { useModelSettings, type ModelSettings } from "@/pages/settings/model/use-model-settings.ts";

/** The speech models subtitles need, on this device or not, and subtitles on or off. */
export function useSubtitlesSettings() {
  const models = useModelSettings("subtitles", { onDeleted: forgetSubtitles });

  /** Downloads the models, and turns subtitles on once they are here. */
  const startDownload = async () => {
    const finished = await models.startDownload();
    if (finished) await setSubtitles(true);
    return finished;
  };

  return {
    models: Object.create(models, { startDownload: { value: startDownload } }) as ModelSettings,
    get downloaded() {
      return models.status?.downloaded ?? false;
    },
    get on() {
      return subtitlesAtom();
    },
    get loading() {
      return subtitlesStatusAtom() === "loading";
    },
    setOn: (wanted: boolean) => void setSubtitles(wanted),
    get script() {
      return subtitleScriptAtom();
    },
    setScript: setSubtitleScript,
    get reading() {
      return subtitleReadingAtom();
    },
    setReading: setSubtitleReading,
  };
}
