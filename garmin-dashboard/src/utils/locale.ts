/**
 * utils/locale.ts
 * Maps the app's selected language (LanguagePicker.tsx / i18next — NOT
 * navigator.language/the OS locale, see below) to a date-fns Locale object,
 * for react-day-picker's `locale` prop (ui/Calendar.tsx) — so the calendar
 * popup's month/weekday names AND its week-start day match what the user
 * picked in-app instead of react-day-picker's hardcoded English (enUS)
 * default.
 *
 * Previously this read navigator.language directly, so the popup always
 * showed the OS's locale (e.g. permanently Italian on an it-IT machine) no
 * matter what language was selected in the app — switching the in-app
 * language never re-resolved it, since it was only ever read once at first
 * mount. Now keyed by app Language (types/api.ts) instead, resolved fresh
 * whenever i18next's language changes (see ui/Calendar.tsx).
 */
import type { DayPickerLocale } from "react-day-picker/locale";
import { dateFormatRegion } from "@/utils/dateFormat";

// "en-US" -> "enUS", "it" -> "it", "pt-BR" -> "ptBR" — the exact naming
// date-fns/locale's named exports use: lowercase language, uppercase
// region, no separator (confirmed against the installed package —
// date-fns/locale/en-US.js exports `enUS`, etc).
function toDateFnsKey(tag: string): string {
  return tag.split("-").map((part, i) => (i === 0 ? part.toLowerCase() : part.toUpperCase())).join("");
}

// Root-relative Vite glob (`import.meta.glob`), NOT a static
// `import * as locales from "react-day-picker/locale"` — that barrel
// re-exports date-fns/locale in full, and a plain namespace import of it
// bundles EVERY supported locale unconditionally (+670KB raw / +118KB gzip,
// measured) for a feature that only ever needs the ONE locale the browser
// actually resolves to. The glob's `() => Promise<...>` values are
// lazy/code-split per file — only the single module actually requested at
// runtime is ever fetched.
// Excludes cdn.js/cdn.min.js — date-fns ships those alongside the per-locale
// files (a single ~630KB UMD bundle of every locale combined, for <script>-
// tag consumption), and an unqualified `*.js` glob matches them too even
// though tryLoad() below never requests a key named "cdn"/"cdn.min" — left
// in, Rollup still has to emit them as two dead, never-fetched ~630KB
// output chunks simply because the glob makes them possible dynamic-import
// targets.
const localeModules = import.meta.glob(["/node_modules/date-fns/locale/*.js", "!**/cdn*.js"]) as
  Record<string, () => Promise<Record<string, DayPickerLocale>>>;

async function tryLoad(key: string): Promise<DayPickerLocale | undefined> {
  const loader = localeModules[`/node_modules/date-fns/locale/${key}.js`];
  if (!loader) return undefined;
  const mod = await loader();
  return mod[key];
}

// date-fns doesn't ship every language-region combination (e.g. there's no
// dedicated "it-IT" locale, only the base "it") — try the exact tag first,
// then the base language; undefined (react-day-picker's own enUS default)
// if the resolved tag isn't one date-fns has at all.
async function resolveCalendarLocale(tag: string): Promise<DayPickerLocale | undefined> {
  return (await tryLoad(toDateFnsKey(tag))) ?? (await tryLoad(tag.split("-")[0].toLowerCase()));
}

// date-fns ships no bare "en" locale (only region variants: en-US, en-GB,
// …) — 'en' needs a region to resolve at all, so it borrows the uk/us region
// already chosen via the Settings tab's Date format preference (same
// pinned-region idiom fmt.ts's DATE_FORMATTERS uses). Every other app
// language maps straight to its own date-fns base locale. Takes the app's
// Language (types/api.ts) as a plain string — i18next.language (the actual
// caller, ui/Calendar.tsx) is untyped, and it's already exactly one of
// LANGUAGE_NAMES by construction (detectLanguageFromLocale/changeLanguage).
function toLocaleTag(language: string): string {
  return language === "en" ? (dateFormatRegion() === "us" ? "en-US" : "en-GB") : language;
}

// Cached per app language (LANGUAGE_NAMES has 6 entries) — every DatePicker's
// Calendar instance (there can be several on screen at once, e.g. the
// Overview date-range bar's 4 pickers) shares one resolution/fetch per
// language instead of each triggering its own.
const cache = new Map<string, Promise<DayPickerLocale | undefined>>();
export function loadCalendarLocale(language: string): Promise<DayPickerLocale | undefined> {
  const tag = toLocaleTag(language);
  let entry = cache.get(tag);
  if (!entry) {
    entry = resolveCalendarLocale(tag);
    cache.set(tag, entry);
  }
  return entry;
}
