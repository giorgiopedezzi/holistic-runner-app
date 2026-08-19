/**
 * i18n.ts
 * i18next singleton — proof-of-concept plumbing for HRA-104 (Phase 1 of
 * HRA-103). Initialized synchronously with a default language (browser-
 * detected, or 'en') before useSettings() resolves the persisted value —
 * useAppearance.ts calls changeLanguage() once it does, tolerating the same
 * brief "resolving" flash Theme/Units/Date-format already do.
 *
 * Uses i18next-resources-to-backend, NOT i18next-http-backend — the loader
 * below calls api.locales.get(lang) (api/client.ts), so translation fetches
 * go through the app's one centralized, error-handled HTTP layer instead of
 * a second parallel fetch mechanism.
 */
import i18next, { type CallbackError } from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { api } from "@/api/client";
import type { Language } from "@/types/api";

// There is no direct browser API for "the user's app language" — same
// locale-region heuristic idiom as utils/units.ts's detectUnitSystemFromLocale
// and utils/locale.ts's calendar-locale resolution. Only 'en'/'it' are
// supported (garmin-stats/locales/), so anything else falls back to 'en'.
export function detectLanguageFromLocale(): Language {
  try {
    return navigator.language.slice(0, 2).toLowerCase() === "it" ? "it" : "en";
  } catch {
    return "en";
  }
}

void i18next
  .use(
    resourcesToBackend((language: string, _namespace: string, callback: (err: CallbackError, resources?: Record<string, string>) => void) => {
      api.locales.get(language)
        .then(resources => callback(null, resources))
        .catch((err: unknown) => callback(err instanceof Error ? err : String(err), undefined));
    }),
  )
  .use(initReactI18next)
  .init({
    lng: detectLanguageFromLocale(),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    // No Suspense boundary — a missing/not-yet-loaded key falls back to
    // t()'s own defaultValue argument at each call site instead.
    react: { useSuspense: false },
  });

export default i18next;
