// ── Garmin Workout FIT export — pure types ──────────────────────────────────
// HRA-184: isolated anti-corruption layer between the RunPlan DSL's
// ResolvedDay/ResolvedSegment shapes and Garmin's flat Workout Step model
// (docs/architecture/FIT-TRANSLATION-LAYER-ADR.md). No I/O, no @garmin/fitsdk
// import here — mirrors this project's domain/ convention. Every step field
// below is expressed in real units (seconds, meters, m/s); the FIT wire scale
// (verified against the installed @garmin/fitsdk profile — see
// integrations/garmin-workout.ts) is applied only in the integration layer
// that actually touches the SDK.

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
