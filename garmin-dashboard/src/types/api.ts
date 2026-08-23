// ── API response types ────────────────────────────────────────────────────
// These mirror the shapes returned by server.ts exactly.
// Add new fields here when extending the backend.

// The list envelope every collection endpoint returns (HRA-38). Offset-based:
// page.total is the full count, page.limit/offset the window returned.
export interface Page {
  limit: number;
  offset: number;
  total: number;
}
export interface Paginated<T> {
  data: T[];
  page: Page;
}

export interface DateRange {
  min_date: string | null;
  max_date: string | null;
}

export interface Activity {
  id:             number;
  filename:       string;
  activity_date:  string;
  date_only:      string;
  sport:          string | null;
  duration_sec:   number | null;
  moving_time_sec: number | null;
  distance_m:     number | null;
  avg_pace_minkm: number | null;
  calories:       number | null;
  avg_hr:         number | null;
  max_hr:         number | null;
  avg_cadence:    number | null;
  ascent_m:       number | null;
  descent_m:      number | null;
  avg_speed_ms:   number | null;
  max_speed_ms:   number | null;
  source?:        string;
  // AI workout classifier + feedback — see CLAUDE.md's "AI workout
  // classifier" notes. Two independent result slots (both null = neither
  // method has run yet) — running one never overwrites the other, so both
  // can be computed and compared side by side.
  ai_classification:          string | null;
  ai_explanation:             string | null;
  statistical_classification: string | null;
  statistical_explanation:    string | null;
  // Exactly one shared verdict per activity, not one per method — set when
  // the user thumbs up/down whichever card's result they're reviewing.
  user_feedback:          UserFeedback | null;
  user_correction_reason: string | null;
  final_classification:   string | null;
  // Which card (ai/statistical) the confirmed verdict above came from — set
  // at feedback time, not classify time.
  classification_method:  ClassificationMethod | null;
  // Training session type (FK to activity_types, default "Training" id=1) +
  // an optional free-text label (e.g. a race's name) — see
  // ActivityDetailBody.tsx's type/save dropdown.
  activity_type_id: number;
  activity_name:    string | null;
}

// A kind of training session an activity can be tagged as (Training, Race
// 5km, ...). min_distance_m gates which types are selectable for a given
// activity — see ActivityDetailBody.tsx.
export interface ActivityType {
  id:             number;
  name:           string;
  min_distance_m: number;
}

// A race-type activity (activity_type_id != Training), as offered on the
// "link a race" dropdown when saving a date range — see
// components/manage/DateRangesSection.tsx.
export interface RaceActivity {
  id:                number;
  date_only:         string;
  activity_type_id:  number;
  activity_name:     string | null;
  distance_m:        number | null;
}

// A named, saved date range (Data & Sync tab) — mainly for comparing
// training blocks (e.g. week 2 vs week 3 of marathon prep). Optionally
// linked to the race it led up to (LEFT JOIN'd server-side, so the race_*
// fields are all null when activity_id is null).
export interface SavedDateRange {
  id:                     number;
  name:                   string;
  from_date:              string;
  to_date:                string;
  activity_id:            number | null;
  created_at:             string;
  race_date_only:         string | null;
  race_activity_name:     string | null;
  race_distance_m:        number | null;
  race_activity_type_id:  number | null;
}

// A saved RunPlan DSL v1 template (HRA-111/HRA-112, amended HRA-113) — mirrors
// garmin-stats/src/db.ts's PlanTemplateRow. parsed_plan is JSON-serialized, not
// parsed here — the domain shape it deserializes to lives in types/runplan.ts
// (RunPlan), consumed via domain/runplan-aggregate.ts's builders (HRA-116).
export interface PlanTemplate {
  id:           number;
  name:         string;
  dsl_source:   string;
  parsed_plan:  string;
  event:        string | null;
  approved_at:  string | null;
  created_at:   string;
}

// One resolved instantiation of a plan template (HRA-112, amended HRA-114) —
// mirrors garmin-stats/src/db.ts's PlanInstanceRow.
export interface PlanInstance {
  id:                  number;
  template_id:         number;
  start_date:          string;
  pace_overrides:      string | null;
  target_activity_id:  number | null;
  approved_at:         string | null;
  name:                string | null;
  event:               string | null;
  created_at:          string;
}

// One resolved day of a plan instance — mirrors PlanInstanceDayRow. segments
// is JSON-serialized ResolvedSegment[] (types/runplan.ts), not parsed here.
export interface PlanInstanceDay {
  id:                    number;
  instance_id:           number;
  section_name:          string;
  week_number:           number;
  date:                  string;
  day:                   number;
  suffix:                string | null;
  category:              string | null;
  workout_type:          string;
  segments:              string;
  activity_target:       string | null;
  activity_description:  string | null;
  notes:                 string | null;
  needs_review:          number;
}

export interface PlanInstanceWithDays extends PlanInstance {
  days: PlanInstanceDay[];
}

export interface SportSummary {
  sport:              string;
  total_activities:   number;
  total_km:           number;
  total_hours:        number;
  total_calories:     number | null;
  avg_hr:             number | null;
  avg_pace:           number | null;
  total_ascent:       number | null;
}

export interface WeeklyStat {
  week:     string;   // "2024-W32"
  runs:     number;
  km:       number;
  avg_hr:   number | null;
  avg_pace: number | null;
}

export interface MonthlyStat {
  month:    string;   // "2024-08"
  runs:     number;
  km:       number;
  avg_hr:   number | null;
  avg_pace: number | null;
  ascent:   number | null;
}

export interface TrackPoint {
  elapsed_sec: number | null;
  // Real wall-clock time (Unix seconds). Only populated for Garmin activities
  // reprocessed after this field was added — null for Strava-sourced points
  // and any not-yet-reprocessed Garmin ones.
  timestamp_unix: number | null;
  distance_m:  number | null;
  heart_rate:  number | null;
  speed_ms:    number | null;
  cadence:     number | null;
  altitude_m:  number | null;
  temperature: number | null;
  power:       number | null;
}

// ── Withings ──────────────────────────────────────────────────────────────

export interface BodyMeasurement {
  measured_at:    string;
  date_only:      string;
  weight_kg:      number | null;
  fat_ratio:      number | null;
  fat_mass_kg:    number | null;
  muscle_mass_kg: number | null;
  hydration_kg:   number | null;
  bone_mass_kg:   number | null;
  bmi:            number | null;
  heart_rate:     number | null;
}

export interface MonthlyBody {
  month:           string;
  avg_weight:      number | null;
  min_weight:      number | null;
  max_weight:      number | null;
  avg_fat_ratio:   number | null;
  avg_muscle_mass: number | null;
}

export interface CorrelationPoint {
  week:          string;
  km:            number;
  avg_hr:        number | null;
  runs:          number;
  avg_weight:    number | null;
  avg_fat_ratio: number | null;
}

export interface DeviceStatus {
  connected: boolean;
  reason?:   string;
  name?:     string;
}

export interface WithingsStatus {
  present:    boolean;
  valid:      boolean;
  expiresAt?: number;
  scope?:     string;
  error?:     string;
}

export interface StravaStatus {
  present:    boolean;
  valid:      boolean;
  expiresAt?: number;
  scope?:     string;
  error?:     string;
}

// Theme is the 2 concrete, CSS-applicable names (matched by index.css's
// [data-theme="…"] blocks). StoredTheme adds 'auto' — a 3rd value that's
// valid to persist but never applied directly as data-theme; useAppearance
// resolves it to a concrete Theme via prefers-color-scheme first.
export type Theme = "dark" | "light";
export const THEME_NAMES: Theme[] = ["dark", "light"];
export type StoredTheme = Theme | "auto";

export type BackgroundKind = "none" | "bundled" | "custom";

// Same 'auto' pattern as StoredTheme — resolved to metric/imperial by
// useAppearance via a locale heuristic (see utils/units.ts), never applied
// as 'auto' directly.
export type StoredUnitSystem = "metric" | "imperial" | "auto";

// 'accordion' (default) expands an activity's detail inline in
// ActivitiesTab; 'modal' opens it as a popup (the original behavior).
export type ActivityDetailView = "accordion" | "modal";

// Narrowed to the 3 values paired 1:1 with Palette below (dashboard
// design-system rework) — no independent picker any more; the backend keeps
// them in lockstep (sky=metal, amber=warm, graphite=graphite). Governs
// interactive chrome only (buttons, active pills, links, rings, focus),
// never --data-* colors.
export type AccentColor = "sky" | "amber" | "graphite";
export const ACCENT_COLOR_NAMES: AccentColor[] = ["sky", "amber", "graphite"];

// How every displayed date is formatted app-wide (utils/fmt.ts's fmtDate) —
// style (numeric vs literal) × region (uk vs us). See utils/dateFormat.ts for
// the module-scope resolved value + the region helper Overview & Trends'
// chart axes read (always numeric, only the uk/us day-month order varies).
export type DateFormat = "numeric_uk" | "numeric_us" | "literal_uk" | "literal_us";
export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string; example: string }[] = [
  { value: "numeric_uk", label: "Numeric (UK)", example: "23/03/2026" },
  { value: "numeric_us", label: "Numeric (US)", example: "03/23/2026" },
  { value: "literal_uk", label: "Literal (UK)",  example: "23 Mar 2026" },
  { value: "literal_us", label: "Literal (US)",  example: "Mar 23, 2026" },
];
export const DATE_FORMAT_NAMES: DateFormat[] = DATE_FORMAT_OPTIONS.map(o => o.value);

// i18n (HRA-104): Language is the 2 concrete, translatable codes; StoredLanguage
// adds 'auto' — valid to persist, resolved via navigator.language at render
// time (see i18n.ts's detectLanguageFromLocale) rather than applied directly,
// same 'auto' pattern as StoredUnitSystem above.
export type Language = "en" | "it" | "fr" | "de" | "es" | "ja";
export const LANGUAGE_NAMES: Language[] = ["en", "it", "fr", "de", "es", "ja"];
export type StoredLanguage = Language | "auto";

// Dashboard palette flavor — 'metal' (cold/technical/minimal) or 'warm'
// (amber/premium/expressive), crossed with Theme (dark/light) above for 4
// total looks, PLUS 'graphite' — a third, standalone, dark-only palette
// (matches on data-palette alone in index.css, ignoring data-theme
// entirely; there is no "light graphite", so ThemePicker becomes
// irrelevant while it's selected — see SettingsTab.tsx's ThemePicker).
// Applied via a data-palette attribute (index.css), compounded with the
// existing data-theme attribute for metal/warm. Replaces the earlier
// 4-way StylePack (HRA-119: boomer/genz/millennial/minimal) entirely.
export type Palette = "metal" | "warm" | "graphite";
export const PALETTE_NAMES: Palette[] = ["metal", "warm", "graphite"];

export interface Settings {
  outlier_speed_delta_per_sec:   number;
  outlier_cadence_delta_per_sec: number;
  outlier_min_speed_kmh:         number;
  theme:            StoredTheme;
  background_kind:  BackgroundKind;
  background_value: string | null;
  unit_system:      StoredUnitSystem;
  // Overview & Trends: minimum activities (single mode) or groups (week/
  // month mode) before a sport's trend chart is shown — see OverviewTab.tsx.
  min_trend_group_size: number;
  activity_detail_view: ActivityDetailView;
  accent_color: AccentColor;
  date_format: DateFormat;
  language: StoredLanguage;
  palette: Palette;
}

// ── Trash (soft-deleted activities / body measurements) ─────────────────
export interface TrashedActivity {
  id:         number;
  filename:   string;
  date_only:  string;
  sport:      string | null;
  distance_m: number | null;
  source:     string;
  deleted_at: string;
}

export interface TrashedBodyMeasurement {
  id:          number;
  measured_at: string;
  date_only:   string;
  weight_kg:   number | null;
  deleted_at:  string;
}

// ── AI workout classifier ─────────────────────────────────────────────────
// The six canonical labels — also duplicated in garmin-stats' ollama-service.ts
// (no shared package between the two npm projects in this repo). Keep both
// lists in sync if these ever change.
export const WORKOUT_CLASSIFICATIONS = [
  "Recovery Run",
  "Long Session",
  "Repeats/Intervals",
  "Progressive Run",
  "Fartlek",
  "Tapasciata / Light Maintenance",
] as const;
export type WorkoutClassification = typeof WORKOUT_CLASSIFICATIONS[number];

// Display-only i18n key per classification (HRA-105) — the stored/compared
// value above is the wire format (persisted, matched against ai_classification/
// statistical_classification/final_classification) and stays untouched; only
// what's rendered on screen goes through t(WORKOUT_CLASSIFICATION_KEY[c], c),
// same "value stays stable, label goes through a lookup" pattern as
// components/activity/shared.ts's METRIC_DEFS.
export const WORKOUT_CLASSIFICATION_KEY: Record<WorkoutClassification, string> = {
  "Recovery Run":                    "classification.recoveryRun",
  "Long Session":                    "classification.longSession",
  "Repeats/Intervals":               "classification.repeatsIntervals",
  "Progressive Run":                 "classification.progressiveRun",
  "Fartlek":                         "classification.fartlek",
  "Tapasciata / Light Maintenance":  "classification.tapasciata",
};

// Also duplicated in garmin-stats' server.ts (CORRECTION_REASONS).
export const CORRECTION_REASONS = [
  "Warmup/cooldown skewed data",
  "Perception felt harder than numbers",
  "Traffic/Stops disrupted pace",
  "Other",
] as const;
export type CorrectionReason = typeof CORRECTION_REASONS[number];

export type UserFeedback = "approved" | "rejected";

// 'ai' = ollama-service.ts (a local LLM); 'statistical' = stats-classifier.ts
// (deterministic rules over the same summary numbers — pace variance,
// splits, zero-pace events — no LLM, no network call, instant).
export type ClassificationMethod = "ai" | "statistical";

// Status drives the yellow/green badge in both ActivityModal and ManageTab's
// bulk classify list — derived, not stored (see CLAUDE.md).
export type ClassificationStatus = "unclassified" | "pending" | "confirmed";

export function classificationStatus(a: {
  ai_classification: string | null; statistical_classification: string | null; user_feedback: UserFeedback | null;
}): ClassificationStatus {
  if (!a.ai_classification && !a.statistical_classification) return "unclassified";
  return a.user_feedback ? "confirmed" : "pending";
}

// ── UI helpers ────────────────────────────────────────────────────────────

export type Sport = "running" | "cycling" | "walking" | "hiking" | "swimming" | "other";

// Theme-aware per-sport identity color (dashboard design-system rework) —
// keyed by the resolved Theme so a sport's Badge/RunnerGlyph/etc. color
// stays legible against both the dark and light backgrounds, same
// "color follows the entity" precedent as --data-pace/--data-hr. Read via
// utils/theme.ts's getResolvedTheme() at render time (a module-scope global,
// same pattern as utils/units.ts) rather than every consumer threading
// `theme` down as its own prop.
export const SPORT_COLOR: Record<Theme, Record<string, string>> = {
  dark: {
    running:           "#2FAF7F", // emerald
    cycling:           "#4B8CCF", // steel blue
    walking:           "#C9953E", // muted amber
    swimming:          "#3BA6B8", // deep cyan
    hiking:            "#789B43", // olive
    fitness_equipment: "#8D62B8", // muted violet
    other:             "#66717D", // steel grey
  },
  light: {
    running:           "#23805F",
    cycling:           "#356FA8",
    walking:           "#9A6E25",
    swimming:          "#247F90",
    hiking:            "#5F7F31",
    fitness_equipment: "#704A96",
    other:             "#59636E",
  },
};
