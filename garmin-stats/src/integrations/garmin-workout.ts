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
//   - targetValue (field 4) subfield "targetSpeedZone": "speed zone (1-10);
//     Custom = 0" (profile.js line ~17902). A speed step that uses a custom
//     low/high band (fields 5/6) rather than a predefined zone MUST still
//     write targetValue = 0 — @garmin/fitsdk's encoder omits any field whose
//     value is undefined from the message definition entirely (see
//     mesg-definition.js's `Object.keys(mesg).forEach` / `== null` guard), so
//     leaving targetValue unset does not decode back as "Custom", it decodes
//     as the field being entirely absent. The SDK's own round-trip decode
//     doesn't care (it only reads the fields that were written), which is why
//     this shipped and passed HRA-184's tests — but real device firmware
//     (confirmed on a Forerunner 965, HRA-392) requires the explicit 0 to
//     recognize the custom pace band at all; without it the watch shows the
//     step with no target.
//   - repeatUntilStepsCmplt: durationValue holds the messageIndex to loop
//     back to (subfield "durationStep", scale 1); targetValue holds the
//     repeat count (subfield "repeatSteps", scale 1).
// @garmin/fitsdk's MesgDefinition only matches a message's own top-level
// field names (mesgProfile.fields[*].name) — subfield names like
// "customTargetSpeedLow" are a decode-time-only convenience and are silently
// dropped if used as a write key, so every writeMesg() call below uses the
// base field name (durationValue/targetValue/customTargetValueLow/...).
//
// HRA-392: scheduling packaging. HRA-390 embedded a `schedule` message
// (mesgNum 28) inside the `workout`-type FIT file produced by
// toGarminWorkoutFit. That round-trips fine through this SDK's own
// decoder, but a real Forerunner 965 never places the file on the Training
// Calendar — because per profile.js's `file` type enum (line ~23448),
// Garmin's own device firmware reads scheduling from a *separate* FIT file
// whose File Id type is `schedules` (enum 7, "Read/write, single file.
// Directory=Schedules"), not from a `schedule` message riding inside a
// `workout`-type file. toGarminSchedulesFit() below produces that dedicated
// file; each `schedule` message's manufacturer/product/timeCreated must
// match the paired workout file's own File Id identity (profile.js's field
// comments on schedule fields 0/1/3: "Corresponds to file_id of scheduled
// workout / course") so the device can resolve which file the entry
// schedules — toGarminWorkoutFit's own File Id no longer carries an embedded
// schedule message, only its identity is reused by the caller when building
// the paired schedules file (see controllers/plan-templates.controller.ts).
import { Decoder, Encoder, Profile, Stream, Utils } from "@garmin/fitsdk";
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

// HRA-390/HRA-392: shared File Id identity across every workout and
// schedules file this module produces, so a schedule entry's
// manufacturer/product match the workout file it schedules.
const FILE_MANUFACTURER = "development";
const FILE_PRODUCT = 1;

// @garmin/fitsdk's own .d.ts re-exports every submodule via extensionless
// relative specifiers (e.g. `export * from './types/utils'`), which NodeNext
// module resolution can't resolve for an ESM package — the same gap this
// file already works around for Decoder/Encoder/Profile/Stream by treating
// their surface as loosely typed. `Utils`'s members come through as
// `unknown` rather than `any`, so a narrow local cast is needed to call it.
const convertDateToDateTime = Utils.convertDateToDateTime as (date: Date) => number;
const convertDateTimeToDate = Utils.convertDateTimeToDate as (datetime: number) => Date;

// Decodes a Schedule message's raw `scheduledTime` (FIT epoch seconds, see
// the cast above) back to a JS Date — exported so callers/tests reading a
// decoded Schedule message don't need their own cast against fitsdk's Utils.
export function scheduledTimeToDate(scheduledTime: number): Date {
  return convertDateTimeToDate(scheduledTime);
}

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
    // Custom (not a predefined speed zone) — see header note on field 4's
    // "targetSpeedZone" subfield. Required for the device to recognize the
    // custom low/high band below as an active target at all.
    wire.targetValue = 0;
    wire.customTargetValueLow = Math.round((step.targetLowSpeedMps ?? 0) * SPEED_WIRE_UNITS_PER_MPS);
    wire.customTargetValueHigh = Math.round((step.targetHighSpeedMps ?? 0) * SPEED_WIRE_UNITS_PER_MPS);
  }

  return wire;
}

// Deterministic by construction (HRA-184 AC): derived from the plan day's own
// calendar date rather than the wall clock, so exporting the same day twice
// produces byte-identical output. Shared by toGarminWorkoutFit (as this file
// FILE_ID's own timeCreated) and toGarminSchedulesFit (as the identity a
// schedule entry must match to resolve which workout file it schedules).
function planDayDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function toGarminWorkoutFit(day: ResolvedDay, band: PaceBandPolicy = PACE_ALERT_BAND_POLICY): GarminWorkoutExportOutcome {
  const result = resolvedDayToGarminSteps(day, band);
  if (!result.ok) return result;

  const encoder = new Encoder();
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "workout",
    manufacturer: FILE_MANUFACTURER,
    product: FILE_PRODUCT,
    timeCreated: planDayDate(day.date),
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

// HRA-392: the dedicated Schedules-type FIT file a Forerunner 965 actually
// reads for the Training Calendar (see header note) — one physical device
// file (profile.js: file type 7 "schedules", "Read/write, single file"), so
// a week export produces exactly one of these covering every included day
// rather than one per day. Each entry's manufacturer/product/timeCreated
// must equal the paired toGarminWorkoutFit() File Id for that same date, so
// the device can resolve which workout file the entry schedules. Rejects an
// empty list rather than emitting a File Id-only file with no entries, since
// callers only ever call this once they have at least one exportable day.
export function toGarminSchedulesFit(planDayDates: string[]): Buffer {
  if (planDayDates.length === 0) throw new Error("toGarminSchedulesFit requires at least one plan day date.");

  const encoder = new Encoder();
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "schedules",
    manufacturer: FILE_MANUFACTURER,
    product: FILE_PRODUCT,
    timeCreated: planDayDate(planDayDates[0]),
  });
  for (const isoDate of planDayDates) {
    const date = planDayDate(isoDate);
    // scheduledTime is a "localDateTime" field — unlike FILE_ID.timeCreated's
    // "dateTime" type, the encoder does not accept a Date object for it
    // (throws), so it must be pre-converted to the raw FIT epoch integer.
    encoder.writeMesg({
      mesgNum: Profile.MesgNum.SCHEDULE,
      manufacturer: FILE_MANUFACTURER,
      product: FILE_PRODUCT,
      timeCreated: date,
      type: "workout",
      completed: 0,
      scheduledTime: convertDateToDateTime(date),
    });
  }

  return Buffer.from(encoder.close());
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
