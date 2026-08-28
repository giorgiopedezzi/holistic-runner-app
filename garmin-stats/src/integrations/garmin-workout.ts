// ── Garmin Workout FIT export — integration boundary ────────────────────────
// HRA-184: the only file in this repo that imports @garmin/fitsdk for the
// Workout export path (docs/architecture/FIT-TRANSLATION-LAYER-ADR.md §5.3).
// Wraps the pure domain transform (domain/garmin-workout/export.ts) and does
// the exact FIT wire-scale conversion, verified against the installed
// @garmin/fitsdk 21.214.0 profile.js (mesgNum 27 "workoutStep"):
//   - durationValue: "durationDistance" subfield scale 100 units/m (cm);
//     "durationTime" subfield scale 1000 units/s (ms). The base field itself
//     has scale 1, so @garmin/fitsdk applies no automatic scaling here — this
//     file must pre-scale the raw integer itself.
//   - customTargetValueLow/High: "customTargetSpeedLow/High" subfield scale
//     1000 units/(m/s). Same reasoning — pre-scaled here, not by the SDK.
//   - repeatUntilStepsCmplt: durationValue holds the messageIndex to loop
//     back to (subfield "durationStep", scale 1); targetValue holds the
//     repeat count (subfield "repeatSteps", scale 1).
// @garmin/fitsdk's MesgDefinition only matches a message's own top-level
// field names (mesgProfile.fields[*].name) — subfield names like
// "customTargetSpeedLow" are a decode-time-only convenience and are silently
// dropped if used as a write key, so every writeMesg() call below uses the
// base field name (durationValue/targetValue/customTargetValueLow/...).
import { Decoder, Encoder, Profile, Stream } from "@garmin/fitsdk";
import type { ResolvedDay } from "../domain/runplan/instantiate.ts";
import { resolvedDayToGarminSteps } from "../domain/garmin-workout/export.ts";
import { garminStepsToImportPreview } from "../domain/garmin-workout/import.ts";
import { PACE_ALERT_BAND_POLICY } from "../domain/garmin-workout/types.ts";
import type {
  GarminExportError,
  GarminExportWarning,
  GarminStepDurationType,
  GarminStepIntensity,
  GarminStepTargetType,
  GarminWorkoutImportOutcome,
  GarminWorkoutStep,
  PaceBandPolicy,
} from "../domain/garmin-workout/types.ts";

const DISTANCE_WIRE_UNITS_PER_METER = 100;
const DURATION_WIRE_UNITS_PER_SECOND = 1000;
const SPEED_WIRE_UNITS_PER_MPS = 1000;

export type GarminWorkoutExportOutcome =
  | { ok: true; bytes: Buffer; warnings: GarminExportWarning[] }
  | { ok: false; errors: GarminExportError[] };

function toWireStep(step: GarminWorkoutStep): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    messageIndex: step.messageIndex,
    durationType: step.durationType,
    targetType: step.targetType,
  };
  if (step.intensity != null) wire.intensity = step.intensity;
  if (step.name != null) wire.wktStepName = step.name;

  if (step.durationType === "distance" && step.durationMeters != null) {
    wire.durationValue = Math.round(step.durationMeters * DISTANCE_WIRE_UNITS_PER_METER);
  } else if (step.durationType === "time" && step.durationSeconds != null) {
    wire.durationValue = Math.round(step.durationSeconds * DURATION_WIRE_UNITS_PER_SECOND);
  } else if (step.durationType === "repeatUntilStepsCmplt") {
    wire.durationValue = step.repeatFromMessageIndex;
    wire.targetValue = step.repeatCount;
  }

  if (step.targetType === "speed") {
    wire.customTargetValueLow = Math.round((step.targetLowSpeedMps ?? 0) * SPEED_WIRE_UNITS_PER_MPS);
    wire.customTargetValueHigh = Math.round((step.targetHighSpeedMps ?? 0) * SPEED_WIRE_UNITS_PER_MPS);
  }

  return wire;
}

export function toGarminWorkoutFit(day: ResolvedDay, band: PaceBandPolicy = PACE_ALERT_BAND_POLICY): GarminWorkoutExportOutcome {
  const result = resolvedDayToGarminSteps(day, band);
  if (!result.ok) return result;

  const encoder = new Encoder();
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "workout",
    manufacturer: "development",
    product: 1,
    // Deterministic by construction (HRA-184 AC): derived from the resolved
    // day's own calendar date rather than the wall clock, so exporting the
    // same ResolvedDay twice produces byte-identical output.
    timeCreated: new Date(`${day.date}T00:00:00Z`),
  });
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.WORKOUT,
    wktName: day.activity_description ?? "Run",
    sport: "running",
    numValidSteps: result.steps.length,
  });
  for (const step of result.steps) {
    encoder.writeMesg({ mesgNum: Profile.MesgNum.WORKOUT_STEP, ...toWireStep(step) });
  }

  return { ok: true, bytes: Buffer.from(encoder.close()), warnings: result.warnings };
}

// Re-decodes bytes produced by toGarminWorkoutFit — tests use this to assert
// against the decoded profile fields rather than the write-side objects, so a
// silently dropped or misspelled SDK field name fails verification (HRA-184
// AC) instead of passing on the strength of the encoder call alone.
export function decodeGarminWorkoutFit(bytes: Buffer): { messages: Record<string, unknown[]>; errors: unknown[] } {
  const { messages, errors } = new Decoder(Stream.fromBuffer(bytes)).read();
  return { messages: messages as Record<string, unknown[]>, errors };
}

// HRA-185: decoded workoutStepMesgs use @garmin/fitsdk's auto-expanded
// subfield names (durationDistance/durationTime/durationStep/repeatSteps/
// customTargetSpeedLow/High — already real units, see the header note) rather
// than the raw wire ints toWireStep() writes, so this is the inverse of that
// function at the field-name level, not a literal mirror of it.
interface DecodedWorkoutStepMesg {
  messageIndex?: number;
  durationType?: string;
  durationDistance?: number;
  durationTime?: number;
  durationStep?: number;
  targetType?: string;
  repeatSteps?: number;
  customTargetSpeedLow?: number;
  customTargetSpeedHigh?: number;
  intensity?: string;
  wktStepName?: string;
}

function toDomainStep(decoded: DecodedWorkoutStepMesg): GarminWorkoutStep | null {
  if (decoded.messageIndex == null || decoded.durationType == null || decoded.targetType == null) return null;

  return {
    messageIndex: decoded.messageIndex,
    intensity: decoded.intensity as GarminStepIntensity | undefined,
    durationType: decoded.durationType as GarminStepDurationType,
    durationMeters: decoded.durationType === "distance" ? decoded.durationDistance : undefined,
    durationSeconds: decoded.durationType === "time" ? decoded.durationTime : undefined,
    repeatFromMessageIndex: decoded.durationType === "repeatUntilStepsCmplt" ? decoded.durationStep : undefined,
    repeatCount: decoded.durationType === "repeatUntilStepsCmplt" ? decoded.repeatSteps : undefined,
    targetType: decoded.targetType as GarminStepTargetType,
    targetLowSpeedMps: decoded.targetType === "speed" ? decoded.customTargetSpeedLow : undefined,
    targetHighSpeedMps: decoded.targetType === "speed" ? decoded.customTargetSpeedHigh : undefined,
    name: decoded.wktStepName,
  };
}

export function fromGarminWorkoutFit(bytes: Buffer): GarminWorkoutImportOutcome {
  let messages: Record<string, unknown[]>;
  let errors: unknown[];
  try {
    ({ messages, errors } = new Decoder(Stream.fromBuffer(bytes)).read() as { messages: Record<string, unknown[]>; errors: unknown[] });
  } catch (err) {
    return { ok: false, error: { code: "DECODE_ERROR", message: `FIT decode threw: ${String(err)}` } };
  }
  if (errors.length > 0) {
    return { ok: false, error: { code: "DECODE_ERROR", message: `FIT decode reported ${errors.length} error(s).` } };
  }

  const fileId = (messages.fileIdMesgs as Array<{ type?: string }> | undefined)?.[0];
  if (fileId == null) return { ok: false, error: { code: "MISSING_FILE_ID", message: "FIT file has no File Id message." } };
  if (fileId.type !== "workout") {
    return { ok: false, error: { code: "NOT_A_WORKOUT_FILE", message: `File Id type is "${fileId.type}", not "workout".` } };
  }

  const workout = (messages.workoutMesgs as unknown[] | undefined)?.[0];
  if (workout == null) return { ok: false, error: { code: "MISSING_WORKOUT_MESSAGE", message: "FIT file has no Workout message." } };

  const stepMesgs = (messages.workoutStepMesgs as DecodedWorkoutStepMesg[] | undefined) ?? [];
  if (stepMesgs.length === 0) {
    return { ok: false, error: { code: "MISSING_WORKOUT_STEPS", message: "FIT file has no Workout Step messages." } };
  }

  const steps: GarminWorkoutStep[] = [];
  for (const decoded of stepMesgs) {
    const step = toDomainStep(decoded);
    if (step == null) {
      return { ok: false, error: { code: "MISSING_WORKOUT_STEPS", message: "A Workout Step message is missing required fields." } };
    }
    steps.push(step);
  }

  return { ok: true, preview: garminStepsToImportPreview(steps) };
}
