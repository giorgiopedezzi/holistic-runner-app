/**
 * services/plan-instances.service.ts
 * Business logic for instantiating a plan template (HRA-112): runs the pure
 * domain instantiation (domain/runplan/instantiate.ts), then owns the DB
 * transaction that persists the resulting instance + its resolved days
 * (spans two repository calls, so it belongs above the repo layer — same
 * pattern as activities.service.ts).
 */
import type { DatabaseSync } from "node:sqlite";
import type { PlanInstanceDayRow, PlanInstanceRow } from "../db.ts";
import type { PlanInstanceDayInput, PlanInstancesRepo } from "../repositories/plan-instances.repo.ts";
import { instantiatePlan, type InstantiateOptions } from "../domain/runplan/instantiate.ts";
import type { RunPlan } from "../domain/runplan/types.ts";

export function createPlanInstancesService(db: DatabaseSync, instances: PlanInstancesRepo) {
  function instantiate(
    templateId: number, plan: RunPlan, options: InstantiateOptions, targetActivityId: number | null, name: string,
    raceName: string | null, raceDate: string | null, raceUrl: string | null,
  ): { instance: PlanInstanceRow; days: PlanInstanceDayRow[] } {
    const resolvedDays = instantiatePlan(plan, options);

    db.exec("BEGIN");
    try {
      const instance = instances.createInstance({
        template_id: templateId,
        start_date: options.startDate,
        pace_overrides: options.paceOverrides ? JSON.stringify(options.paceOverrides) : null,
        target_activity_id: targetActivityId,
        name,
        // Denormalized copy of the template's event at creation time
        // (docs/runplan-dsl-future-notes.md §6) — never independently set.
        event: plan.metadata.event ?? null,
        // HRA-121: the instance's own free-text race description —
        // independent of target_activity_id.
        race_name: raceName,
        race_date: raceDate,
        race_url: raceUrl,
      });
      for (const day of resolvedDays) {
        instances.createDay({
          instance_id: instance.id,
          section_name: day.section_name,
          week_number: day.week_number,
          date: day.date,
          day: day.day,
          suffix: day.suffix ?? null,
          category: day.category ?? null,
          workout_type: day.workout_type,
          segments: JSON.stringify(day.segments),
          activity_target: day.activity_target ? JSON.stringify(day.activity_target) : null,
          activity_description: day.activity_description ?? null,
          notes: day.notes ?? null,
          needs_review: day.needs_review ? 1 : 0,
        });
      }
      db.exec("COMMIT");
      return { instance, days: instances.daysByInstance(instance.id) };
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // PATCH /api/v1/plan-instances/:id (HRA-135, replacing the earlier PUT):
  // partial update of name/race_name/race_date/race_url — each provided
  // field replaces its current value, every omitted field stays untouched.
  // `days`, when provided, still fully replaces the day set (same semantics
  // the old PUT already had) — only the wrapper resource's own
  // method/partiality changed, not per-day patch semantics. Never touches or
  // re-instantiates the source template — an instance is an independent
  // artifact once created, and is allowed to diverge from what the template
  // would currently produce (docs/runplan-dsl-future-notes.md §7). `event`
  // stays read-only/derived, never part of this update. Clearing approved_at
  // is part of the same transaction: an edit that fails must not leave a
  // cleared approval with stale days/fields, or vice versa. The controller
  // guarantees at least one of fields/days is present before calling this.
  function patchInstance(
    instanceId: number,
    fields: Partial<{ name: string; race_name: string | null; race_date: string | null; race_url: string | null }>,
    days?: Omit<PlanInstanceDayInput, "instance_id">[],
  ): { instance: PlanInstanceRow; days: PlanInstanceDayRow[] } {
    db.exec("BEGIN");
    try {
      if (days) {
        instances.deleteDaysByInstance(instanceId);
        for (const day of days) {
          instances.createDay({ ...day, instance_id: instanceId });
        }
      }
      instances.updateFields(instanceId, fields);
      instances.clearApproval(instanceId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { instance: instances.instanceById(instanceId)!, days: instances.daysByInstance(instanceId) };
  }

  // HRA-132: regenerates a plan instance's days from `effectiveFrom` onward,
  // leaving every day before it completely untouched. `options` already
  // carries whichever of startDate/paceOverrides the caller changed, with
  // the instance's own current values substituted for whatever it didn't
  // (the controller resolves that merge before calling this) — so
  // instantiatePlan always runs against one coherent, fully-specified view.
  // Always regenerates from the *template's* DSL (via instantiatePlan), never
  // from the instance's own already-resolved days — those already discarded
  // each day's original symbolic anchor, so there's nothing to re-resolve
  // them from (see HRA-129/130's own notes on this same data-model gap).
  function regenerateFrom(
    instanceId: number, plan: RunPlan, options: InstantiateOptions, effectiveFrom: string,
  ): { instance: PlanInstanceRow; days: PlanInstanceDayRow[] } {
    const regeneratedDays = instantiatePlan(plan, options).filter(d => d.date >= effectiveFrom);

    db.exec("BEGIN");
    try {
      instances.deleteDaysFromDate(instanceId, effectiveFrom);
      for (const day of regeneratedDays) {
        instances.createDay({
          instance_id: instanceId,
          section_name: day.section_name,
          week_number: day.week_number,
          date: day.date,
          day: day.day,
          suffix: day.suffix ?? null,
          category: day.category ?? null,
          workout_type: day.workout_type,
          segments: JSON.stringify(day.segments),
          activity_target: day.activity_target ? JSON.stringify(day.activity_target) : null,
          activity_description: day.activity_description ?? null,
          notes: day.notes ?? null,
          needs_review: day.needs_review ? 1 : 0,
        });
      }
      instances.updateStartDateAndPaceOverrides(
        instanceId, options.startDate, options.paceOverrides ? JSON.stringify(options.paceOverrides) : null,
      );
      // Same gate-2 rule every other instance-mutating operation already
      // applies (updateDays above, the template PUT) — regenerating changes
      // persisted day content, exactly the class of edit that revokes
      // approval.
      instances.clearApproval(instanceId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { instance: instances.instanceById(instanceId)!, days: instances.daysByInstance(instanceId) };
  }

  return { instantiate, patchInstance, regenerateFrom };
}

export type PlanInstancesService = ReturnType<typeof createPlanInstancesService>;
