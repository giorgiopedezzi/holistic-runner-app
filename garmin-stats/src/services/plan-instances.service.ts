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
import { isOriginalFrozen } from "../domain/plan-timezone.ts";

export function createPlanInstancesService(db: DatabaseSync, instances: PlanInstancesRepo) {
  // HRA-332: mirrors the instance's Current start_date/days into its
  // Original baseline columns, but only while Original isn't frozen yet —
  // a no-op once (today, in the instance's own schedule_timezone) has
  // reached original_start_date. Called at the end of every mutating
  // operation's transaction, after the Current-side writes, so Original
  // always reflects exactly what Current was at the moment freeze took
  // effect (AC6/AC7) with no scheduler involved.
  function syncOriginalIfNotFrozen(instanceId: number): void {
    const instance = instances.instanceById(instanceId);
    if (!instance || !instance.schedule_timezone || !instance.original_start_date) return;
    if (isOriginalFrozen(instance.original_start_date, instance.schedule_timezone)) return;
    instances.updateOriginal(instanceId, instance.start_date, JSON.stringify(instances.daysByInstance(instanceId)));
  }

  function instantiate(
    templateId: number, plan: RunPlan, options: InstantiateOptions, targetActivityId: number | null, name: string,
    raceName: string | null, raceDate: string | null, raceUrl: string | null, scheduleTimezone: string,
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
        // HRA-332: Original mirrors Current at creation unconditionally
        // (there is no prior Original to protect yet) — original_days_snapshot
        // is filled in below once the days themselves exist.
        schedule_timezone: scheduleTimezone,
        original_start_date: options.startDate,
        original_days_snapshot: null,
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
          // HRA-149: never backfilled at creation — NULL reads as the 08:00
          // display default until explicitly set via the per-day PATCH.
          scheduled_time: null,
          // HRA-299: a freshly instantiated day has never been individually
          // edited or swapped.
          customized_at: null,
        });
      }
      // HRA-332: the initial Original snapshot, now that the days actually
      // exist — an instance whose start_date is already in the past is
      // frozen from this very write onward (syncOriginalIfNotFrozen isn't
      // used here: creation always establishes Original once, unconditionally).
      instances.updateOriginal(instance.id, options.startDate, JSON.stringify(instances.daysByInstance(instance.id)));
      db.exec("COMMIT");
      return { instance: instances.instanceById(instance.id)!, days: instances.daysByInstance(instance.id) };
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
    // HRA-332: already validated (IANA format) and freeze-checked by the
    // controller before this is called — the controller has the instance
    // loaded anyway to build the freeze check's own error message.
    scheduleTimezone?: string,
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
      if (scheduleTimezone) instances.updateScheduleTimezone(instanceId, scheduleTimezone);
      instances.clearApproval(instanceId);
      // HRA-332: mirrors the (possibly just-replaced) days and/or the
      // just-corrected timezone into Original — a no-op once frozen.
      syncOriginalIfNotFrozen(instanceId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { instance: instances.instanceById(instanceId)!, days: instances.daysByInstance(instanceId) };
  }

  // PATCH /api/v1/plan-instances/:id/days/:dayId (HRA-149): each of dsl,
  // notes, scheduled_time is applied independently — the controller has
  // already re-parsed+resolved `dsl` (if supplied) into `dslFields`, and
  // resolved which of `notes`/`scheduledTime` the caller actually supplied
  // (undefined = omitted, distinct from an explicit null clearing a nullable
  // column). An explicit `notes` always wins over whatever the fresh dsl
  // parse produced for that same field. No approval-clearing here — the
  // controller rejects the whole request before this runs if the instance is
  // already approved (mirrors HRA-126's intended lock rule), so there is
  // nothing to clear.
  function patchDay(
    dayId: number,
    dslFields: { day: number; suffix: string | null; category: string | null; workout_type: string; segments: string; activity_target: string | null; activity_description: string | null; notes: string | null; needs_review: number } | undefined,
    notes: string | null | undefined,
    scheduledTime: string | null | undefined,
  ): PlanInstanceDayRow {
    const instanceId = instances.dayById(dayId)!.instance_id;
    db.exec("BEGIN");
    try {
      if (dslFields) {
        instances.updateDayFromDsl(dayId, { ...dslFields, notes: notes !== undefined ? notes : dslFields.notes });
        // HRA-299: a dsl write is "an instantiated workout DSL saved" — the
        // Story's own trigger for the customization marker. Notes-only or
        // scheduled-time-only patches (the branches below/after this one)
        // don't touch the day's actual workout content, so they never set it.
        instances.markDayCustomized(dayId);
      } else if (notes !== undefined) {
        instances.updateDayNotes(dayId, notes);
      }
      if (scheduledTime !== undefined) {
        instances.updateDayScheduledTime(dayId, scheduledTime);
      }
      // HRA-332: mirrors this day's change into Original — a no-op once frozen.
      syncOriginalIfNotFrozen(instanceId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return instances.dayById(dayId)!;
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
      // HRA-155: delete each regenerated day's previous row by identity
      // (section_name/week_number/day), not by a date threshold — see
      // deleteDayByIdentity's own comment in the repo for why a raw date
      // comparison breaks once start_date changes in this same call. Every
      // day in `regeneratedDays` already passed the `date >= effectiveFrom`
      // filter above using its FRESH date, so this only ever touches days
      // actually being regenerated; a day whose fresh date falls before the
      // cutover is excluded from `regeneratedDays` entirely and its old row
      // (whatever identity) is left completely untouched, preserving the
      // "protects already-logged history" guarantee.
      for (const day of regeneratedDays) {
        instances.deleteDayByIdentity(instanceId, day.section_name, day.week_number, day.day);
      }
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
          // HRA-149: never backfilled at creation — NULL reads as the 08:00
          // display default until explicitly set via the per-day PATCH.
          scheduled_time: null,
          // HRA-299: regeneration always recreates the row from scratch —
          // a day just regenerated from the template's own DSL has no
          // customization of its own, regardless of what the row it
          // replaces carried (the preflight below is what protects a
          // customized day from reaching this point without confirmation).
          customized_at: null,
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
      // HRA-332: mirrors the regenerated days + new start_date into
      // Original — a no-op once frozen.
      syncOriginalIfNotFrozen(instanceId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { instance: instances.instanceById(instanceId)!, days: instances.daysByInstance(instanceId) };
  }

  return { instantiate, patchInstance, patchDay, regenerateFrom };
}

export type PlanInstancesService = ReturnType<typeof createPlanInstancesService>;
