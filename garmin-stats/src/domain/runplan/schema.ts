// ── RunPlan DSL v1 — Zod schemas ────────────────────────────────────────────
// Mirrors types.ts. Used by the parser to validate the fully-built RunPlan
// before returning it (HRA-108 §20) — zod is a deliberate, confirmed exception
// to this backend's zero-runtime-dependency default (HRA-111). HRA-113: a
// mismatch here is now treated as an internal bug (parser.ts throws), not
// user-facing feedback — see the note in parser.ts.
import { z } from "zod";

export const displayUnitSchema = z.enum(["km", "mi"]);
export const offsetUnitSchema = z.enum(["s/km", "s/mi"]);
export const restTypeSchema = z.enum(["stand", "walk", "jog"]);
export const eventTypeSchema = z.enum(["5k", "10k", "half", "marathon", "ultra", "custom"]);

export const absolutePaceSchema = z.object({
  kind: z.literal("absolute"),
  pace_sec_per_km: z.number(),
});
export const offsetPaceSchema = z.object({
  kind: z.literal("offset"),
  anchor: z.string(),
  offset_sec_per_km: z.number(),
});
export const paceValueSchema = z.discriminatedUnion("kind", [absolutePaceSchema, offsetPaceSchema]);
export const pacePolicySchema = z.record(z.string(), paceValueSchema);

export const anchorIntensitySchema = z.object({ kind: z.literal("anchor"), anchor: z.string(), raw: z.string() });
export const offsetIntensitySchema = z.object({
  kind: z.literal("offset"), anchor: z.string(), offset_sec_per_km: z.number(), raw: z.string(),
});
export const absoluteIntensitySchema = z.object({
  kind: z.literal("absolute"), pace_sec_per_km: z.number(), raw: z.string(),
});
// unknown (HRA-113): a literal `?` placeholder or otherwise-unrecognized token.
export const unknownIntensitySchema = z.object({ kind: z.literal("unknown"), raw: z.string() });
export const intensitySchema = z.discriminatedUnion("kind", [
  anchorIntensitySchema, offsetIntensitySchema, absoluteIntensitySchema, unknownIntensitySchema,
]);

export const distanceTargetSchema = z.object({ kind: z.literal("distance"), distance_m: z.number().positive(), raw: z.string() });
export const durationTargetSchema = z.object({ kind: z.literal("duration"), duration_sec: z.number().positive(), raw: z.string() });
// unknown (HRA-113): same placeholder concept, for Target position.
export const unknownTargetSchema = z.object({ kind: z.literal("unknown"), raw: z.string() });
export const targetSchema = z.discriminatedUnion("kind", [distanceTargetSchema, durationTargetSchema, unknownTargetSchema]);

export const restSpecSchema = z.object({
  target: targetSchema,
  intensity: intensitySchema.optional(),
  rest_type: restTypeSchema.optional(),
  raw: z.string(),
});

export const continuousSegmentSchema = z.object({
  type: z.literal("continuous"), target: targetSchema, intensity: intensitySchema, raw: z.string(),
});
// rest is optional again (HRA-113 reverses HRA-111 amendment 1 — nothing is a
// hard error anymore). reps is nullable: null = the `?` placeholder.
export const intervalSegmentSchema = z.object({
  type: z.literal("interval"), reps: z.number().int().positive().nullable(),
  work_target: targetSchema, work_intensity: intensitySchema, rest: restSpecSchema.optional(), raw: z.string(),
});
export const progressionSegmentSchema = z.object({
  type: z.literal("progression"), target: targetSchema,
  start_intensity: intensitySchema, end_intensity: intensitySchema, raw: z.string(),
});
export const restBlockSegmentSchema = z.object({
  type: z.literal("rest_block"), target: targetSchema, rest_type: restTypeSchema.optional(), raw: z.string(),
});
export const workoutSegmentSchema = z.discriminatedUnion("type", [
  continuousSegmentSchema, intervalSegmentSchema, progressionSegmentSchema, restBlockSegmentSchema,
]);

export const parseErrorSchema = z.object({
  line: z.number(), content: z.string(), message: z.string(), suggestion: z.string().optional(),
});
export const parseWarningSchema = z.object({
  line: z.number(), content: z.string(), message: z.string(),
});

// day/week/section/plan validity fields (HRA-111 amendment 2) are removed —
// HRA-113: nothing produces a hard error anymore, so `valid`/`errors` no
// longer mean anything at this level. DayEntry.warnings replaces them.
export const dayEntrySchema = z.object({
  day: z.number().int(),
  suffix: z.string().optional(),
  category: z.string().optional(),
  workout_type: z.enum(["run", "rest", "todo", "cross", "strength"]),
  segments: z.array(workoutSegmentSchema),
  activity_target: targetSchema.optional(),
  activity_description: z.string().optional(),
  notes: z.string().optional(),
  needs_review: z.boolean(),
  raw_dsl: z.string(),
  warnings: z.array(parseWarningSchema),
});

export const weekSchema = z.object({
  number: z.number().int().positive(),
  start_date: z.string().optional(),
  notes: z.string().optional(),
  pace_policy: pacePolicySchema,
  days: z.array(dayEntrySchema),
});

export const sectionSchema = z.object({
  name: z.string(),
  week_spec: z.string(),
  notes: z.string().optional(),
  pace_policy: pacePolicySchema,
  weeks: z.array(weekSchema),
});

export const planMetadataSchema = z.object({
  name: z.string().optional(),
  event: eventTypeSchema.optional(),
  distance_m: z.number().positive().optional(),
  goal_time_sec: z.number().positive().optional(),
  start_date: z.string().optional(),
  unit: displayUnitSchema,
  offset_unit: offsetUnitSchema,
  default_rest: restTypeSchema,
  pace_policy: pacePolicySchema,
});

export const runPlanSchema = z.object({
  metadata: planMetadataSchema,
  sections: z.array(sectionSchema),
});
