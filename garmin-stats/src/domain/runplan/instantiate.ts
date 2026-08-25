// ── RunPlan DSL v1 — template instantiation ─────────────────────────────────
// Pure logic (no I/O): given a parsed-but-unresolved RunPlan (a "template" —
// pace stays symbolic until resolved) plus a start date and pace-anchor
// overrides, produce the concrete resolved days for one instantiation
// (HRA-112). Reuses HRA-111's pace.ts rather than re-deriving resolution.
import type { DayEntry, Intensity, PacePolicy, RestSpec, RestType, RunPlan, Target, WorkoutSegment } from "./types.ts";
import { getEffectivePacePolicy, resolveIntensityToPace } from "./pace.ts";

export interface InstantiateOptions {
  startDate: string; // YYYY-MM-DD — the calendar date of K0, the template's week 1's lowest declared D-number (HRA-124; previously always D1's date)
  paceOverrides?: PacePolicy; // anchors to override at plan level before resolution
  // HRA-124: free-text label attached as `notes` on every day auto-filled to
  // plug a gap in a template week (a D-number 1-7 that week never declared) —
  // the New Instance form's "Rest day label" field.
  restDayLabel?: string;
}

export type ResolvedSegment =
  | { type: "continuous"; target: Target; resolved_pace_sec_per_km: number | null; raw: string }
  | {
      type: "interval"; reps: number | null; work_target: Target; work_resolved_pace_sec_per_km: number | null;
      rest?: { target: Target; resolved_pace_sec_per_km: number | null; rest_type?: RestSpec["rest_type"]; raw: string };
      raw: string;
    }
  | {
      type: "progression"; target: Target;
      start_resolved_pace_sec_per_km: number | null; end_resolved_pace_sec_per_km: number | null; raw: string;
    }
  | { type: "rest_block"; target: Target; rest_type?: RestSpec["rest_type"]; raw: string };

export interface ResolvedDay {
  section_name: string;
  week_number: number;
  date: string; // YYYY-MM-DD, concrete
  day: number;
  suffix?: string;
  category?: string;
  workout_type: DayEntry["workout_type"];
  segments: ResolvedSegment[];
  activity_target?: Target;
  activity_description?: string;
  notes?: string;
  needs_review: boolean;
}

// Week N's baseline date = trueMonday + (N-1)*7 days, UNLESS the template's
// own source already gave that week an explicit START — the explicit date
// wins (HRA-112, confirmed at Refinement). Each day within the week then
// offsets from that baseline by (day.day - 1) days (D1=baseline ...
// D7=baseline+6) — HRA-122: previously every day in a week shared the
// identical baseline date. trueMonday (HRA-124) is startDate walked back to
// what D1's date would be: startDate is K0's date (the lowest D-number the
// template's week 1 actually declares, not necessarily D1), so trueMonday =
// startDate - (K0-1) days — see computeK0 below.
function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// K0 = the lowest D-number declared anywhere in the template's week 1
// (HRA-124). Templates are expected to declare week 1 in exactly one
// section, but this scans every section defensively; returns null when no
// week 1 exists at all (trueMonday then just falls back to startDate itself,
// preserving pre-HRA-124 behavior).
function computeK0(plan: RunPlan): number | null {
  let k0: number | null = null;
  for (const section of plan.sections) {
    for (const week of section.weeks) {
      if (week.number !== 1) continue;
      for (const day of week.days) {
        if (k0 === null || day.day < k0) k0 = day.day;
      }
    }
  }
  return k0;
}

// Auto-fills a D-number the template left undeclared for a given week as a
// REST day (HRA-124) — rest_type carried on a synthetic rest_block segment
// (no real target, since there's nothing to rest from) rather than a new
// top-level field, reusing the existing ResolvedSegment vocabulary.
function makeRestFillDay(
  sectionName: string, weekNumber: number, date: string, dayNumber: number, restType: RestType, label: string | undefined,
): ResolvedDay {
  return {
    section_name: sectionName, week_number: weekNumber, date, day: dayNumber,
    workout_type: "rest",
    segments: [{ type: "rest_block", target: { kind: "unknown", raw: "" }, rest_type: restType, raw: "REST" }],
    notes: label && label.trim() !== "" ? label.trim() : undefined,
    needs_review: false,
  };
}

// resolvePaceOrNull reports failure via the `flag` accumulator (rather than
// module-level state) so instantiatePlan stays a pure function safe to call
// repeatedly/concurrently. A rest clause that never had an @ intensity at all
// (e.g. "r:90s stand") is not a failure — resolveSegment only calls this for
// intensities that are actually present.
function resolvePaceOrNull(intensity: Intensity, policy: PacePolicy, flag: { unresolved: boolean }): number | null {
  const result = resolveIntensityToPace(intensity, policy);
  if (!result.ok) flag.unresolved = true;
  return result.ok ? result.pace_sec_per_km : null;
}

function resolveSegment(seg: WorkoutSegment, policy: PacePolicy, flag: { unresolved: boolean }): ResolvedSegment {
  switch (seg.type) {
    case "continuous":
      return { type: "continuous", target: seg.target, resolved_pace_sec_per_km: resolvePaceOrNull(seg.intensity, policy, flag), raw: seg.raw };
    case "interval":
      return {
        type: "interval", reps: seg.reps, work_target: seg.work_target,
        work_resolved_pace_sec_per_km: resolvePaceOrNull(seg.work_intensity, policy, flag),
        rest: seg.rest && {
          target: seg.rest.target,
          resolved_pace_sec_per_km: seg.rest.intensity ? resolvePaceOrNull(seg.rest.intensity, policy, flag) : null,
          rest_type: seg.rest.rest_type, raw: seg.rest.raw,
        },
        raw: seg.raw,
      };
    case "progression":
      return {
        type: "progression", target: seg.target,
        start_resolved_pace_sec_per_km: resolvePaceOrNull(seg.start_intensity, policy, flag),
        end_resolved_pace_sec_per_km: resolvePaceOrNull(seg.end_intensity, policy, flag),
        raw: seg.raw,
      };
    case "rest_block":
      return { type: "rest_block", target: seg.target, rest_type: seg.rest_type, raw: seg.raw };
  }
}

// Resolves one already-parsed DayEntry against an effective pace policy into
// a concrete ResolvedDay — the same per-day step instantiatePlan runs in its
// loop below. Exported (HRA-115) so the plan-instances PUT endpoint's
// DSL-based day editing can resolve a single re-parsed day the exact same way
// a full instantiation would, without re-deriving this logic.
export function resolveDay(
  day: DayEntry, sectionName: string, weekNumber: number, date: string, policy: PacePolicy,
): ResolvedDay {
  const flag = { unresolved: false };
  const segments = day.segments.map(seg => resolveSegment(seg, policy, flag));
  return {
    section_name: sectionName, week_number: weekNumber, date,
    day: day.day, suffix: day.suffix, category: day.category, workout_type: day.workout_type,
    segments,
    activity_target: day.activity_target, activity_description: day.activity_description,
    notes: day.notes,
    needs_review: day.needs_review || flag.unresolved,
  };
}

// Applies paceOverrides at plan level (section/week overrides already in the
// template are preserved as-is — they still apply on top per HRA-111's own
// inheritance rule), then walks every section/week/day producing concrete
// resolved days. Does not mutate the input plan.
export function instantiatePlan(plan: RunPlan, options: InstantiateOptions): ResolvedDay[] {
  const overriddenPlan: RunPlan = {
    ...plan,
    metadata: { ...plan.metadata, pace_policy: { ...plan.metadata.pace_policy, ...options.paceOverrides } },
  };

  const k0 = computeK0(overriddenPlan) ?? 1;
  const trueMonday = addDays(options.startDate, -(k0 - 1));

  const days: ResolvedDay[] = [];
  for (const section of overriddenPlan.sections) {
    for (const week of section.weeks) {
      const policy = getEffectivePacePolicy(overriddenPlan, section, week);
      const weekDate = week.start_date ?? addDays(trueMonday, (week.number - 1) * 7);
      const weekDays: ResolvedDay[] = [];
      const declared = new Set(week.days.map(day => day.day));
      for (const day of week.days) {
        const dayDate = addDays(weekDate, day.day - 1);
        weekDays.push(resolveDay(day, section.name, week.number, dayDate, policy));
      }
      for (let d = 1; d <= 7; d++) {
        if (declared.has(d)) continue;
        const dayDate = addDays(weekDate, d - 1);
        weekDays.push(makeRestFillDay(section.name, week.number, dayDate, d, overriddenPlan.metadata.default_rest, options.restDayLabel));
      }
      weekDays.sort((a, b) => a.day - b.day);
      days.push(...weekDays);
    }
  }
  return days;
}
