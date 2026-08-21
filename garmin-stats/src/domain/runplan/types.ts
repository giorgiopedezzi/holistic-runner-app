// ── RunPlan DSL v1 — types ────────────────────────────────────────────────
// Pure data shapes for the parsed training-plan DSL (HRA-111, amended HRA-113:
// warnings-only parsing — see docs/runplan-dsl.md). No I/O here — mirrors this
// project's domain/ convention (fit-parser.ts, workout-metrics.ts): pure logic,
// no DB/network access.

export type DisplayUnit = "km" | "mi";
export type OffsetUnit = "s/km" | "s/mi";
export type RestType = "stand" | "walk" | "jog";
export type EventType = "5k" | "10k" | "half" | "marathon" | "ultra" | "custom";

export type PacePolicy = Record<string, PaceValue>;
export type PaceValue = AbsolutePace | OffsetPace;

export interface AbsolutePace {
  kind: "absolute";
  pace_sec_per_km: number;
}

export interface OffsetPace {
  kind: "offset";
  anchor: string;
  offset_sec_per_km: number;
}

// unknown (HRA-113): a literal `?` placeholder, or any token the parser
// couldn't otherwise make sense of. Always accepted — never a hard error —
// and always drives a ParseWarning at the call site that encountered it.
export type Intensity = AnchorIntensity | OffsetIntensity | AbsoluteIntensity | UnknownIntensity;

export interface AnchorIntensity {
  kind: "anchor";
  anchor: string;
  raw: string;
}

export interface OffsetIntensity {
  kind: "offset";
  anchor: string;
  offset_sec_per_km: number;
  raw: string;
}

export interface AbsoluteIntensity {
  kind: "absolute";
  pace_sec_per_km: number;
  raw: string;
}

export interface UnknownIntensity {
  kind: "unknown";
  raw: string;
}

export interface DistanceTarget {
  kind: "distance";
  distance_m: number;
  raw: string;
}

export interface DurationTarget {
  kind: "duration";
  duration_sec: number;
  raw: string;
}

// unknown (HRA-113): same placeholder concept as UnknownIntensity, for Target
// position (e.g. the distance in "8x? @ ?").
export interface UnknownTarget {
  kind: "unknown";
  raw: string;
}

export type Target = DistanceTarget | DurationTarget | UnknownTarget;

export interface RestSpec {
  target: Target;
  intensity?: Intensity;
  rest_type?: RestType;
  raw: string;
}

export interface ContinuousSegment {
  type: "continuous";
  target: Target;
  intensity: Intensity;
  raw: string;
}

// rest is optional (HRA-113 reverses HRA-111's amendment 1 — nothing is a hard
// error anymore, see the module-level note in parser.ts). A missing `r:`
// clause produces a ParseWarning on the owning day instead of blocking parsing.
export interface IntervalSegment {
  type: "interval";
  reps: number | null; // null = the `?` placeholder (reps count unspecified)
  work_target: Target;
  work_intensity: Intensity;
  rest?: RestSpec;
  raw: string;
}

export interface ProgressionSegment {
  type: "progression";
  target: Target;
  start_intensity: Intensity;
  end_intensity: Intensity;
  raw: string;
}

export interface RestBlockSegment {
  type: "rest_block";
  target: Target;
  rest_type?: RestType;
  raw: string;
}

export type WorkoutSegment = ContinuousSegment | IntervalSegment | ProgressionSegment | RestBlockSegment;

// HRA-113: valid/errors (HRA-111 amendment 2) are removed — nothing produces a
// hard error anymore (see parser.ts), so a day/week/section/plan-level "is
// this broken" flag no longer means anything. warnings replaces it: every
// day-scoped ParseWarning lives directly on that DayEntry (plan/section/week-
// scoped warnings — e.g. an unrecognized PACE line — stay on ParseResult.warnings,
// see below). needs_review is unchanged: true whenever this day has warnings,
// checked by the future review UI to decide what to surface, not by the parser
// to decide whether to fail.
export interface DayEntry {
  day: number;
  suffix?: string;
  category?: string;
  workout_type: "run" | "rest" | "todo" | "cross" | "strength";
  segments: WorkoutSegment[];
  activity_target?: Target;
  activity_description?: string;
  notes?: string;
  needs_review: boolean;
  raw_dsl: string;
  warnings: ParseWarning[];
}

export interface Week {
  number: number;
  start_date?: string;
  notes?: string;
  pace_policy: PacePolicy;
  days: DayEntry[];
  // HRA-115: the original `WEEK <n> [START <date>][ # note]` header line, as
  // written — lets an editor patch this week's header in place when
  // reconstructing an edited dsl_source, mirroring DayEntry.raw_dsl above.
  raw_dsl: string;
}

export interface Section {
  name: string;
  week_spec: string;
  notes?: string;
  pace_policy: PacePolicy;
  weeks: Week[];
  // HRA-115: the original `SECTION "<name>" WEEKS <spec>[ # note]` header line,
  // as written. Empty for the implicit default section (no SECTION line in
  // source) — signals an editor to add a new SECTION line instead of patching
  // one that never existed.
  raw_dsl: string;
}

export interface PlanMetadata {
  name?: string;
  event?: EventType;
  distance_m?: number;
  goal_time_sec?: number;
  start_date?: string;
  unit: DisplayUnit;
  offset_unit: OffsetUnit;
  default_rest: RestType;
  pace_policy: PacePolicy;
}

export interface RunPlan {
  metadata: PlanMetadata;
  sections: Section[];
}

// Reserved for the document-level "nothing to build a plan from" case
// (missing PLAN header, empty input) — HRA-113 keeps this exactly as HRA-111
// defined it; only day/segment-level hard errors moved to warnings.
export interface ParseError {
  line: number;
  content: string;
  message: string;
  suggestion?: string;
}

export interface ParseWarning {
  line: number;
  content: string;
  message: string;
}

// ok:false (no plan at all) is reserved for genuinely unparseable input
// (missing PLAN header, empty input) — unchanged by HRA-113. Everything else
// returns a plan tree; day/segment-level issues are warnings, never a reason
// to withhold the plan.
export type ParseResult =
  | { ok: true; plan: RunPlan; warnings: ParseWarning[] }
  | { ok: false; errors: ParseError[]; warnings: ParseWarning[] };

// What a single day needs to parse independently of the rest of the document
// — used internally by parseRunPlanDSL, and exposed for a future "edit one
// day, re-validate just that day" UI flow (HRA-111 amendment 2).
export interface DayParseContext {
  unit: DisplayUnit;
  offset_unit: OffsetUnit;
  default_rest: RestType;
  pacePolicy: PacePolicy;
}
