import { useNavigate } from "@tanstack/solid-router";
import {
  environmentAtom,
  keySoundsAtom,
  languageAtom,
  shadersAtom,
  themeAtom,
  type Language,
  type Theme,
} from "@/shared/config/preferences.ts";

/** The preferences apply as they change: no form, nothing to save. */
export function useSettingsManager() {
  const navigate = useNavigate();
  return {
    backToRadio: () => void navigate({ to: "/" }),
    get language() {
      return languageAtom();
    },
    setLanguage: (next: Language) => languageAtom.set(next),
    get theme() {
      return themeAtom();
    },
    setTheme: (next: Theme) => themeAtom.set(next),
    get keySounds() {
      return keySoundsAtom();
    },
    setKeySounds: (on: boolean) => keySoundsAtom.set(on),
    get environment() {
      return environmentAtom();
    },
    setEnvironment: (on: boolean) => environmentAtom.set(on),
    get shaders() {
      return shadersAtom();
    },
    setShaders: (on: boolean) => shadersAtom.set(on),
  };
}
