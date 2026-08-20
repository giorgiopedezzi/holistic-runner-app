// ── RunPlan DSL v1 — Zod schemas ────────────────────────────────────────────
// Mirrors types.ts. Used by the parser to validate the fully-built RunPlan
// before returning it (HRA-108 §20) — zod is a deliberate, confirmed exception
// to this backend's zero-runtime-dependency default (HRA-111).
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
export const intensitySchema = z.discriminatedUnion("kind", [
  anchorIntensitySchema, offsetIntensitySchema, absoluteIntensitySchema,
]);

export const distanceTargetSchema = z.object({ kind: z.literal("distance"), distance_m: z.number().positive(), raw: z.string() });
export const durationTargetSchema = z.object({ kind: z.literal("duration"), duration_sec: z.number().positive(), raw: z.string() });
export const targetSchema = z.discriminatedUnion("kind", [distanceTargetSchema, durationTargetSchema]);

export const restSpecSchema = z.object({
  target: targetSchema,
  intensity: intensitySchema.optional(),
  rest_type: restTypeSchema.optional(),
  raw: z.string(),
});

export const continuousSegmentSchema = z.object({
  type: z.literal("continuous"), target: targetSchema, intensity: intensitySchema, raw: z.string(),
});
// rest is required — HRA-111 amendment 1.
export const intervalSegmentSchema = z.object({
  type: z.literal("interval"), reps: z.number().int().positive(),
  work_target: targetSchema, work_intensity: intensitySchema, rest: restSpecSchema, raw: z.string(),
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

// day/week/section/plan validity fields — HRA-111 amendment 2.
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
  valid: z.boolean(),
  errors: z.array(parseErrorSchema),
});

export const weekSchema = z.object({
  number: z.number().int().positive(),
  start_date: z.string().optional(),
  notes: z.string().optional(),
  pace_policy: pacePolicySchema,
  days: z.array(dayEntrySchema),
  valid: z.boolean(),
  errors: z.array(parseErrorSchema),
});

export const sectionSchema = z.object({
  name: z.string(),
  week_spec: z.string(),
  notes: z.string().optional(),
  pace_policy: pacePolicySchema,
  weeks: z.array(weekSchema),
  valid: z.boolean(),
  errors: z.array(parseErrorSchema),
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
  valid: z.boolean(),
  errors: z.array(parseErrorSchema),
});
