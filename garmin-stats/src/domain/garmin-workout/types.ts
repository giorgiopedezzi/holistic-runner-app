// ── Garmin Workout FIT export — pure types ──────────────────────────────────
// HRA-184: isolated anti-corruption layer between the RunPlan DSL's
// ResolvedDay/ResolvedSegment shapes and Garmin's flat Workout Step model
// (docs/architecture/FIT-TRANSLATION-LAYER-ADR.md). No I/O, no @garmin/fitsdk
// import here — mirrors this project's domain/ convention. Every step field
// below is expressed in real units (seconds, meters, m/s); the FIT wire scale
// (verified against the installed @garmin/fitsdk profile — see
// integrations/garmin-workout.ts) is applied only in the integration layer
// that actually touches the SDK.

import type { ResolvedSegment } from "../runplan/instantiate.ts";

export type GarminStepIntensity = "active" | "interval" | "rest" | "warmup" | "cooldown" | "recovery" | "other";
export type GarminStepDurationType = "time" | "distance" | "open" | "repeatUntilStepsCmplt";
export type GarminStepTargetType = "speed" | "open";

export interface GarminWorkoutStep {
  messageIndex: number;
  intensity?: GarminStepIntensity;
  durationType: GarminStepDurationType;
  durationSeconds?: number; // only meaningful when durationType === "time"
  durationMeters?: number; // only meaningful when durationType === "distance"
  repeatFromMessageIndex?: number; // only meaningful when durationType === "repeatUntilStepsCmplt" — messageIndex of the first step of the repeat body
  repeatCount?: number; // only meaningful when durationType === "repeatUntilStepsCmplt"
  targetType: GarminStepTargetType;
  targetLowSpeedMps?: number; // only meaningful when targetType === "speed"
  targetHighSpeedMps?: number; // only meaningful when targetType === "speed"
  // Written to the FIT step's free-text wktStepName field (ADR §4.5's "smuggle
  // a hint" mechanism). HRA-185: progression stages carry a deterministic
  // PROGRESSION_MARKER_PREFIX-tagged name so import can safely collapse them
  // back into one ProgressionSegment without guessing at unmarked monotonic
  // steps from any other producer.
  name?: string;
}

// HRA-185: deterministic marker written by the exporter (HRA-184) onto each
// of a progression's PROGRESSION_STAGE_COUNT stage steps, and read back by
// the importer. groupId ties the stages of one progression together (the
// messageIndex of its first stage, unique within a day); stageIndex/stageCount
// let the importer verify it has the complete, correctly-ordered set before
// collapsing — a partial or out-of-order set is left as plain continuous
// segments rather than guessed at.
export const PROGRESSION_MARKER_PREFIX = "HRA:PROG";

export function progressionMarkerName(groupId: number, stageIndex: number, stageCount: number): string {
  return `${PROGRESSION_MARKER_PREFIX}:${groupId}:${stageIndex}/${stageCount}`;
}

export interface ProgressionMarker {
  groupId: number;
  stageIndex: number;
  stageCount: number;
}

export function parseProgressionMarkerName(name: string | undefined): ProgressionMarker | null {
  if (name == null) return null;
  const match = /^HRA:PROG:(\d+):(\d+)\/(\d+)$/.exec(name);
  if (!match) return null;
  return { groupId: Number(match[1]), stageIndex: Number(match[2]), stageCount: Number(match[3]) };
}

// HRA-173's pace-alert policy (garmin-dashboard/src/domain/planned-workout.ts
// LOWER_PACE_FACTOR/UPPER_PACE_FACTOR = 0.98/1.02), expressed in the speed
// domain FIT step targets actually use: low speed = 1000 / (pace * 1.02),
// high speed = 1000 / (pace * 0.98). A slower pace (larger sec/km) yields a
// lower speed bound and vice versa, so the factors swap sides in speed terms.
export interface PaceBandPolicy {
  bandFor(paceSecPerKm: number): { lowSpeedMps: number; highSpeedMps: number };
}

const LOW_SPEED_PACE_FACTOR = 1.02;
const HIGH_SPEED_PACE_FACTOR = 0.98;
const SEC_PER_KM_TO_MPS = 1000;

export const PACE_ALERT_BAND_POLICY: PaceBandPolicy = {
  bandFor(paceSecPerKm: number) {
    return {
      lowSpeedMps: SEC_PER_KM_TO_MPS / (paceSecPerKm * LOW_SPEED_PACE_FACTOR),
      highSpeedMps: SEC_PER_KM_TO_MPS / (paceSecPerKm * HIGH_SPEED_PACE_FACTOR),
    };
  },
};

export type GarminExportWarningCode = "LOSSY_PROGRESSION_STAIRCASE";

export interface GarminExportWarning {
  stepIndex: number | null;
  code: GarminExportWarningCode;
  message: string;
}

export type GarminExportErrorCode =
  | "NEEDS_REVIEW"
  | "UNSUPPORTED_WORKOUT_TYPE"
  | "UNKNOWN_TARGET"
  | "UNRESOLVED_PACE"
  | "INVALID_INTERVAL"
  | "EMPTY_WORKOUT";

export interface GarminExportError {
  code: GarminExportErrorCode;
  message: string;
}

export type GarminWorkoutStepsOutcome =
  | { ok: true; steps: GarminWorkoutStep[]; warnings: GarminExportWarning[] }
  | { ok: false; errors: GarminExportError[] };

// ── Import (HRA-185) ─────────────────────────────────────────────────────
// A decode error (malformed bytes, or bytes that don't structurally look
// like a Workout FIT file — see integrations/garmin-workout.ts) is distinct
// from a structurally valid file whose content doesn't reduce to a supported
// shape: the former never reaches the domain transform below at all.
export type GarminImportErrorCode =
  | "DECODE_ERROR"
  | "MISSING_FILE_ID"
  | "NOT_A_WORKOUT_FILE"
  | "MISSING_WORKOUT_MESSAGE"
  | "MISSING_WORKOUT_STEPS";

export interface GarminImportError {
  code: GarminImportErrorCode;
  message: string;
}

export type GarminImportWarningCode =
  | "DUPLICATE_STEP_INDEX"
  | "MISSING_STEP_INDEX"
  | "UNRESOLVABLE_CUSTOM_SPEED_BOUNDS"
  | "INVALID_REPEAT_REFERENCE"
  | "NESTED_REPEAT"
  | "UNSUPPORTED_REPEAT_BODY_SIZE"
  | "UNRECOGNIZED_STEP_SHAPE"
  | "IMPORTED_PROGRESSION_FROM_STAIRCASE";

export interface GarminImportWarning {
  stepIndex: number | null;
  code: GarminImportWarningCode;
  message: string;
}

// canApply: false means segments is empty — a non-applicable preview is never
// partially populated, so the caller can't accidentally act on a fragment of
// an unsupported structure (Story scope: no persistence, no raw-segment
// fallback — see domain/garmin-workout/import.ts's header note).
export interface GarminWorkoutImportPreview {
  canApply: boolean;
  segments: ResolvedSegment[];
  warnings: GarminImportWarning[];
}

export type GarminWorkoutImportOutcome =
  | { ok: true; preview: GarminWorkoutImportPreview }
  | { ok: false; error: GarminImportError };
