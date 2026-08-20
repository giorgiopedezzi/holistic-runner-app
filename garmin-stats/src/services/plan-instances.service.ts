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
import type { PlanInstancesRepo } from "../repositories/plan-instances.repo.ts";
import { instantiatePlan, type InstantiateOptions } from "../domain/runplan/instantiate.ts";
import type { RunPlan } from "../domain/runplan/types.ts";

export function createPlanInstancesService(db: DatabaseSync, instances: PlanInstancesRepo) {
  function instantiate(
    templateId: number, plan: RunPlan, options: InstantiateOptions, targetActivityId: number | null,
  ): { instance: PlanInstanceRow; days: PlanInstanceDayRow[] } {
    const resolvedDays = instantiatePlan(plan, options);

    db.exec("BEGIN");
    try {
      const instance = instances.createInstance({
        template_id: templateId,
        start_date: options.startDate,
        pace_overrides: options.paceOverrides ? JSON.stringify(options.paceOverrides) : null,
        target_activity_id: targetActivityId,
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

  return { instantiate };
}

export type PlanInstancesService = ReturnType<typeof createPlanInstancesService>;
