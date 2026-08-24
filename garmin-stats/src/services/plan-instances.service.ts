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

  // Full replacement of an instance's name + resolved days (HRA-113 PUT
  // /api/v1/plan-instances/:id, extended HRA-114 with `name`). Never touches
  // or re-instantiates the source template — an instance is an independent
  // artifact once created, and is allowed to diverge from what the template
  // would currently produce (docs/runplan-dsl-future-notes.md §7). `event`
  // stays read-only/derived, never part of this replacement. Clearing
  // approved_at is part of the same transaction: an edit that fails must not
  // leave a cleared approval with stale days/name, or vice versa.
  function updateDays(
    instanceId: number, name: string, days: Omit<PlanInstanceDayInput, "instance_id">[],
  ): { instance: PlanInstanceRow; days: PlanInstanceDayRow[] } {
    db.exec("BEGIN");
    try {
      instances.deleteDaysByInstance(instanceId);
      for (const day of days) {
        instances.createDay({ ...day, instance_id: instanceId });
      }
      instances.updateName(instanceId, name);
      instances.clearApproval(instanceId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { instance: instances.instanceById(instanceId)!, days: instances.daysByInstance(instanceId) };
  }

  return { instantiate, updateDays };
}

export type PlanInstancesService = ReturnType<typeof createPlanInstancesService>;
