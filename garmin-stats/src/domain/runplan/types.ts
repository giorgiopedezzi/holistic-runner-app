// ── RunPlan DSL v1 — types ────────────────────────────────────────────────
// Pure data shapes for the parsed training-plan DSL (HRA-111). No I/O here —
// mirrors this project's domain/ convention (fit-parser.ts, workout-metrics.ts):
// pure logic, no DB/network access. See docs/runplan-dsl.md for the grammar.

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

export type Intensity = AnchorIntensity | OffsetIntensity | AbsoluteIntensity;

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

export type Target = DistanceTarget | DurationTarget;

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

// rest is REQUIRED (not optional) — HRA-111 amendment 1: an interval without
// defined recovery is treated as missing information, not a valid session.
export interface IntervalSegment {
  type: "interval";
  reps: number;
  work_target: Target;
  work_intensity: Intensity;
  rest: RestSpec;
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

// valid/errors (HRA-111 amendment 2): bottom-up validity so a future accordion
// UI can mark exactly the broken day/week/section, without the whole document
// failing to parse. needs_review is a separate, softer signal (e.g. an
// unresolved pace anchor) — a day can be valid:true and needs_review:true at
// the same time.
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
  valid: boolean;
  errors: ParseError[];
}

export interface Week {
  number: number;
  start_date?: string;
  notes?: string;
  pace_policy: PacePolicy;
  days: DayEntry[];
  valid: boolean;
  errors: ParseError[];
}

export interface Section {
  name: string;
  week_spec: string;
  notes?: string;
  pace_policy: PacePolicy;
  weeks: Week[];
  valid: boolean;
  errors: ParseError[];
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
  valid: boolean;
  errors: ParseError[];
}

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
// (missing PLAN header, empty input) — HRA-111 amendment 2. Everything else
// returns a plan tree, with broken parts marked valid:false.
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
