// ── RunPlan DSL v1 — planned-workout identity (HRA-333) ─────────────────────
// A plan_instance_days row's stable identity is independent of its DB
// primary key: the primary key is bound to a physical row/slot (an UPDATE
// keeps it, a delete+recreate does not), while workout_id is meant to travel
// with the *planned session itself* — e.g. a day swap exchanges two rows'
// content, and the workout_id must move along with that content so the
// session that was "Monday's easy run" is still recognized as the same
// workout once it's Wednesday's. Pure, no I/O — mirrors this project's
// domain/ convention.
import { randomUUID } from "node:crypto";

export function newWorkoutId(): string {
  return randomUUID();
}
