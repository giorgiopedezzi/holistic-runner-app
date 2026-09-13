// ── RunPlan DSL v1 — Original-to-Current lineage (HRA-333) ──────────────────
// Pure, no I/O: classifies every planned workout (matched by workout_id,
// workout-identity.ts) across an instance's Original baseline and its
// Current state. Consumed by a future report Story (Epic HRA-331) — this
// Story only owns the classification itself, not any endpoint or UI.
import type { PlanInstanceDayRow } from "../../db.ts";

export type WorkoutLineageStatus = "unchanged" | "moved" | "modified" | "moved_and_modified" | "removed" | "added";

// One day inside plan_instances.original_days_snapshot — the same shape as
// plan_instance_days minus id/instance_id (docs/schema.md), now always
// carrying workout_id too (HRA-333's migration backfills it onto every
// existing snapshot).
export type OriginalDaySnapshot = Omit<PlanInstanceDayRow, "id" | "instance_id">;

export interface WorkoutLineageEntry {
  workout_id: string;
  status: WorkoutLineageStatus;
  original: OriginalDaySnapshot | null;
  current: PlanInstanceDayRow | null;
}

interface PlacementFields {
  section_name: string;
  week_number: number;
  day: number;
}

interface ContentFields {
  workout_type: string;
  day: number;
  suffix: string | null;
  category: string | null;
  segments: string;
  activity_target: string | null;
  activity_description: string | null;
  notes: string | null;
}

// The workout's *meaning*, not its storage encoding — parses segments/
// activity_target (both persisted as JSON strings) into structural values so
// a cosmetic serialization difference (e.g. incidental key order from a
// re-stringify) never registers as a content change. Deliberately excludes
// placement (section_name/week_number/date), display-only bookkeeping
// (scheduled_time, needs_review, customized_at), and workout_id itself.
function canonicalContent(day: ContentFields) {
  return {
    workout_type: day.workout_type,
    day: day.day,
    suffix: day.suffix,
    category: day.category,
    segments: JSON.parse(day.segments) as unknown,
    activity_target: day.activity_target ? (JSON.parse(day.activity_target) as unknown) : null,
    activity_description: day.activity_description,
    notes: day.notes,
  };
}

// Exported for domain/plan-revision.ts's own no-op detection — the same
// "compare parsed structural content, not JSON text" reasoning applies there.
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aEntries = Object.entries(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aEntries.length !== bKeys.length) return false;
  return aEntries.every(([key, value]) => deepEqual(value, (b as Record<string, unknown>)[key]));
}

// A workout is "moved" when its structural slot (section/week/day-of-week)
// changed — not merely its absolute calendar `date`, which shifts for every
// UNMOVED workout whenever the instance's own start_date changes (a plain
// regenerate or a schedule correction). Comparing `date` directly was
// considered and rejected: it would mark every workout in the plan "moved"
// on a start-date shift alone, even though none of them moved relative to
// the plan's own section/week/day structure — exactly the false positive
// AC7/AC9 rule out.
function isMoved(original: PlacementFields, current: PlacementFields): boolean {
  return original.section_name !== current.section_name
    || original.week_number !== current.week_number
    || original.day !== current.day;
}

function isModified(original: ContentFields, current: ContentFields): boolean {
  return !deepEqual(canonicalContent(original), canonicalContent(current));
}

export function classifyWorkoutLineage(
  originalDays: OriginalDaySnapshot[], currentDays: PlanInstanceDayRow[],
): WorkoutLineageEntry[] {
  const originalById = new Map(originalDays.map(d => [d.workout_id, d]));
  const currentById = new Map(currentDays.map(d => [d.workout_id, d]));
  const allWorkoutIds = new Set([...originalById.keys(), ...currentById.keys()]);

  return [...allWorkoutIds].map((workoutId): WorkoutLineageEntry => {
    const original = originalById.get(workoutId) ?? null;
    const current = currentById.get(workoutId) ?? null;

    if (original && current) {
      const moved = isMoved(original, current);
      const modified = isModified(original, current);
      const status: WorkoutLineageStatus =
        moved && modified ? "moved_and_modified" : moved ? "moved" : modified ? "modified" : "unchanged";
      return { workout_id: workoutId, status, original, current };
    }
    // Present only in Original: removed from Current since freeze, but
    // still reportable (AC5) — this entry's `original` is the whole record.
    if (original) return { workout_id: workoutId, status: "removed", original, current: null };
    // Present only in Current: has no Original counterpart (AC5) — either
    // added after the plan started, or Original was never frozen yet and
    // simply hasn't mirrored this workout in (caller's responsibility to
    // only classify a frozen instance if "added" should mean "post-start").
    return { workout_id: workoutId, status: "added", original: null, current };
  });
}
