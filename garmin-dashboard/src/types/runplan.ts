// ── RunPlan DSL v1 — frontend data shapes (HRA-116) ─────────────────────────
// Mirrors garmin-stats/src/domain/runplan/types.ts and instantiate.ts. This
// project has no shared client-type layer yet (Epic HRA-36 owns building
// one) — these shapes are a deliberate duplicate of the backend's, kept in
// lockstep by hand until that Epic lands, same as every other API-shaped
// type in this app's types/api.ts.

export type WorkoutType = "run" | "rest" | "todo" | "cross" | "strength";
export type RestType = "stand" | "walk" | "jog";

export interface AbsolutePace { kind: "absolute"; pace_sec_per_km: number }
export interface OffsetPace { kind: "offset"; anchor: string; offset_sec_per_km: number }
export type PaceValue = AbsolutePace | OffsetPace;
export type PacePolicy = Record<string, PaceValue>;

export interface DistanceTarget { kind: "distance"; distance_m: number; raw: string }
export interface DurationTarget { kind: "duration"; duration_sec: number; raw: string }
export interface UnknownTarget { kind: "unknown"; raw: string }
export type Target = DistanceTarget | DurationTarget | UnknownTarget;

export interface AnchorIntensity { kind: "anchor"; anchor: string; raw: string }
export interface OffsetIntensity { kind: "offset"; anchor: string; offset_sec_per_km: number; raw: string }
export interface AbsoluteIntensity { kind: "absolute"; pace_sec_per_km: number; raw: string }
export interface UnknownIntensity { kind: "unknown"; raw: string }
export type Intensity = AnchorIntensity | OffsetIntensity | AbsoluteIntensity | UnknownIntensity;

export interface RestSpec {
  target: Target; intensity?: Intensity; rest_type?: RestType; raw: string;
}

export interface ContinuousSegment { type: "continuous"; target: Target; intensity: Intensity; raw: string }
export interface IntervalSegment {
  type: "interval"; reps: number | null; work_target: Target; work_intensity: Intensity;
  rest?: RestSpec; raw: string;
}
export interface ProgressionSegment {
  type: "progression"; target: Target; start_intensity: Intensity; end_intensity: Intensity; raw: string;
}
export interface RestBlockSegment { type: "rest_block"; target: Target; rest_type?: RestType; raw: string }
export type WorkoutSegment = ContinuousSegment | IntervalSegment | ProgressionSegment | RestBlockSegment;

export interface ParseWarning { line: number; content: string; message: string }

export interface DayEntry {
  day: number;
  suffix?: string;
  category?: string;
  workout_type: WorkoutType;
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
  // HRA-115: the original WEEK header line as written.
  raw_dsl: string;
}

export interface Section {
  name: string;
  week_spec: string;
  notes?: string;
  pace_policy: PacePolicy;
  weeks: Week[];
  // HRA-115: the original SECTION header line as written; "" for the
  // implicit default section (no SECTION line in source).
  raw_dsl: string;
}

// Resolved (plan-instance) shapes — garmin-stats/src/domain/runplan/instantiate.ts.
export type ResolvedSegment =
  | { type: "continuous"; target: Target; resolved_pace_sec_per_km: number | null; raw: string }
  | {
      type: "interval"; reps: number | null; work_target: Target; work_resolved_pace_sec_per_km: number | null;
      rest?: { target: Target; resolved_pace_sec_per_km: number | null; rest_type?: RestType; raw: string };
      raw: string;
    }
  | {
      type: "progression"; target: Target;
      start_resolved_pace_sec_per_km: number | null; end_resolved_pace_sec_per_km: number | null; raw: string;
    }
  | { type: "rest_block"; target: Target; rest_type?: RestType; raw: string };

export interface ResolvedDay {
  section_name: string;
  week_number: number;
  date: string;
  day: number;
  suffix?: string;
  category?: string;
  workout_type: WorkoutType;
  segments: ResolvedSegment[];
  activity_target?: Target;
  activity_description?: string;
  notes?: string;
  needs_review: boolean;
}
