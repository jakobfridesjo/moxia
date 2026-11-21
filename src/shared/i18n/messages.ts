import type { Script } from "@/shared/api/commands.ts";
import { languageAtom, type Language } from "@/shared/config/preferences.ts";
import { en, type Messages } from "@/shared/i18n/messages-en.ts";
import { sv } from "@/shared/i18n/messages-sv.ts";
import { zhHans } from "@/shared/i18n/messages-zh-hans.ts";
import { zhHant } from "@/shared/i18n/messages-zh-hant.ts";

const MESSAGES: Record<Language, Messages> = { en, sv, "zh-Hans": zhHans, "zh-Hant": zhHant };

/** Each language's name in itself, so it can be found whatever the UI shows. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  sv: "Svenska",
  "zh-Hans": "中文（简体）",
  "zh-Hant": "中文（繁體）",
};

/** Each script's name in itself. */
export const SCRIPT_NAMES: Record<Script, { name: string; lang: string }> = {
  simplified: { name: "简体", lang: "zh-Hans" },
  taiwan: { name: "繁體（臺灣）", lang: "zh-Hant-TW" },
  hongKong: { name: "繁體（香港）", lang: "zh-Hant-HK" },
};

const followingLanguage = Object.defineProperties(
  {},
  Object.fromEntries(
    Object.keys(en).map((section) => [
      section,
      { enumerable: true, get: () => MESSAGES[languageAtom()][section as keyof Messages] },
    ])
  )
) as Messages;

/**
 * The UI text in the chosen language. Each section is read through the language signal, so
 * `m.common.back` in JSX follows a change of language; never destructure it.
 */
export function useMessages(): Messages {
  return followingLanguage;
}

/** The UI text in the chosen language, for code outside a component (schema errors, the player store). */
export function currentMessages(): Messages {
  return MESSAGES[languageAtom.get()];
}
