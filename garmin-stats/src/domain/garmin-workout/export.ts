// ── Garmin Workout FIT export — pure transform ──────────────────────────────
// HRA-184: ResolvedDay -> flat GarminWorkoutStep[] + warnings, per the mapping
// table in docs/architecture/FIT-TRANSLATION-LAYER-ADR.md §4.2. Pure logic,
// no @garmin/fitsdk import — see integrations/garmin-workout.ts for the SDK
// boundary and the exact FIT wire-scale conversion.
import type { ResolvedDay, ResolvedSegment } from "../runplan/instantiate.ts";
import type { Target } from "../runplan/types.ts";
import type {
  GarminExportError,
  GarminExportWarning,
  GarminWorkoutStep,
  GarminStepIntensity,
  GarminWorkoutStepsOutcome,
  PaceBandPolicy,
} from "./types.ts";

// Progression segments are quantized into exactly this many discrete stages
// (HRA-184 AC) — a fixed, product-decided approximation of a continuous ramp,
// not a tunable knob.
const PROGRESSION_STAGE_COUNT = 5;

// FIT profile quantization units for workoutStep durationValue (verified
// against the installed @garmin/fitsdk 21.214.0 profile.js — mesgNum 27,
// field 2 "durationValue", subfields "durationDistance" scale 100 units/m and
// "durationTime" scale 1000 units/s). Used here only to distribute a
// progression's total distance/duration across its stages without losing a
// fractional wire unit — the real @garmin/fitsdk scaling happens in
// integrations/garmin-workout.ts, never here.
const DISTANCE_PROFILE_UNITS_PER_METER = 100;
const DURATION_PROFILE_UNITS_PER_SECOND = 1000;

function durationFieldsFor(target: Target): Pick<GarminWorkoutStep, "durationType" | "durationSeconds" | "durationMeters"> {
  if (target.kind === "distance") return { durationType: "distance", durationMeters: target.distance_m };
  if (target.kind === "duration") return { durationType: "time", durationSeconds: target.duration_sec };
  return { durationType: "open" };
}

function targetFieldsFor(
  paceSecPerKm: number | null,
  band: PaceBandPolicy,
): Pick<GarminWorkoutStep, "targetType" | "targetLowSpeedMps" | "targetHighSpeedMps"> {
  if (paceSecPerKm == null) return { targetType: "open" };
  const { lowSpeedMps, highSpeedMps } = band.bandFor(paceSecPerKm);
  return { targetType: "speed", targetLowSpeedMps: lowSpeedMps, targetHighSpeedMps: highSpeedMps };
}

function makeStep(
  messageIndex: number,
  intensity: GarminStepIntensity,
  target: Target,
  paceSecPerKm: number | null,
  band: PaceBandPolicy,
): GarminWorkoutStep {
  return {
    messageIndex,
    intensity,
    ...durationFieldsFor(target),
    ...targetFieldsFor(paceSecPerKm, band),
  };
}

function makeOpenRestStep(messageIndex: number): GarminWorkoutStep {
  return { messageIndex, intensity: "rest", durationType: "open", targetType: "open" };
}

// A required leg (continuous target, interval work leg, progression
// endpoints) must have both a real target and a resolved pace — unlike an
// optional leg (interval rest, rest_block), which tolerates an unknown target
// or a null pace by degrading to an "open" step (§4.2/§4.3 of the ADR).
function validateRequiredLeg(target: Target, paceSecPerKm: number | null, label: string): GarminExportError | null {
  if (target.kind === "unknown") return { code: "UNKNOWN_TARGET", message: `${label} has no resolved target.` };
  if (paceSecPerKm == null) return { code: "UNRESOLVED_PACE", message: `${label} has no resolved pace.` };
  return null;
}

function distributeProfileUnits(totalUnits: number, count: number): number[] {
  const base = Math.floor(totalUnits / count);
  const remainder = totalUnits - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

// Splits a single ProgressionSegment's target into PROGRESSION_STAGE_COUNT
// equal-distance or equal-duration stages, each carrying its own linearly
// interpolated pace (including both endpoints, per HRA-184 AC). Stage sizes
// are distributed in FIT-profile-unit space so their sum exactly reproduces
// the original total once the integration layer re-applies the same scale —
// zero drift, comfortably within the AC's "one FIT profile unit" tolerance.
function buildProgressionStages(
  target: Target,
  startPaceSecPerKm: number,
  endPaceSecPerKm: number,
): Array<{ target: Target; paceSecPerKm: number }> {
  const paces = Array.from(
    { length: PROGRESSION_STAGE_COUNT },
    (_, i) => startPaceSecPerKm + ((endPaceSecPerKm - startPaceSecPerKm) * i) / (PROGRESSION_STAGE_COUNT - 1),
  );

  if (target.kind === "distance") {
    const totalUnits = Math.round(target.distance_m * DISTANCE_PROFILE_UNITS_PER_METER);
    const stageUnits = distributeProfileUnits(totalUnits, PROGRESSION_STAGE_COUNT);
    return stageUnits.map((units, i) => ({
      target: { kind: "distance", distance_m: units / DISTANCE_PROFILE_UNITS_PER_METER, raw: target.raw },
      paceSecPerKm: paces[i],
    }));
  }

  // target.kind === "duration" — the only other case reachable here, since
  // an "unknown" target is rejected by the caller before this is invoked.
  const durationTarget = target as Extract<Target, { kind: "duration" }>;
  const totalUnits = Math.round(durationTarget.duration_sec * DURATION_PROFILE_UNITS_PER_SECOND);
  const stageUnits = distributeProfileUnits(totalUnits, PROGRESSION_STAGE_COUNT);
  return stageUnits.map((units, i) => ({
    target: { kind: "duration", duration_sec: units / DURATION_PROFILE_UNITS_PER_SECOND, raw: target.raw },
    paceSecPerKm: paces[i],
  }));
}

function exportSegment(
  segment: ResolvedSegment,
  steps: GarminWorkoutStep[],
  warnings: GarminExportWarning[],
  errors: GarminExportError[],
  band: PaceBandPolicy,
): void {
  switch (segment.type) {
    case "continuous": {
      const error = validateRequiredLeg(segment.target, segment.resolved_pace_sec_per_km, `Continuous segment "${segment.raw}"`);
      if (error) { errors.push(error); return; }
      steps.push(makeStep(steps.length, "active", segment.target, segment.resolved_pace_sec_per_km, band));
      return;
    }

    case "interval": {
      if (segment.reps == null || segment.reps <= 0) {
        errors.push({ code: "INVALID_INTERVAL", message: `Interval segment "${segment.raw}" has no resolved repetition count.` });
        return;
      }
      const workError = validateRequiredLeg(segment.work_target, segment.work_resolved_pace_sec_per_km, `Interval work leg "${segment.raw}"`);
      if (workError) { errors.push(workError); return; }

      const repeatFromMessageIndex = steps.length;
      steps.push(makeStep(steps.length, "interval", segment.work_target, segment.work_resolved_pace_sec_per_km, band));
      if (segment.rest) {
        steps.push(makeStep(steps.length, "rest", segment.rest.target, segment.rest.resolved_pace_sec_per_km, band));
      }
      steps.push({
        messageIndex: steps.length,
        durationType: "repeatUntilStepsCmplt",
        repeatFromMessageIndex,
        repeatCount: segment.reps,
        targetType: "open",
      });
      return;
    }

    case "progression": {
      const error = validateRequiredLeg(segment.target, segment.start_resolved_pace_sec_per_km, `Progression segment "${segment.raw}"`)
        ?? (segment.end_resolved_pace_sec_per_km == null
          ? { code: "UNRESOLVED_PACE" as const, message: `Progression segment "${segment.raw}" has no resolved end pace.` }
          : null);
      if (error) { errors.push(error); return; }

      const warningStepIndex = steps.length;
      const stages = buildProgressionStages(segment.target, segment.start_resolved_pace_sec_per_km as number, segment.end_resolved_pace_sec_per_km as number);
      for (const stage of stages) {
        steps.push(makeStep(steps.length, "active", stage.target, stage.paceSecPerKm, band));
      }
      warnings.push({
        stepIndex: warningStepIndex,
        code: "LOSSY_PROGRESSION_STAIRCASE",
        message: `Progression segment "${segment.raw}" approximated as ${PROGRESSION_STAGE_COUNT} discrete stages; Garmin Workout FIT cannot represent a continuous pace ramp.`,
      });
      return;
    }

    case "rest_block": {
      // A rest block never carries a pace target in the DSL (RestBlockSegment
      // has no intensity field) — always "open" on the target-speed axis. An
      // unresolved (unknown) target degrades to an open-duration step too.
      steps.push(makeStep(steps.length, "rest", segment.target, null, band));
      return;
    }
  }
}

export function resolvedDayToGarminSteps(day: ResolvedDay, band: PaceBandPolicy): GarminWorkoutStepsOutcome {
  const errors: GarminExportError[] = [];

  if (day.needs_review) {
    errors.push({ code: "NEEDS_REVIEW", message: "Day is flagged needs_review and cannot be exported." });
  }
  if (day.workout_type !== "run" && day.workout_type !== "rest") {
    errors.push({ code: "UNSUPPORTED_WORKOUT_TYPE", message: `Workout type "${day.workout_type}" is not supported for Garmin export.` });
  }
  if (errors.length > 0) return { ok: false, errors };

  const steps: GarminWorkoutStep[] = [];
  const warnings: GarminExportWarning[] = [];

  if (day.workout_type === "rest" && day.segments.length === 0) {
    steps.push(makeOpenRestStep(0));
    return { ok: true, steps, warnings };
  }

  for (const segment of day.segments) {
    exportSegment(segment, steps, warnings, errors, band);
  }
  if (errors.length > 0) return { ok: false, errors };

  if (steps.length === 0) {
    return { ok: false, errors: [{ code: "EMPTY_WORKOUT", message: "Day has no exportable segments." }] };
  }

  return { ok: true, steps, warnings };
}
