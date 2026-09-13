// ── Shared reporting domain — scope membership (HRA-335, AC6/AC7) ──────────
// Pure, no I/O. Builds directly on the already-approved HRA-333 lineage
// classifier rather than re-deriving Original-vs-Current matching: a
// workout's Original/Current placement dates are exactly what
// classifyWorkoutLineage already resolves per workout_id, so scope
// membership only needs to ask "is this placement's date inside the
// caller's own range predicate" — never a second independent date match.
import type { AssociationStatus } from "../../db.ts";
import { classifyWorkoutLineage, type OriginalDaySnapshot } from "../runplan/lineage.ts";
import type { PlanInstanceDayRow } from "../../db.ts";
import { localDateInTimeZone } from "../plan-timezone.ts";
import type { AcceptedEvidence, ActualPopulation, BoundaryMovement, ScopedWorkout } from "./types.ts";

// AC6: Original and Current each use their OWN relevant scheduled placement
// (never one substituting for the other — mirrors AC5's comparison rule at
// the membership level); `isInRange` is the caller's own range predicate
// (e.g. "plan-to-date cutoff", or one week's date span) so this function
// stays generic across every grouping the request can ask for.
export function classifyScopeBoundary(
  originalDays: OriginalDaySnapshot[],
  currentDays: PlanInstanceDayRow[],
  isInRange: (date: string) => boolean,
): ScopedWorkout[] {
  const lineage = classifyWorkoutLineage(originalDays, currentDays);
  return lineage.map((entry): ScopedWorkout => {
    const originalInRange = entry.original != null && isInRange(entry.original.date);
    const currentInRange = entry.current != null && isInRange(entry.current.date);
    let boundaryMovement: BoundaryMovement;
    if (originalInRange && !currentInRange) boundaryMovement = "moved_out";
    else if (!originalInRange && currentInRange) boundaryMovement = "moved_in";
    else if (originalInRange && currentInRange) boundaryMovement = "stable";
    else boundaryMovement = "not_applicable";
    return { workout_id: entry.workout_id, lineage: entry.status, originalInRange, currentInRange, boundaryMovement };
  });
}

// The accepted set (AC11's "trusted" evidence) — 'unresolved' is deliberately
// excluded here (see classifyActualPopulation below), matching docs/schema.md's
// own "only manual_confirmed/manual_changed/automatic count as accepted".
// Exported so workout-report.ts (HRA-336) can apply the exact same trust
// boundary at single-workout granularity rather than re-deriving it.
export const ACCEPTED_STATUSES: AssociationStatus[] = ["automatic", "manual_confirmed", "manual_changed"];

export interface AssociationLookup {
  activity_id: number;
  workout_id: string | null;
  status: AssociationStatus;
}

export interface ActualActivityInput {
  activity_id: number;
  activity_date: string; // activities.activity_date — converted here via schedule_timezone (AC3), never activities.date_only
}

// AC6/AC7/AC10/AC11: partitions every candidate activity into accepted
// (trusted plan evidence), ambiguous (workout_id may still be set, but
// 'unresolved' — visible in coverage, never in a trusted total), and extra
// (no accepted plan link at all — a distinct Actual-only population, AC7).
// `associations` is keyed by activity_id — an activity absent from it has
// never been evaluated at all, which is the same "extra/unplanned" steady
// state as an explicit workout_id=NULL row (docs/schema.md's own framing for
// GET .../association: "all null... a legitimate extra/unplanned state").
export function classifyActualPopulation(
  activities: ActualActivityInput[],
  associations: Map<number, AssociationLookup>,
  timeZone: string,
): ActualPopulation {
  const accepted: AcceptedEvidence[] = [];
  const ambiguous: ActualPopulation["ambiguous"] = [];
  const extra: ActualPopulation["extra"] = [];

  for (const activity of activities) {
    const local_date = localDateInTimeZone(new Date(activity.activity_date), timeZone);
    const assoc = associations.get(activity.activity_id);
    if (!assoc || assoc.workout_id == null) {
      extra.push({ activity_id: activity.activity_id, local_date });
      continue;
    }
    if (!ACCEPTED_STATUSES.includes(assoc.status)) {
      ambiguous.push({ activity_id: activity.activity_id, workout_id: assoc.workout_id });
      continue;
    }
    accepted.push({
      activity_id: activity.activity_id, workout_id: assoc.workout_id,
      status: assoc.status as AcceptedEvidence["status"], local_date,
    });
  }
  return { accepted, ambiguous, extra };
}
