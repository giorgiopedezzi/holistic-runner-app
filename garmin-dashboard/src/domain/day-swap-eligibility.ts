// day-swap-eligibility.ts (HRA-301)
// Pure client-side eligibility rules for mobile's explicit day-swap target
// list. These are NEW rules this Story introduces — the existing desktop
// drag-swap (TrainingPlanAccordion.tsx's useDragSwap, reused by
// PlanInstanceCalendar's DayCellEvent) enforces no eligibility at all today;
// any two days can be dragged onto each other there. Out of scope: "Locked/
// generated-special days when the current domain marks them non-editable"
// (the Story's own Product semantics list) has no such marker anywhere on
// DayView/PlanInstance today — nothing in the domain model distinguishes a
// generated-special day from an ordinary one, so that specific rule is not
// checked here (see HRA-301's review comment for this documented gap).
import type { DayRef } from "@/components/TrainingPlanAccordion";
import type { DayView, SectionView } from "./runplan-aggregate";

export type SwapBlockedReason = "same-day" | "past-or-completed" | "race-day";

export interface SwapTarget {
  ref: DayRef;
  day: DayView;
  blocked: SwapBlockedReason | null;
}

export interface SwapEligibilityContext {
  // "YYYY-MM-DD", local calendar date — a target dated before this is past.
  today: string;
  raceDate: string | null | undefined;
  // A day with a matched recorded activity counts as both "completed" and
  // "linked to an imported activity" — the Story's own Product semantics
  // section groups both under one blocked-target reason.
  hasActivity: (date: string) => boolean;
}

export function swapBlockedReason(
  source: DayView,
  target: DayView,
  ctx: SwapEligibilityContext,
): SwapBlockedReason | null {
  if (target.date == null) return "same-day"; // defensive: never reached for a persisted instance day
  if (source.date != null && target.date === source.date) return "same-day";
  if (target.date < ctx.today) return "past-or-completed";
  if (ctx.hasActivity(target.date)) return "past-or-completed";
  if (ctx.raceDate != null && target.date === ctx.raceDate) return "race-day";
  return null;
}

// Flattens sections -> a flat, date-ordered list of {ref, day, blocked} for
// the target list UI. Only ever-persisted instance days (day.id != null) are
// swap candidates — a template day (id == null) has nothing to PATCH. `ref`
// is the same DayRef shape usePlanDayEditor/TrainingPlanAccordion already key
// day swaps by.
export function flattenSwapTargets(
  source: DayView,
  sections: SectionView[],
  ctx: SwapEligibilityContext,
): SwapTarget[] {
  const targets: SwapTarget[] = [];
  sections.forEach((section, sectionIndex) => {
    section.weeks.forEach((week, weekIndex) => {
      week.days.forEach((day, dayIndex) => {
        if (day.id == null || day.date == null) return;
        targets.push({
          ref: { sectionIndex, weekIndex, dayIndex },
          day,
          blocked: swapBlockedReason(source, day, ctx),
        });
      });
    });
  });
  return targets;
}
