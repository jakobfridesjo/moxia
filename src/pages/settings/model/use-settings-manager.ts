import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
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
    language: useSelector(languageAtom),
    setLanguage: (language: Language) => languageAtom.set(language),
    theme: useSelector(themeAtom),
    setTheme: (theme: Theme) => themeAtom.set(theme),
    keySounds: useSelector(keySoundsAtom),
    setKeySounds: (on: boolean) => keySoundsAtom.set(on),
    environment: useSelector(environmentAtom),
    setEnvironment: (on: boolean) => environmentAtom.set(on),
    shaders: useSelector(shadersAtom),
    setShaders: (on: boolean) => shadersAtom.set(on),
  };
}
