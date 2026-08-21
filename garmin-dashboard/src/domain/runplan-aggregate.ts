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
  DayEntry, Intensity, PacePolicy, ResolvedDay, ResolvedSegment, Section, Target, Week, WorkoutSegment, WorkoutType,
} from "../types/runplan";

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
      const one = distanceFromTarget(seg.work_target, resolveIntensityPaceSecPerKm(seg.work_intensity, policy));
      return one && { meters: one.meters * seg.reps, approximate: one.approximate };
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
      const one = distanceFromTarget(seg.work_target, seg.work_resolved_pace_sec_per_km);
      return one && { meters: one.meters * seg.reps, approximate: one.approximate };
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

// ── day-count categorization + combined totals ──────────────────────────

export interface AggregateTotals {
  totalDays: number;
  activeDays: number;  // every day whose workout_type isn't rest/todo (run/cross/strength)
  runningDays: number; // workout_type === "run" only
  restDays: number;    // workout_type === "rest"
  distance: DistanceTotal;
}

function categorize(workoutTypes: WorkoutType[]): Omit<AggregateTotals, "distance"> {
  let activeDays = 0, runningDays = 0, restDays = 0;
  for (const wt of workoutTypes) {
    if (wt === "rest") restDays++;
    else if (wt !== "todo") activeDays++;
    if (wt === "run") runningDays++;
  }
  return { totalDays: workoutTypes.length, activeDays, runningDays, restDays };
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

export function buildTemplateSectionView(section: Section, planPolicy: PacePolicy): SectionView {
  const weeks: WeekView[] = section.weeks.map(week => {
    const policy = getEffectivePacePolicy(planPolicy, section.pace_policy, week.pace_policy);
    const days: DayView[] = week.days.map(day => ({
      day: day.day, suffix: day.suffix, category: day.category, workout_type: day.workout_type,
      dsl: day.raw_dsl, notes: day.notes, needs_review: day.needs_review, warnings: day.warnings,
      distance: computeTemplateDayDistance(day, policy),
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
  sectionName: string, sectionRawDsl: string, weeks: InstanceWeekInput[], sectionNotes?: string,
): SectionView {
  const weekViews: WeekView[] = weeks.map(week => {
    const days: DayView[] = week.days.map(day => ({
      day: day.day, suffix: day.suffix, category: day.category, workout_type: day.workout_type,
      dsl: day.dsl, notes: day.notes, needs_review: day.needs_review, warnings: [],
      distance: computeResolvedDayDistance(day), date: day.date,
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
  return sectionOrder.map(sectionName => {
    const weeks = bySection.get(sectionName)!;
    const weekInputs: InstanceWeekInput[] = [...weeks.keys()].sort((a, b) => a - b)
      .map(number => ({ number, days: weeks.get(number)! }));
    return buildInstanceSectionView(sectionName, "", weekInputs);
  });
}
