import { getUnitSystem, kmToMi, mToFt, kgToLb, paceKmToMi, kmhToMph } from "./units";
import { getDateFormatSystem, dateFormatRegion } from "./dateFormat";
import i18next from "@/i18n";
import type { DateFormat } from "@/types/api";

// Pace is passed in as minutes-per-km (this app's internal/backend unit,
// regardless of display system) and converted to minutes-per-mile here when
// imperial is selected — callers append their own unit suffix via
// paceUnitLabel() (utils/units.ts), fmtPace never does (kept from before the
// unit toggle existed, to avoid touching every call site's signature).
export function fmtPace(minKm: number | null | undefined): string {
  if (!minKm || minKm > 30) return "—";
  const val = getUnitSystem() === "imperial" ? paceKmToMi(minKm) : minKm;
  const m = Math.floor(val);
  const s = Math.round((val - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  // Round the total first, then derive h/m/s from the rounded integer —
  // rounding each part separately can carry a 59.6s remainder up to "60"
  // instead of rolling over into the next minute.
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function fmtKm(meters: number | null | undefined): string {
  if (!meters) return "—";
  if (getUnitSystem() === "imperial") {
    const miles = kmToMi(meters / 1000);
    return miles >= 0.1
      ? `${miles.toFixed(2)} mi`
      : `${Math.round(mToFt(meters))} ft`;
  }
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`;
}

export function fmtWeight(kg: number | null | undefined): string {
  if (kg == null) return "—";
  return getUnitSystem() === "imperial" ? `${kgToLb(kg).toFixed(1)} lb` : `${kg.toFixed(1)} kg`;
}

// Elevation (ascent/descent/altitude) — always whole-number, no decimals,
// same convention this app already used for meters before the unit toggle.
export function fmtElevation(meters: number | null | undefined): string {
  if (meters == null) return "—";
  return getUnitSystem() === "imperial" ? `${Math.round(mToFt(meters))} ft` : `${Math.round(meters)} m`;
}

// Speed, from m/s (this app's internal unit) — km/h or mph.
export function fmtSpeed(metersPerSec: number | null | undefined): string {
  if (metersPerSec == null) return "—";
  const kmh = metersPerSec * 3.6;
  return getUnitSystem() === "imperial" ? `${kmhToMph(kmh).toFixed(1)}` : `${kmh.toFixed(1)}`;
}

export function fmtPercent(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(1)}%` : "—";
}

export function fmtBpm(v: number | null | undefined): string {
  return v != null ? `${Math.round(v)} bpm` : "—";
}

// Formats an already-unit-scaled minutes value as m:ss. Unlike fmtPace, this
// does NOT convert units — callers pass a value already in its final display
// unit (OverviewTab pre-scales pace to min/mi before calling this; SettingsTab's
// min/km preview stays metric-only regardless of the app's unit system). See
// docs/frontend.md's double-conversion note. Single home for what were two
// identical local copies (HRA-68 dedup).
export function fmtMinSecRaw(value: number): string {
  const m = Math.floor(value);
  const s = Math.round((value - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// The single date-display format every date shown to the user (not just
// inside a picker) goes through, so a "YYYY-MM-DD" from the backend never
// renders as the raw ISO string, and no two places in the app can show the
// same date two different ways. Driven by the Settings tab's "Date format"
// preference (utils/dateFormat.ts's module state, applied by
// useAppearance.ts) rather than the OS/browser's own locale — a fixed,
// user-chosen style×region (numeric/literal × uk/us) instead of an implicit,
// possibly-ambiguous OS default (dd/mm vs mm/dd reads differently depending
// on the reader's own locale; "23 Mar 2026" has no such ambiguity). Locales
// are pinned to en-GB/en-US per format (not `undefined`/runtime-locale) so
// day/month order, separators and punctuation render EXACTLY as documented —
// DATE_FORMAT_OPTIONS' `example` strings in types/api.ts — regardless of the
// browser's own language.
const DATE_FORMATTERS: Record<DateFormat, Intl.DateTimeFormat> = {
  numeric_uk: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }),
  numeric_us: new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit", year: "numeric" }),
  literal_uk: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short",  year: "numeric" }),
  literal_us: new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short",  year: "numeric" }),
};

// Numeric styles never spell out a month name, so they're locale-independent
// and untouched by the app language. Literal styles do spell it out — "Mar"
// reads as an English word to an Italian/French/etc. user, so once the
// language selector (HRA-104+) exists it should follow it. Only the month
// token is swapped: day/year digits and the uk/us order+punctuation stay
// pinned to DATE_FORMATTERS above, via formatToParts so nothing but that one
// token changes.
function localizedMonthShort(date: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { month: "short" }).format(date);
}

function fmtLiteralDate(date: Date, format: "literal_uk" | "literal_us"): string {
  // i18next.language is exactly one of LANGUAGE_NAMES (types/api.ts) — set by
  // detectLanguageFromLocale() at init and by useAppearance.ts's
  // changeLanguage() calls thereafter.
  const language = i18next.language || "en";
  // Japanese has no "day month year" sentence grammar to slot a swapped-in
  // month into — its date order is always year→month→day, each suffixed
  // with its own counter (年/月/日), and Intl's short Japanese month is
  // itself "8月" (digit + counter), not a word. Forcing it into the uk/us
  // day-month-year skeleton below produces a broken hybrid — e.g.
  // "23 8月 2026" — where a Western day number sits next to a token that
  // itself starts with a different digit, reading as if the month were
  // reported twice. Use Intl's own native Japanese date grammar instead,
  // rather than swapping a token into a skeleton that assumes Latin-style
  // month words.
  if (language === "ja") {
    return new Intl.DateTimeFormat("ja", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }
  const month = localizedMonthShort(date, language);
  return DATE_FORMATTERS[format].formatToParts(date)
    .map(part => (part.type === "month" ? month : part.value))
    .join("");
}

// Overview & Trends' chart axis labels: always numeric (no spelled-out month
// — a compact tick has no room for one), but still uk/dd-first or us/mm-first
// per the same region the full date_format setting carries. No year (these
// are short axis ticks, e.g. "13/08" — matches the compactness the
// hyphenated "MM-DD" label this replaced already had).
const NUMERIC_CHART_FORMATTERS: Record<"uk" | "us", Intl.DateTimeFormat> = {
  uk: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit" }),
  us: new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit" }),
};

// Parses a "YYYY-MM-DD" prefix as a LOCAL calendar date (no timezone shift) —
// `new Date("2026-08-19")` would parse as UTC midnight, which can display as
// the previous day in a timezone behind UTC. Accepts a longer ISO timestamp
// too (e.g. activity_date's full "…T07:16:27") by taking just the date part.
function parseIsoDateLocal(iso: string): Date | null {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = parseIsoDateLocal(iso);
  if (!date) return iso;
  const format = getDateFormatSystem();
  return format === "literal_uk" || format === "literal_us"
    ? fmtLiteralDate(date, format)
    : DATE_FORMATTERS[format].format(date);
}

// 3-letter weekday abbreviation (HRA-125, training-plan instance day rows) —
// deliberately fixed English (Mon..Sun) regardless of app language or the
// date_format setting's region, same "compact label, not a spelled-out
// sentence" reasoning as fmtDateChart's numeric-only axis ticks above.
const WEEKDAY_SHORT_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "short" });

export function fmtWeekdayShort(iso: string): string {
  const date = parseIsoDateLocal(iso);
  return date ? WEEKDAY_SHORT_FORMATTER.format(date) : "";
}

// Numeric-only "dd/mm" or "mm/dd" (no year) — see NUMERIC_CHART_FORMATTERS
// above. Used by domain/trends.ts's per-point chart labels.
export function fmtDateChart(iso: string): string {
  const date = parseIsoDateLocal(iso);
  return date ? NUMERIC_CHART_FORMATTERS[dateFormatRegion()].format(date) : iso;
}

// A race activity's label for any "pick a race" dropdown — originally local
// to manage/DateRangesSection.tsx's "link a race" picker, moved here once
// App.tsx's Activities-tab race picker needed the exact same format, so both
// stay in sync by construction rather than by two hand-kept copies.
export function fmtRaceLabel(r: { date_only: string; activity_name: string | null; distance_m: number | null }): string {
  const name = r.activity_name ? ` — ${r.activity_name}` : "";
  return `${fmtDate(r.date_only)}${name} (${fmtKm(r.distance_m)})`;
}
