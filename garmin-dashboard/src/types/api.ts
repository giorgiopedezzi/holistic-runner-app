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

// Curated selectable-accent set (HRA-95) — governs interactive chrome only
// (buttons, active pills, links, rings, focus), never --data-* colors. See
// utils/accent.ts for the fixed hex + WCAG-verified --on-accent per name.
export type AccentColor = "teal" | "violet" | "magenta" | "amber" | "sky" | "lime";
export const ACCENT_COLOR_NAMES: AccentColor[] = ["teal", "violet", "magenta", "amber", "sky", "lime"];

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

export const SPORT_COLOR: Record<string, string> = {
  running:          "#1db87a",
  cycling:          "#3a8ef5",
  walking:          "#f59e0b",
  swimming:         "#06b6d4",
  hiking:           "#84cc16",
  fitness_equipment:"#a855f7",
  other:            "#6b7280",
};
