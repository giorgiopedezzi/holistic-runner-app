/**
 * categoryVisuals.tsx (HRA-160)
 * Per-TrainingLoadCategory icon/label/criteria/card-class data — extracted
 * out of PlanInstanceCalendar.tsx (where HRA-148 first introduced it) into
 * its own module so TrainingPlanAccordion.tsx's InstanceDayRow (List view,
 * this Story) can reuse the exact same data too, without TrainingPlanAccordion
 * importing from PlanInstanceCalendar.tsx — that would be a circular import,
 * since PlanInstanceCalendar.tsx already imports DAY_PREFIX_RE/useDragSwap
 * FROM TrainingPlanAccordion.tsx. PlanInstanceCalendar.tsx now imports this
 * data from here instead of defining it locally — no behavior change there.
 */
import type { ReactNode } from "react";
import { Activity, Bed, Bike, Feather, Repeat, TrendingUp, Zap } from "lucide-react";
import type { TrainingLoadCategory } from "@/domain/runplan-aggregate";

// HRA-148 Ask #2: one icon per HRA-147 classification category — Repeat for
// Intervals, TrendingUp for Progressive (both named explicitly by the
// Story), and a distinct mark each for Threshold/Tempo/Easy-Recovery so the
// three pace tiers of a "run" day never read as visually the same badge.
// `todo` isn't a real category (HRA-147 folds it into Easy/Recovery) — the
// compact row below keeps its own historic CircleHelp treatment for it
// instead of using this map (see PlanInstanceCalendar.tsx's DayCellEvent).
// Long run's own runner glyph (lucide-react has no dedicated running-figure
// icon — checked directly, no "Runner"/"Running" export exists, so HRA-144
// hand-drew this one; never Footprints, per explicit instruction) is defined
// inline as an anonymous arrow, not a separately named function exported
// alongside this file's data consts — a named top-level component here
// trips react-refresh/only-export-components even when unexported, since
// the plugin still treats a capitalized-looking function reachable through
// an exported object as a component boundary.
export const CATEGORY_ICONS: Record<TrainingLoadCategory, (props: { size?: number }) => ReactNode> = {
  easy_recovery: Feather,
  long_run: ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="15.5" cy="4.5" r="1.6" />
      <path d="M13 8l2.2 2.2-1 3.3 3.3 2.5-.9 3.6" />
      <path d="M13.2 10.3l-3.6 1.4-2.1 3.8" />
      <path d="M16.5 16l2.6 1.4-1 3.6" />
      <path d="M9.8 14.3l-1.4 3.2-3.4 1" />
    </svg>
  ),
  intervals: Repeat, progressive: TrendingUp,
  threshold: Zap, tempo: Activity, cross_training: Bike, rest: Bed,
};

// HRA-148 Ask #1/#2: category tint per classifyResolvedDay output, replacing
// HRA-146's workout_type-only placeholder. `rest` intentionally has no card
// class — it still renders as the compact no-card row (see
// hra-agenda-rest-row below), just with its own icon/label now.
export const CATEGORY_CARD_CLASS: Partial<Record<TrainingLoadCategory, string>> = {
  easy_recovery: "hra-agenda-cat-easy-recovery", long_run: "hra-agenda-cat-long-run",
  intervals: "hra-agenda-cat-intervals", progressive: "hra-agenda-cat-progressive",
  threshold: "hra-agenda-cat-threshold", tempo: "hra-agenda-cat-tempo",
  cross_training: "hra-agenda-cat-cross-training",
};

// HRA-148 Ask #3: category / icon / criteria, in the same order as HRA-147's
// own description — also the order the criteria-reference popover lists
// them in.
export const CATEGORY_ORDER: TrainingLoadCategory[] = [
  "easy_recovery", "long_run", "intervals", "progressive", "threshold", "tempo", "cross_training", "rest",
];
export const CATEGORY_LABEL_KEYS: Record<TrainingLoadCategory, [string, string]> = {
  easy_recovery: ["manage.planInstances.category.easyRecovery", "Easy/Recovery"],
  long_run: ["manage.planInstances.category.longRun", "Long run"],
  intervals: ["manage.planInstances.category.intervals", "Intervals"],
  progressive: ["manage.planInstances.category.progressive", "Progressive"],
  threshold: ["manage.planInstances.category.threshold", "Threshold"],
  tempo: ["manage.planInstances.category.tempo", "Tempo"],
  cross_training: ["manage.planInstances.category.crossTraining", "Cross training"],
  rest: ["manage.planInstances.category.rest", "Rest"],
};
export const CATEGORY_CRITERIA_KEYS: Record<TrainingLoadCategory, [string, string]> = {
  easy_recovery: ["manage.planInstances.categoryCriteria.easyRecovery", "Slowest pace third of the plan, or pace not yet resolved."],
  long_run: ["manage.planInstances.categoryCriteria.longRun", "The week's longest run, by distance (or duration)."],
  intervals: ["manage.planInstances.categoryCriteria.intervals", "Contains an interval segment (reps × work, with rest)."],
  progressive: ["manage.planInstances.categoryCriteria.progressive", "Contains a progression segment (pace shifts start → end)."],
  threshold: ["manage.planInstances.categoryCriteria.threshold", "Fastest pace third of the plan."],
  tempo: ["manage.planInstances.categoryCriteria.tempo", "Middle pace third of the plan."],
  cross_training: ["manage.planInstances.categoryCriteria.crossTraining", "A CROSS or STRENGTH day."],
  rest: ["manage.planInstances.categoryCriteria.rest", "A REST day."],
};
