import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import * as z from "zod/mini";
import { createAppRouter } from "@/app/router.tsx";
import { createQueryClient } from "@/shared/api/query-client.ts";
import { languageAtom, type Language } from "@/shared/config/preferences.ts";
import { nightAtom } from "@/shared/lib/night.ts";
import "@/app/styles/globals.css";

const ZOD_LOCALES: Record<Language, () => z.core.$ZodConfig> = {
  en: z.locales.en,
  sv: z.locales.sv,
  "zh-Hans": z.locales.zhCN,
  "zh-Hant": z.locales.zhTW,
};

const applyLanguage = (language: Language) => {
  z.config(ZOD_LOCALES[language]());
  document.documentElement.lang = language;
};
applyLanguage(languageAtom.get());
languageAtom.subscribe(applyLanguage);

const applyNight = (night: boolean) => {
  document.documentElement.classList.toggle("dark", night);
  document.documentElement.style.colorScheme = night ? "dark" : "light";
};
applyNight(nightAtom.get());
nightAtom.subscribe(applyNight);

window.addEventListener("vite:preloadError", () => {
  window.location.reload();
});

const router = createAppRouter({ queryClient: createQueryClient() });

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
