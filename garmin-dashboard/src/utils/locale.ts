/**
 * utils/locale.ts
 * Maps the browser's locale (navigator.language — reflects the OS's
 * regional settings, the same source Intl.DateTimeFormat's default locale
 * reads from; see ui/DatePicker.tsx's formatDisplay) to a date-fns Locale
 * object, for react-day-picker's `locale` prop (ui/Calendar.tsx) — so the
 * calendar popup's month/weekday names AND its week-start day match the OS
 * instead of react-day-picker's hardcoded English (enUS) default.
 */
import type { DayPickerLocale } from "react-day-picker/locale";

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
// if the browser's locale isn't one date-fns has at all.
async function resolveCalendarLocale(tag: string): Promise<DayPickerLocale | undefined> {
  return (await tryLoad(toDateFnsKey(tag))) ?? (await tryLoad(tag.split("-")[0].toLowerCase()));
}

// Cached — the browser's locale doesn't change without a page reload, and
// every DatePicker's Calendar instance (there can be several on screen at
// once, e.g. the Overview date-range bar's 4 pickers) shares this one
// resolution/fetch instead of each triggering its own.
let cached: Promise<DayPickerLocale | undefined> | null = null;
export function loadBrowserCalendarLocale(): Promise<DayPickerLocale | undefined> {
  if (!cached) {
    cached = resolveCalendarLocale(typeof navigator !== "undefined" ? navigator.language : "en-US");
  }
  return cached;
}
