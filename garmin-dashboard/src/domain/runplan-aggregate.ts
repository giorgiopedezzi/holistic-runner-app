// ── RunPlan DSL v1 — aggregate totals + accordion view-model (HRA-116) ──────
// Pure logic, no I/O — mirrors this app's domain/ convention (trends.ts,
// body-metrics.ts). Shared by the two Data & Sync accordion cards (HRA-117
// template card, HRA-118 instance card) so the totals math and the Section →
// Week → Day view-model are computed once, not duplicated per card.
//
// Distance rule (per the Story): sum every segment whose target.kind is
// "distance" directly; for a "duration" target, convert to distance using
// its resolved pace when one is available; segments whose target/intensity
// is "unknown" are excluded entirely. Two documented assumptions where the
// Story text doesn't fully pin down the behavior (flagged in the HRA-116
// review comment as a real design choice, not spelled out to a testable
// level):
//   - an interval segment's rest leg is EXCLUDED from the distance total —
//     only reps × work_target counts. Training-plan volume conventions
//     ("4x1000m" = 4km) count the work distance, not recovery jogs.
//   - a progression segment's duration→distance conversion uses the START
//     intensity's resolved pace (not an average of start/end, and not the
//     end pace) — the simplest defensible single-pace choice.
import type {
  DayEntry, Intensity, PacePolicy, ResolvedDay, ResolvedSegment, RunPlan, Section, Target, Week, WorkoutSegment, WorkoutType,
} from "../types/runplan";
import { buildPaceTargetBandModel, type PaceTargetBandModel } from "./planned-workout";

// ── pace resolution (mirrors garmin-stats/src/domain/runplan/pace.ts) ──────

function resolveAnchorPaceSecPerKm(anchor: string, policy: PacePolicy, visited: Set<string>): number | null {
  if (visited.has(anchor)) return null; // circular reference — never resolvable
  const value = policy[anchor];
  if (!value) return null;
  if (value.kind === "absolute") return value.pace_sec_per_km;
  const base = resolveAnchorPaceSecPerKm(value.anchor, policy, new Set(visited).add(anchor));
  return base == null ? null : base + value.offset_sec_per_km;
}

export function resolveIntensityPaceSecPerKm(intensity: Intensity, policy: PacePolicy): number | null {
  if (intensity.kind === "absolute") return intensity.pace_sec_per_km;
  if (intensity.kind === "unknown") return null;
  const base = resolveAnchorPaceSecPerKm(intensity.anchor, policy, new Set());
  if (intensity.kind === "anchor") return base;
  return base == null ? null : base + intensity.offset_sec_per_km;
}

// Shallow merge, child overriding parent by anchor name — same rule as the
// backend's getEffectivePacePolicy (Plan → Section → Week).
export function getEffectivePacePolicy(planPolicy: PacePolicy, sectionPolicy: PacePolicy, weekPolicy: PacePolicy): PacePolicy {
  return { ...planPolicy, ...sectionPolicy, ...weekPolicy };
}

// Every pace anchor a template's DSL references, anywhere — every name given
// a value via a PACE line at any scope (plan/section/week), plus every
// anchor name actually referenced by an intensity in a day's segments (HRA-
// 120 made an anchor with no PACE line at all perfectly legal — "resolved
// later, at instantiate time" — so a referenced-but-undefined anchor must
// still show up here to be resolved by the instantiate form). Sorted, deduped.
export function collectPlanAnchors(plan: RunPlan): string[] {
  const names = new Set<string>();
  const addPolicy = (policy: PacePolicy) => { for (const key of Object.keys(policy)) names.add(key); };
  const addIntensity = (intensity: Intensity) => {
    if (intensity.kind === "anchor" || intensity.kind === "offset") names.add(intensity.anchor);
  };
  addPolicy(plan.metadata.pace_policy);
  for (const section of plan.sections) {
    addPolicy(section.pace_policy);
    for (const week of section.weeks) {
      addPolicy(week.pace_policy);
      for (const day of week.days) {
        for (const seg of day.segments) {
          if (seg.type === "continuous") addIntensity(seg.intensity);
          else if (seg.type === "interval") {
            addIntensity(seg.work_intensity);
            if (seg.rest?.intensity) addIntensity(seg.rest.intensity);
          } else if (seg.type === "progression") {
            addIntensity(seg.start_intensity);
            addIntensity(seg.end_intensity);
          }
          // rest_block never carries an intensity.
        }
      }
    }
  }
  return [...names].sort();
}

// ── distance ─────────────────────────────────────────────────────────────

export interface DistanceTotal { meters: number; approximate: boolean }

const M_PER_KM = 1000;

function distanceFromTarget(target: Target, resolvedPaceSecPerKm: number | null | undefined): DistanceTotal | null {
  if (target.kind === "unknown") return null;
  if (target.kind === "distance") return { meters: target.distance_m, approximate: false };
  if (resolvedPaceSecPerKm == null) return null;
  const km = target.duration_sec / resolvedPaceSecPerKm;
  return { meters: km * M_PER_KM, approximate: true };
}

function distanceFromWorkoutSegment(seg: WorkoutSegment, policy: PacePolicy): DistanceTotal | null {
  switch (seg.type) {
    case "continuous":
      return distanceFromTarget(seg.target, resolveIntensityPaceSecPerKm(seg.intensity, policy));
    case "interval": {
      if (seg.reps == null) return null;
      const work = distanceFromTarget(seg.work_target, resolveIntensityPaceSecPerKm(seg.work_intensity, policy));
      if (!work) return null;
      // Bug fix: the rest leg between reps is real ground actually covered
      // (a jog/walk recovery still adds to the day's total km, the same way
      // it already counts toward totalDurationSec below) — it was
      // previously dropped entirely, undercounting e.g. "3x3000m r:1km" as
      // 9km instead of the correct 12km (3 work + 3 rest legs). An
      // unresolvable rest distance (duration-kind with no pace) falls back
      // to 0 contribution rather than voiding the otherwise-known work
      // total, same null-tolerant convention sumDistances uses elsewhere.
      const restPace = seg.rest?.intensity ? resolveIntensityPaceSecPerKm(seg.rest.intensity, policy) : null;
      const rest = seg.rest ? distanceFromTarget(seg.rest.target, restPace) : null;
      return { meters: (work.meters + (rest?.meters ?? 0)) * seg.reps, approximate: work.approximate || (rest?.approximate ?? false) };
    }
    case "progression":
      return distanceFromTarget(seg.target, resolveIntensityPaceSecPerKm(seg.start_intensity, policy));
    case "rest_block":
      // rest_block never carries an intensity — a duration target here is
      // never resolvable, only a distance target counts.
      return distanceFromTarget(seg.target, null);
  }
}

function distanceFromResolvedSegment(seg: ResolvedSegment): DistanceTotal | null {
  switch (seg.type) {
    case "continuous":
      return distanceFromTarget(seg.target, seg.resolved_pace_sec_per_km);
    case "interval": {
      if (seg.reps == null) return null;
      const work = distanceFromTarget(seg.work_target, seg.work_resolved_pace_sec_per_km);
      if (!work) return null;
      // Bug fix: mirrors distanceFromWorkoutSegment's own fix above — the
      // rest leg is real ground covered between reps, not to be dropped.
      const rest = seg.rest ? distanceFromTarget(seg.rest.target, seg.rest.resolved_pace_sec_per_km) : null;
      return { meters: (work.meters + (rest?.meters ?? 0)) * seg.reps, approximate: work.approximate || (rest?.approximate ?? false) };
    }
    case "progression":
      return distanceFromTarget(seg.target, seg.start_resolved_pace_sec_per_km);
    case "rest_block":
      return distanceFromTarget(seg.target, null);
  }
}

function sumDistances(parts: (DistanceTotal | null)[]): DistanceTotal {
  let meters = 0;
  let approximate = false;
  for (const part of parts) {
    if (!part) continue;
    meters += part.meters;
    approximate = approximate || part.approximate;
  }
  return { meters, approximate };
}

export function computeTemplateDayDistance(day: DayEntry, policy: PacePolicy): DistanceTotal {
  if (day.workout_type === "cross" || day.workout_type === "strength") {
    // CROSS/STRENGTH never carry an intensity (HRA-113) — a duration target
    // here is never resolvable, only a distance target counts.
    return sumDistances([day.activity_target ? distanceFromTarget(day.activity_target, null) : null]);
  }
  if (day.workout_type !== "run") return { meters: 0, approximate: false };
  return sumDistances(day.segments.map(seg => distanceFromWorkoutSegment(seg, policy)));
}

export function computeResolvedDayDistance(day: ResolvedDay): DistanceTotal {
  if (day.workout_type === "cross" || day.workout_type === "strength") {
    return sumDistances([day.activity_target ? distanceFromTarget(day.activity_target, null) : null]);
  }
  if (day.workout_type !== "run") return { meters: 0, approximate: false };
  return sumDistances(day.segments.map(distanceFromResolvedSegment));
}

// ── per-day metrics (HRA-145: agenda-view distance/speed/duration bars) ────
// Speed formula per the Story: speed_kmh = 3600 / pace_sec_per_km. Mirrors
// the distance rule's own documented assumptions (interval REST leg
// excluded from speed characterization — a segment's speed describes its
// WORK effort, not a recovery jog, same "4x1000m = 4km" volume convention;
// progression's start AND end pace both count, since a progression genuinely
// spans a pace range within one segment, unlike continuous/interval's single
// value). A segment with no resolved pace is excluded from min/max entirely,
// never treated as 0 (an unresolved anchor isn't "zero speed").

function speedKmhFromPaceSecPerKm(paceSecPerKm: number): number {
  return 3600 / paceSecPerKm;
}

function speedsFromResolvedSegment(seg: ResolvedSegment): number[] {
  switch (seg.type) {
    case "continuous":
      return seg.resolved_pace_sec_per_km != null ? [speedKmhFromPaceSecPerKm(seg.resolved_pace_sec_per_km)] : [];
    case "interval":
      return seg.work_resolved_pace_sec_per_km != null ? [speedKmhFromPaceSecPerKm(seg.work_resolved_pace_sec_per_km)] : [];
    case "progression": {
      const speeds: number[] = [];
      if (seg.start_resolved_pace_sec_per_km != null) speeds.push(speedKmhFromPaceSecPerKm(seg.start_resolved_pace_sec_per_km));
      if (seg.end_resolved_pace_sec_per_km != null) speeds.push(speedKmhFromPaceSecPerKm(seg.end_resolved_pace_sec_per_km));
      return speeds;
    }
    case "rest_block":
      return []; // never carries an intensity
  }
}

// The mirror image of distanceFromTarget (duration <-> distance swapped) —
// a duration target's own duration_sec is used directly; a distance target
// converts via the resolved pace when one is available; unknown is never
// resolvable. Real session length (the agenda view's duration "clock"), not
// part of the Jira Story's own Ask list — added per explicit follow-up
// instruction alongside HRA-145 to show each day's duration relative to the
// plan's longest single session.
function durationFromTarget(target: Target, resolvedPaceSecPerKm: number | null | undefined): number | null {
  if (target.kind === "unknown") return null;
  if (target.kind === "duration") return target.duration_sec;
  if (resolvedPaceSecPerKm == null) return null;
  return (target.distance_m / M_PER_KM) * resolvedPaceSecPerKm;
}

function durationFromResolvedSegment(seg: ResolvedSegment): number | null {
  switch (seg.type) {
    case "continuous":
      return durationFromTarget(seg.target, seg.resolved_pace_sec_per_km);
    case "interval": {
      if (seg.reps == null) return null;
      const workDur = durationFromTarget(seg.work_target, seg.work_resolved_pace_sec_per_km);
      if (workDur == null) return null;
      // The interval's rest leg IS real elapsed clock time on an actual
      // run — included here (and, since the bug fix above, in distance
      // too), unlike speedsFromResolvedSegment below, which deliberately
      // excludes it from speed characterization (a recovery jog isn't the
      // segment's WORK effort).
      const restDur = seg.rest ? durationFromTarget(seg.rest.target, seg.rest.resolved_pace_sec_per_km) : null;
      return (workDur + (restDur ?? 0)) * seg.reps;
    }
    case "progression":
      return durationFromTarget(seg.target, seg.start_resolved_pace_sec_per_km);
    case "rest_block":
      // Never carries an intensity — only resolvable when its own target is
      // already duration-kind (e.g. "10min walk"), same as distance's rule.
      return durationFromTarget(seg.target, null);
  }
}

export interface ResolvedDayMetrics {
  totalDistanceM: number;
  minSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  totalDurationSec: number;
}

export function computeResolvedDayMetrics(day: ResolvedDay): ResolvedDayMetrics {
  const totalDistanceM = computeResolvedDayDistance(day).meters;
  if (day.workout_type === "cross" || day.workout_type === "strength") {
    // Mirrors computeResolvedDayDistance's own dispatch: CROSS/STRENGTH
    // never carry an intensity, so speed is never resolvable for them; a
    // duration IS directly usable when activity_target is itself
    // duration-kind (no pace needed to convert it).
    const durationSec = day.activity_target?.kind === "duration" ? day.activity_target.duration_sec : 0;
    return { totalDistanceM, minSpeedKmh: null, maxSpeedKmh: null, totalDurationSec: durationSec };
  }
  if (day.workout_type !== "run") return { totalDistanceM, minSpeedKmh: null, maxSpeedKmh: null, totalDurationSec: 0 };
  const speeds = day.segments.flatMap(speedsFromResolvedSegment);
  const durations = day.segments.map(durationFromResolvedSegment).filter((d): d is number => d != null);
  return {
    totalDistanceM,
    minSpeedKmh: speeds.length > 0 ? Math.min(...speeds) : null,
    maxSpeedKmh: speeds.length > 0 ? Math.max(...speeds) : null,
    totalDurationSec: durations.reduce((a, b) => a + b, 0),
  };
}

// ── day-count categorization + combined totals ──────────────────────────

export interface AggregateTotals {
  totalDays: number;
  activeDays: number;  // every day whose workout_type isn't rest/todo/other (run/cross/strength)
  runningDays: number; // workout_type === "run" only
  restDays: number;    // workout_type === "rest"
  // HRA-156: "other" (a day whose DSL text couldn't be recognized at all,
  // preserved verbatim as a note rather than discarded) is tracked
  // separately from needs_review's warning count — it's a resolved,
  // non-review state, not a flagged one, so it needs its own tally rather
  // than silently folding into activeDays or getting conflated with warnings.
  otherDays: number;
  distance: DistanceTotal;
}

function categorize(workoutTypes: WorkoutType[]): Omit<AggregateTotals, "distance"> {
  let activeDays = 0, runningDays = 0, restDays = 0, otherDays = 0;
  for (const wt of workoutTypes) {
    if (wt === "rest") restDays++;
    else if (wt !== "todo" && wt !== "other") activeDays++;
    if (wt === "run") runningDays++;
    if (wt === "other") otherDays++;
  }
  return { totalDays: workoutTypes.length, activeDays, runningDays, restDays, otherDays };
}

export function aggregateTemplateDays(entries: { day: DayEntry; policy: PacePolicy }[]): AggregateTotals {
  return {
    ...categorize(entries.map(e => e.day.workout_type)),
    distance: sumDistances(entries.map(e => computeTemplateDayDistance(e.day, e.policy))),
  };
}

export function aggregateResolvedDays(days: ResolvedDay[]): AggregateTotals {
  return {
    ...categorize(days.map(d => d.workout_type)),
    distance: sumDistances(days.map(computeResolvedDayDistance)),
  };
}

// Live follow-up: recomputes a Week/Section's own AggregateTotals directly
// from its current DayView[] — used when a local (not-yet-saved) dsl edit
// changes a day's workout_type/distance, so the accordion's title-row
// totals stay consistent with what's actually on screen instead of only
// updating at the next full Save/reload. Reuses categorize/sumDistances,
// the same rollup aggregateResolvedDays above already uses — a DayView
// already carries its own resolved workout_type/distance, so this needs
// neither a PacePolicy (template days use aggregateTemplateDays for that)
// nor a fresh ResolvedDay (aggregateResolvedDays' own case) to recompute.
export function aggregateDayViews(days: DayView[]): AggregateTotals {
  return {
    ...categorize(days.map(d => d.workout_type)),
    distance: sumDistances(days.map(d => d.distance)),
  };
}

export function aggregateTemplateWeek(section: Section, week: Week, planPolicy: PacePolicy): AggregateTotals {
  const policy = getEffectivePacePolicy(planPolicy, section.pace_policy, week.pace_policy);
  return aggregateTemplateDays(week.days.map(day => ({ day, policy })));
}

export function aggregateTemplateSection(section: Section, planPolicy: PacePolicy): AggregateTotals {
  const entries = section.weeks.flatMap(week => {
    const policy = getEffectivePacePolicy(planPolicy, section.pace_policy, week.pace_policy);
    return week.days.map(day => ({ day, policy }));
  });
  return aggregateTemplateDays(entries);
}

// ── accordion view-model ────────────────────────────────────────────────
// TrainingPlanAccordion renders this render-ready tree and knows nothing
// about WorkoutSegment/ResolvedSegment/PacePolicy — all domain-shape
// knowledge stays in this module's two builders below.

export interface DayView {
  day: number;
  suffix?: string;
  category?: string;
  workout_type: WorkoutType;
  // The day's raw D-line text, editable. Template days always have one
  // (DayEntry.raw_dsl). Instance days have none persisted on the backend
  // (plan_instance_days stores only resolved segments) — buildInstanceSectionView
  // seeds this via reconstructDslFromResolvedDay (HRA-118) below.
  dsl: string;
  notes?: string;
  needs_review: boolean;
  warnings: ParseWarningLike[];
  distance: DistanceTotal;
  // Concrete calendar date — only ever set for instance days (a template day
  // has no date until instantiated). HRA-118 needs this to build each day's
  // PUT /api/v1/plan-instances/:id body ({section_name, week_number, date, dsl}).
  date?: string;
  // HRA-145: speed/duration metrics for the agenda-view bars — only ever
  // set on the instance path (buildInstanceSectionView), since it needs a
  // ResolvedDay's resolved segments; a template DayEntry has unresolved
  // Intensity values with no speed concept yet, so this stays undefined
  // there. `distance` above already exists independently for the
  // accordion's own totals display — `metrics.totalDistanceM` duplicates
  // that same number for the instance path rather than threading a second
  // prop through PlanInstanceCalendar, since both call the same underlying
  // computeResolvedDayDistance internally.
  metrics?: ResolvedDayMetrics;
  // HRA-148: the badge PlanInstanceCalendar renders instead of raw
  // workout_type. Only ever set on the instance path, same reasoning as
  // `metrics` above — classifyResolvedDay needs a ResolvedDay's resolved
  // segments, which a template DayEntry doesn't have yet.
  trainingLoadCategory?: TrainingLoadCategory;
  // HRA-173: reusable, real-distance target bands derived directly from
  // persisted resolved segments. Template days never carry this model.
  paceTargetBands?: PaceTargetBandModel;
  // HRA-150: passthrough of ResolvedDay's own id/scheduled_time (only ever
  // set on the instance path) — id is what InstanceDayRow's time field
  // addresses via PATCH /plan-instances/:id/days/:id; scheduled_time is
  // HH:MM 24-hour or undefined/null (display default 08:00).
  id?: number;
  scheduled_time?: string | null;
  // HRA-229: the day's raw parsed segments — only ever set on the template
  // path (buildTemplateSectionView). Instance days carry ResolvedSegment,
  // a different (already pace-resolved) shape out of this Story's scope, so
  // buildInstanceSectionView leaves this undefined. Lets
  // buildContinuousSegmentPresentation below detect the "exactly one
  // continuous segment" case without threading a second parallel prop.
  segments?: WorkoutSegment[];
}

// Local alias so this file doesn't need to import ParseWarning just for this one signature.
type ParseWarningLike = { line: number; content: string; message: string };

export interface WeekView {
  number: number;
  notes?: string;
  raw_dsl: string;
  days: DayView[];
  totals: AggregateTotals;
}

export interface SectionView {
  name: string;
  notes?: string;
  // "" for the implicit default section — signals the accordion to display
  // the owning template/instance's own name instead (display-only, the
  // underlying name here is left untouched).
  raw_dsl: string;
  weeks: WeekView[];
  totals: AggregateTotals;
}

// HRA-129: min/max of the week's own days' calendar dates — pure derivation,
// no schema change. Template weeks (every day.date == null) have nothing to
// derive from, so this returns null. Moved here from TrainingPlanAccordion.tsx
// (HRA-131) once a second component (PlanInstancesSection's swap-confirm
// modal) needed the same derivation — a plain WeekView computation belongs
// next to this file's other view-model builders, not duplicated per caller.
export function weekDateRange(week: WeekView): { start: string; end: string } | null {
  const dates = week.days.map(d => d.date).filter((d): d is string => d != null);
  if (dates.length === 0) return null;
  return { start: dates.reduce((a, b) => (a < b ? a : b)), end: dates.reduce((a, b) => (a > b ? a : b)) };
}

// ── structured continuous-segment presentation (HRA-229) ───────────────────
// A read-only view-model for a template day with EXACTLY one continuous
// segment — the accordion renders this above the day's still-unchanged,
// still-editable DSL text input, so a workout like "10km @ FL" shows as
// labeled Distance/Duration + Pace fields instead of raw DSL punctuation.
// Purely presentational: the underlying raw_dsl/target/intensity are never
// modified, only reformatted for display.

export interface ContinuousSegmentPresentation {
  distanceOrDuration: string;
  pace: string;
}

// Splits a raw token like "30min" into its leading number and trailing unit
// letters, reinserting the space the DSL's own compact grammar omits
// ("30min" -> "30 min"). Falls back to the raw token unchanged when it
// doesn't match this shape (never expected for a real duration Target, but
// keeps this a total function rather than one that can throw on bad input).
function insertSpaceBeforeUnit(raw: string): string {
  const match = raw.match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z'"/]+)$/);
  return match ? `${match[1]} ${match[2]}` : raw;
}

// Distance/Duration normalization per the Story: spacing only for a
// duration ("30min" -> "30 min", the DSL's own unit token is kept verbatim);
// a distance is reformatted from its semantic distance_m so a whole number
// of km always reads as km ("10km" -> "10 km", "8000m" -> "8 km") rather
// than echoing whichever unit the author happened to type. A non-round
// meter value still resolves to km (2 decimal places, trailing zeros
// trimmed) once it's >= 1km, since km is this app's own default distance
// unit elsewhere (fmtDistance above); anything under 1km stays in meters.
function formatDistanceOrDurationValue(target: Target): string {
  if (target.kind === "duration") return insertSpaceBeforeUnit(target.raw);
  if (target.kind === "unknown") return target.raw;
  const meters = target.distance_m;
  if (meters % 1000 === 0) return `${meters / 1000} km`;
  if (meters >= 1000) return `${(meters / 1000).toFixed(2).replace(/\.?0+$/, "")} km`;
  return `${meters} m`;
}

export function buildContinuousSegmentPresentation(day: DayView): ContinuousSegmentPresentation | null {
  if (day.workout_type !== "run" || day.segments == null || day.segments.length !== 1) return null;
  const [segment] = day.segments;
  if (segment.type !== "continuous") return null;
  return {
    distanceOrDuration: formatDistanceOrDurationValue(segment.target),
    pace: segment.intensity.raw,
  };
}

export function buildTemplateSectionView(section: Section, planPolicy: PacePolicy): SectionView {
  const weeks: WeekView[] = section.weeks.map(week => {
    const policy = getEffectivePacePolicy(planPolicy, section.pace_policy, week.pace_policy);
    const days: DayView[] = week.days.map(day => ({
      day: day.day, suffix: day.suffix, category: day.category, workout_type: day.workout_type,
      dsl: day.raw_dsl, notes: day.notes, needs_review: day.needs_review, warnings: day.warnings,
      distance: computeTemplateDayDistance(day, policy), segments: day.segments,
    }));
    return {
      number: week.number, notes: week.notes, raw_dsl: week.raw_dsl, days,
      totals: aggregateTemplateWeek(section, week, planPolicy),
    };
  });
  return {
    name: section.name, notes: section.notes, raw_dsl: section.raw_dsl, weeks,
    totals: aggregateTemplateSection(section, planPolicy),
  };
}

export interface InstanceWeekInput {
  number: number;
  notes?: string;
  raw_dsl?: string; // instances have no week header text — always "" unless a future Story adds one
  days: (ResolvedDay & { dsl: string })[];
}

export function buildInstanceSectionView(
  sectionName: string, sectionRawDsl: string, weeks: InstanceWeekInput[],
  classificationContext: DayClassificationContext, sectionNotes?: string,
): SectionView {
  const weekViews: WeekView[] = weeks.map(week => {
    const days: DayView[] = week.days.map(day => ({
      day: day.day, suffix: day.suffix, category: day.category, workout_type: day.workout_type,
      dsl: day.dsl, notes: day.notes, needs_review: day.needs_review, warnings: [],
      distance: computeResolvedDayDistance(day), date: day.date,
      metrics: computeResolvedDayMetrics(day),
      trainingLoadCategory: classifyResolvedDay(day, classificationContext),
      paceTargetBands: buildPaceTargetBandModel(day.segments),
      id: day.id, scheduled_time: day.scheduled_time,
    }));
    return {
      number: week.number, notes: week.notes, raw_dsl: week.raw_dsl ?? "", days,
      totals: aggregateResolvedDays(week.days),
    };
  });
  return {
    name: sectionName, notes: sectionNotes, raw_dsl: sectionRawDsl, weeks: weekViews,
    totals: aggregateResolvedDays(weeks.flatMap(w => w.days)),
  };
}

// ── training-load classification (HRA-147) ──────────────────────────────
// Pure, never persisted — recomputed fresh every time the agenda renders
// (explicit user instruction: an on-the-fly estimate, not a DB column).
// Structural categories (read straight off the DSL's own segment shape)
// always win over the pace heuristic, regardless of pace. The heuristic
// buckets a continuous-only run day's own resolved pace into a tercile of
// every resolved pace across the WHOLE plan instance (not just the visible
// week/month), reusing the same linear-interpolated-percentile technique as
// domain/activity-chart.ts's `percentile()`. Long run is a final overlay on
// top of the pace tier only — a day that's already Intervals/Progressive/
// Cross training/Rest keeps that category even if it's also its week's
// longest run (the AC only asks the overlay to override "the pace-tier
// badge").

export type TrainingLoadCategory =
  | "easy_recovery" | "long_run" | "intervals" | "progressive"
  | "threshold" | "tempo" | "cross_training" | "rest";

// Linear-interpolated percentile over an ascending-sorted array — mirrors
// domain/activity-chart.ts's `percentile()`, not imported from it to avoid
// a chart-module dependency from this plan/agenda-only file for one helper.
function linearPercentile(sortedAsc: number[], p: number): number {
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

// Every continuous-segment resolved pace across the whole plan instance —
// the population the pace tercile is computed against. Interval/progression
// paces are excluded: those days are already structurally classified, so
// their pace shouldn't skew the tercile boundaries used for the remaining
// continuous-only days.
function collectContinuousPaces(days: ResolvedDay[]): number[] {
  const paces: number[] = [];
  for (const day of days) {
    if (day.workout_type !== "run") continue;
    for (const seg of day.segments) {
      if (seg.type === "continuous" && seg.resolved_pace_sec_per_km != null) paces.push(seg.resolved_pace_sec_per_km);
    }
  }
  return paces;
}

// A day's own representative pace for the heuristic — the mean of its
// continuous segments' resolved paces (almost always a single segment;
// averaged for the rare multi-segment continuous day, e.g. "5km @ RG ;
// 2km @ FL"). null when nothing resolves — the "no resolvable pace at all"
// AC case, which must fall to Easy/Recovery, never crash.
function dayRepresentativePace(day: ResolvedDay): number | null {
  const paces = day.segments
    .filter((seg): seg is Extract<ResolvedSegment, { type: "continuous" }> => seg.type === "continuous")
    .map(seg => seg.resolved_pace_sec_per_km)
    .filter((p): p is number => p != null);
  if (paces.length === 0) return null;
  return paces.reduce((a, b) => a + b, 0) / paces.length;
}

function structuralCategory(day: ResolvedDay): "intervals" | "progressive" | null {
  if (day.segments.some(seg => seg.type === "interval")) return "intervals";
  if (day.segments.some(seg => seg.type === "progression")) return "progressive";
  return null;
}

// HRA-183: a staged continuous workout — three or more plain continuous
// segments whose resolved pace clearly accelerates stage over stage — reads
// as a deliberate progression even though the DSL never used the explicit
// PROG segment type. Checked after structuralCategory (an explicit PROG
// segment or an interval day is already unambiguous) but before the
// pace-tercile heuristic, since averaging three markedly different paces
// into one bucket would otherwise misclassify the day (typically as
// Threshold — the Story's motivating case). Design choice: pairwise strict
// monotonic decrease across every consecutive stage, not just first-vs-last
// — a slower/equal middle stage (e.g. 266 -> 270 -> 246) nets "faster
// overall" but isn't a clean acceleration, and would sneak through a
// first-vs-last check; the Story's "conservative" framing and its
// "equal/slowing stages ... do not trigger" AC both rule that out. Any
// segment that isn't continuous (including a rest_block) — or any stage
// with no resolved pace — disqualifies the whole day, per the same AC.
function isInferredProgression(day: ResolvedDay): boolean {
  if (day.segments.length < 3) return false;
  if (day.segments.some(seg => seg.type !== "continuous")) return false;
  const paces = day.segments.map(seg => (seg as Extract<ResolvedSegment, { type: "continuous" }>).resolved_pace_sec_per_km);
  if (paces.some(p => p == null)) return false;
  for (let i = 1; i < paces.length; i++) {
    if (paces[i]! >= paces[i - 1]!) return false;
  }
  return true;
}

// The volume the Long-run overlay compares within a week: total distance,
// falling back to total duration only when distance doesn't resolve at all
// (per the Story's "total_distance_m (or duration)").
function dayVolume(day: ResolvedDay): number {
  const meters = computeResolvedDayDistance(day).meters;
  return meters > 0 ? meters : computeResolvedDayMetrics(day).totalDurationSec;
}

function dayKey(day: ResolvedDay): string {
  return `${day.section_name}::${day.week_number}::${day.day}${day.suffix ?? ""}`;
}

export interface DayClassificationContext {
  // Ascending pace_sec_per_km tercile boundaries (fastest → slowest) over
  // the whole plan instance; null when the instance has no resolvable
  // continuous pace at all (every heuristic day then falls to Easy/Recovery).
  paceTercileBounds: { fastBound: number; midBound: number } | null;
  // "section::week" -> the dayKey() of that week's strict-max-volume run
  // day. A tie (no unique outlier) leaves the week absent from the map, so
  // no day gets the overlay that week — safer than guessing a winner.
  weekLongRunDay: Map<string, string>;
}

export function buildDayClassificationContext(days: ResolvedDay[]): DayClassificationContext {
  const paces = collectContinuousPaces(days).sort((a, b) => a - b);
  const paceTercileBounds = paces.length > 0
    ? { fastBound: linearPercentile(paces, 1 / 3), midBound: linearPercentile(paces, 2 / 3) }
    : null;

  const byWeek = new Map<string, ResolvedDay[]>();
  for (const day of days) {
    if (day.workout_type !== "run") continue;
    const key = `${day.section_name}::${day.week_number}`;
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key)!.push(day);
  }
  const weekLongRunDay = new Map<string, string>();
  for (const [weekKey, weekDays] of byWeek) {
    let bestKey: string | null = null, bestVolume = -Infinity, tie = false;
    for (const day of weekDays) {
      const volume = dayVolume(day);
      if (volume > bestVolume) { bestKey = dayKey(day); bestVolume = volume; tie = false; }
      else if (volume === bestVolume) tie = true;
    }
    if (bestKey && !tie && bestVolume > 0) weekLongRunDay.set(weekKey, bestKey);
  }
  return { paceTercileBounds, weekLongRunDay };
}

export function classifyResolvedDay(day: ResolvedDay, context: DayClassificationContext): TrainingLoadCategory {
  // CROSS/STRENGTH are grouped together here the same way computeResolvedDayDistance
  // groups them (both non-running, structured activity types).
  if (day.workout_type === "cross" || day.workout_type === "strength") return "cross_training";
  if (day.workout_type === "rest") return "rest";
  if (day.workout_type === "todo") return "easy_recovery"; // not yet planned — no load info to classify by
  if (day.workout_type === "other") return "easy_recovery"; // unparseable free text, no segments — no load info to classify by

  const structural = structuralCategory(day);
  if (structural) return structural;

  // Evaluated before the pace-tercile/long-run heuristic below (HRA-183) —
  // same early-return shape as structuralCategory above, so an inferred
  // progression also isn't overridden by the week's long-run overlay.
  if (isInferredProgression(day)) return "progressive";

  const pace = dayRepresentativePace(day);
  let tier: TrainingLoadCategory;
  if (pace == null || context.paceTercileBounds == null) tier = "easy_recovery";
  else if (pace <= context.paceTercileBounds.fastBound) tier = "threshold";
  else if (pace <= context.paceTercileBounds.midBound) tier = "tempo";
  else tier = "easy_recovery";

  const weekKey = `${day.section_name}::${day.week_number}`;
  if (context.weekLongRunDay.get(weekKey) === dayKey(day)) return "long_run";
  return tier;
}

// ── instance day-line reconstruction (HRA-118) ──────────────────────────
// plan_instance_days stores only resolved segments, never the original
// D-line text — resolveDay (backend instantiate.ts) preserves each
// segment's original Target objects unchanged, only intensities get
// resolved, so `target.raw`/`work_target.raw` are still the exact original
// token text (e.g. "5km", "1000m"). The one genuinely lossy piece is
// intensity: a resolved segment carries only resolved_pace_sec_per_km, never
// the original anchor/offset — so every intensity is reconstructed as an
// absolute pace (e.g. "4:40/km"), never the symbolic anchor the plan was
// originally authored with. This is a real, unavoidable loss (the anchor is
// gone from the data by the time it's resolved), not an oversight — flagged
// in the HRA-118 review. The reconstructed line is still fully valid,
// re-parseable, re-editable DSL text; it's the seed the accordion shows,
// not a promise to reproduce the author's original symbolic notation.
function formatAbsolutePaceKm(paceSecPerKm: number): string {
  const totalSec = Math.round(paceSecPerKm);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}/km`;
}

function formatIntensity(resolvedPaceSecPerKm: number | null): string {
  return resolvedPaceSecPerKm == null ? "?" : formatAbsolutePaceKm(resolvedPaceSecPerKm);
}

function formatResolvedSegment(seg: ResolvedSegment): string {
  switch (seg.type) {
    case "continuous":
      return `${seg.target.raw} @ ${formatIntensity(seg.resolved_pace_sec_per_km)}`;
    case "interval": {
      const rest = seg.rest
        ? ` r:${seg.rest.target.raw}${seg.rest.resolved_pace_sec_per_km != null ? ` @ ${formatIntensity(seg.rest.resolved_pace_sec_per_km)}` : ""}${seg.rest.rest_type ? ` ${seg.rest.rest_type}` : ""}`
        : "";
      return `${seg.reps ?? "?"}x${seg.work_target.raw} @ ${formatIntensity(seg.work_resolved_pace_sec_per_km)}${rest}`;
    }
    case "progression":
      return `${seg.target.raw} PROG ${formatIntensity(seg.start_resolved_pace_sec_per_km)} -> ${formatIntensity(seg.end_resolved_pace_sec_per_km)}`;
    case "rest_block":
      return `REST ${seg.target.raw}${seg.rest_type ? ` ${seg.rest_type}` : ""}`;
  }
}

export function reconstructDslFromResolvedDay(day: ResolvedDay): string {
  const prefix = `D${day.day}${day.suffix ?? ""}${day.category ? ` [${day.category}]` : ""}:`;
  let body: string;
  if (day.workout_type === "rest") body = "REST";
  else if (day.workout_type === "todo") body = "TODO";
  else if (day.workout_type === "other") body = "OTHER";
  else if (day.workout_type === "cross" || day.workout_type === "strength") {
    const keyword = day.workout_type === "cross" ? "CROSS" : "STRENGTH";
    const targetText = day.activity_target ? `${day.activity_target.raw} ` : "";
    body = `${keyword} ${targetText}${day.activity_description ?? ""}`.trim();
  } else {
    body = day.segments.map(formatResolvedSegment).join("; ");
  }
  const line = `${prefix} ${body}`;
  return day.notes ? `${line} # ${day.notes}` : line;
}

// ── instance section/week grouping (HRA-118) ────────────────────────────
// An instance has no first-class Section/Week entities — plan_instance_days
// is a flat list of rows, each carrying its own denormalized section_name/
// week_number string (docs/schema.md). Groups them into the same SectionView
// tree buildTemplateSectionView produces, preserving first-seen order
// (days normally already arrive date-ordered from the backend).
export function groupResolvedDaysIntoSectionViews(days: (ResolvedDay & { dsl: string })[]): SectionView[] {
  const sectionOrder: string[] = [];
  const bySection = new Map<string, Map<number, (ResolvedDay & { dsl: string })[]>>();
  for (const day of days) {
    if (!bySection.has(day.section_name)) { bySection.set(day.section_name, new Map()); sectionOrder.push(day.section_name); }
    const weeks = bySection.get(day.section_name)!;
    if (!weeks.has(day.week_number)) weeks.set(day.week_number, []);
    weeks.get(day.week_number)!.push(day);
  }
  // Built once over the WHOLE instance (every section, every week) — HRA-147's
  // pace tercile and long-run overlay are both explicitly instance-scoped, not
  // per-section, so this must happen before splitting into per-section calls below.
  const classificationContext = buildDayClassificationContext(days);
  return sectionOrder.map(sectionName => {
    const weeks = bySection.get(sectionName)!;
    const weekInputs: InstanceWeekInput[] = [...weeks.keys()].sort((a, b) => a - b)
      .map(number => ({ number, days: weeks.get(number)! }));
    return buildInstanceSectionView(sectionName, "", weekInputs, classificationContext);
  });
}
