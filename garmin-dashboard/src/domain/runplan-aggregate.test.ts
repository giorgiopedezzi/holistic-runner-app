import { describe, it, expect } from "vitest";
import {
  aggregateResolvedDays, aggregateTemplateSection, aggregateTemplateWeek,
  buildContinuousSegmentPresentation, buildDayClassificationContext, buildInstanceSectionView,
  buildIntervalSegmentPresentation, buildMultiSegmentPresentation, buildStateDayPresentation, buildTemplateSectionView, buildUnsupportedPresentation,
  classifyResolvedDay, computeResolvedDayDistance,
  computeResolvedDayMetrics, computeTemplateDayDistance, getEffectivePacePolicy,
  groupResolvedDaysIntoSectionViews, reconstructDslFromResolvedDay, resolveIntensityPaceSecPerKm,
  type DayView,
} from "./runplan-aggregate";
import type {
  DayEntry, PacePolicy, ResolvedDay, ResolvedSegment, Section, Target, Week, WorkoutSegment,
} from "../types/runplan";

const RG_ABSOLUTE: PacePolicy = { RG: { kind: "absolute", pace_sec_per_km: 300 } }; // 5:00/km

function target(kind: "distance" | "duration" | "unknown", value?: number): Target {
  if (kind === "distance") return { kind, distance_m: value!, raw: `${value}m` };
  if (kind === "duration") return { kind, duration_sec: value!, raw: `${value}s` };
  return { kind: "unknown", raw: "?" };
}

function day(overrides: Partial<DayEntry>): DayEntry {
  return {
    day: 1, workout_type: "run", segments: [], needs_review: false, raw_dsl: "D1: 5km @ RG", warnings: [],
    ...overrides,
  };
}

describe("resolveIntensityPaceSecPerKm", () => {
  it("resolves absolute intensities directly", () => {
    expect(resolveIntensityPaceSecPerKm({ kind: "absolute", pace_sec_per_km: 250, raw: "4:10/km" }, {})).toBe(250);
  });

  it("resolves an anchor and an offset against a policy", () => {
    expect(resolveIntensityPaceSecPerKm({ kind: "anchor", anchor: "RG", raw: "RG" }, RG_ABSOLUTE)).toBe(300);
    expect(resolveIntensityPaceSecPerKm({ kind: "offset", anchor: "RG", offset_sec_per_km: -20, raw: "RG-20" }, RG_ABSOLUTE)).toBe(280);
  });

  it("returns null for an unresolvable anchor, an unknown intensity, or a circular reference", () => {
    expect(resolveIntensityPaceSecPerKm({ kind: "anchor", anchor: "FL", raw: "FL" }, {})).toBeNull();
    expect(resolveIntensityPaceSecPerKm({ kind: "unknown", raw: "?" }, {})).toBeNull();
    const circular: PacePolicy = { A: { kind: "offset", anchor: "B", offset_sec_per_km: 0 }, B: { kind: "offset", anchor: "A", offset_sec_per_km: 0 } };
    expect(resolveIntensityPaceSecPerKm({ kind: "anchor", anchor: "A", raw: "A" }, circular)).toBeNull();
  });
});

describe("computeTemplateDayDistance — the distance rule", () => {
  it("sums a distance-kind continuous segment directly, no approximation", () => {
    const d = day({ segments: [{ type: "continuous", target: target("distance", 5000), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" }] });
    expect(computeTemplateDayDistance(d, RG_ABSOLUTE)).toEqual({ meters: 5000, approximate: false });
  });

  it("converts a duration-kind target using the resolved pace, flagging approximate", () => {
    const d = day({ segments: [{ type: "continuous", target: target("duration", 1500), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "25min @ RG" }] });
    // 1500s at 300s/km = 5km = 5000m
    expect(computeTemplateDayDistance(d, RG_ABSOLUTE)).toEqual({ meters: 5000, approximate: true });
  });

  it("excludes a duration target whose anchor doesn't resolve", () => {
    const d = day({ segments: [{ type: "continuous", target: target("duration", 1500), intensity: { kind: "anchor", anchor: "FL", raw: "FL" }, raw: "25min @ FL" }] });
    expect(computeTemplateDayDistance(d, {})).toEqual({ meters: 0, approximate: false });
  });

  it("excludes any segment with an unknown target or intensity", () => {
    const d = day({ segments: [{ type: "continuous", target: target("unknown"), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "? @ RG" }] });
    expect(computeTemplateDayDistance(d, RG_ABSOLUTE)).toEqual({ meters: 0, approximate: false });
  });

  it("multiplies an interval's (work + rest) leg by reps — bug fix, the rest leg used to be dropped", () => {
    const seg: WorkoutSegment = {
      type: "interval", reps: 4, work_target: target("distance", 1000), work_intensity: { kind: "offset", anchor: "RG", offset_sec_per_km: -20, raw: "RG-20" },
      rest: { target: target("distance", 1000), raw: "r:1km" }, raw: "4x1000m @ RG-20 r:1km",
    };
    // 4 x (1000m work + 1000m rest) = 8000m — real ground covered on both legs.
    expect(computeTemplateDayDistance(day({ segments: [seg] }), RG_ABSOLUTE)).toEqual({ meters: 8000, approximate: false });
  });

  it("an interval with no rest leg at all still sums work-only, unaffected by the fix above", () => {
    const seg: WorkoutSegment = {
      type: "interval", reps: 4, work_target: target("distance", 1000), work_intensity: { kind: "offset", anchor: "RG", offset_sec_per_km: -20, raw: "RG-20" },
      raw: "4x1000m @ RG-20",
    };
    expect(computeTemplateDayDistance(day({ segments: [seg] }), RG_ABSOLUTE)).toEqual({ meters: 4000, approximate: false });
  });

  it("excludes an interval with an unspecified rep count (the ? placeholder)", () => {
    const seg: WorkoutSegment = {
      type: "interval", reps: null, work_target: target("distance", 1000), work_intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "?x1000m @ RG",
    };
    expect(computeTemplateDayDistance(day({ segments: [seg] }), RG_ABSOLUTE)).toEqual({ meters: 0, approximate: false });
  });

  it("uses the progression's start intensity for duration conversion", () => {
    const seg: WorkoutSegment = {
      type: "progression", target: target("duration", 600), start_intensity: { kind: "absolute", pace_sec_per_km: 300, raw: "5:00/km" },
      end_intensity: { kind: "absolute", pace_sec_per_km: 240, raw: "4:00/km" }, raw: "10min PROG 5:00/km -> 4:00/km",
    };
    // 600s at 300s/km = 2km = 2000m (start pace, not end or average)
    expect(computeTemplateDayDistance(day({ segments: [seg] }), {})).toEqual({ meters: 2000, approximate: true });
  });

  it("never resolves a rest_block's duration target (no intensity ever exists on it), but sums a distance one", () => {
    const distanceRest: WorkoutSegment = { type: "rest_block", target: target("distance", 400), raw: "REST 400m" };
    const durationRest: WorkoutSegment = { type: "rest_block", target: target("duration", 60), raw: "REST 60s" };
    expect(computeTemplateDayDistance(day({ segments: [distanceRest] }), {})).toEqual({ meters: 400, approximate: false });
    expect(computeTemplateDayDistance(day({ segments: [durationRest] }), RG_ABSOLUTE)).toEqual({ meters: 0, approximate: false });
  });

  it("counts a CROSS/STRENGTH activity_target directly (distance) or excludes it (duration, no pace ever possible)", () => {
    const crossDistance = day({ workout_type: "cross", segments: [], activity_target: target("distance", 10000) });
    const crossDuration = day({ workout_type: "cross", segments: [], activity_target: target("duration", 2700) });
    expect(computeTemplateDayDistance(crossDistance, {})).toEqual({ meters: 10000, approximate: false });
    expect(computeTemplateDayDistance(crossDuration, {})).toEqual({ meters: 0, approximate: false });
  });

  it("REST and TODO days always total zero distance, regardless of any segments", () => {
    expect(computeTemplateDayDistance(day({ workout_type: "rest" }), {})).toEqual({ meters: 0, approximate: false });
    expect(computeTemplateDayDistance(day({ workout_type: "todo" }), {})).toEqual({ meters: 0, approximate: false });
  });
});

describe("computeResolvedDayDistance — same rule, already-resolved paces", () => {
  function resolvedDay(overrides: Partial<ResolvedDay>): ResolvedDay {
    return { section_name: "Base", week_number: 1, date: "2026-09-01", day: 1, workout_type: "run", segments: [], needs_review: false, ...overrides };
  }

  it("sums a resolved continuous segment and excludes an unresolved duration one", () => {
    const resolved: ResolvedSegment = { type: "continuous", target: target("distance", 8000), resolved_pace_sec_per_km: 300, raw: "8km @ RG" };
    expect(computeResolvedDayDistance(resolvedDay({ segments: [resolved] }))).toEqual({ meters: 8000, approximate: false });

    const unresolved: ResolvedSegment = { type: "continuous", target: target("duration", 1500), resolved_pace_sec_per_km: null, raw: "25min @ FL" };
    expect(computeResolvedDayDistance(resolvedDay({ segments: [unresolved] }))).toEqual({ meters: 0, approximate: false });
  });

  it("multiplies a resolved interval's (work + rest) leg by reps — bug fix", () => {
    const resolved: ResolvedSegment = {
      type: "interval", reps: 4, work_target: target("distance", 1000), work_resolved_pace_sec_per_km: 280,
      rest: { target: target("distance", 1000), resolved_pace_sec_per_km: 310, raw: "r:1km @ RG+10" }, raw: "4x1000m @ RG-20 r:1km @ RG+10",
    };
    expect(computeResolvedDayDistance(resolvedDay({ segments: [resolved] }))).toEqual({ meters: 8000, approximate: false });
  });

  it("live bug report: 3x3000m @ 3:56/km r:1km @ 4:26/km totals 12km (3 work + 3 rest legs)", () => {
    const resolved: ResolvedSegment = {
      type: "interval", reps: 3, work_target: target("distance", 3000), work_resolved_pace_sec_per_km: 236,
      rest: { target: target("distance", 1000), resolved_pace_sec_per_km: 266, raw: "r:1km @ 4:26/km" }, raw: "3x3000m @ 3:56/km r:1km @ 4:26/km",
    };
    expect(computeResolvedDayDistance(resolvedDay({ segments: [resolved] }))).toEqual({ meters: 12000, approximate: false });
  });
});

describe("aggregate day-count categorization", () => {
  it("counts total/active/running/rest days correctly across a mixed week", () => {
    const days: DayEntry[] = [
      day({ day: 1, workout_type: "run" }),
      day({ day: 2, workout_type: "rest" }),
      day({ day: 3, workout_type: "cross" }),
      day({ day: 4, workout_type: "strength" }),
      day({ day: 5, workout_type: "todo" }),
      day({ day: 6, workout_type: "run" }),
      day({ day: 7, workout_type: "rest" }),
    ];
    const section: Section = { name: "Base", week_spec: "1", pace_policy: {}, raw_dsl: "SECTION \"Base\" WEEKS 1", weeks: [{ number: 1, pace_policy: {}, days, raw_dsl: "WEEK 1" }] };
    const totals = aggregateTemplateSection(section, {});
    expect(totals.totalDays).toBe(7);
    expect(totals.activeDays).toBe(4); // run, cross, strength, run (todo excluded)
    expect(totals.runningDays).toBe(2);
    expect(totals.restDays).toBe(2);
    expect(totals.otherDays).toBe(0);
  });

  // HRA-156
  it("counts 'other' days separately, excluded from activeDays same as todo", () => {
    const days: DayEntry[] = [
      day({ day: 1, workout_type: "run" }),
      day({ day: 2, workout_type: "other" }),
      day({ day: 3, workout_type: "other" }),
    ];
    const section: Section = { name: "Base", week_spec: "1", pace_policy: {}, raw_dsl: "SECTION \"Base\" WEEKS 1", weeks: [{ number: 1, pace_policy: {}, days, raw_dsl: "WEEK 1" }] };
    const totals = aggregateTemplateSection(section, {});
    expect(totals.totalDays).toBe(3);
    expect(totals.activeDays).toBe(1); // run only — both "other" days excluded
    expect(totals.otherDays).toBe(2);
  });
});

describe("pace policy inheritance (Plan -> Section -> Week)", () => {
  it("a week override wins over a section override, which wins over the plan", () => {
    const planPolicy: PacePolicy = { RG: { kind: "absolute", pace_sec_per_km: 300 } };
    const sectionPolicy: PacePolicy = { RG: { kind: "absolute", pace_sec_per_km: 290 } };
    const weekPolicy: PacePolicy = { RG: { kind: "absolute", pace_sec_per_km: 280 } };
    expect(getEffectivePacePolicy(planPolicy, sectionPolicy, weekPolicy).RG).toEqual({ kind: "absolute", pace_sec_per_km: 280 });
    expect(getEffectivePacePolicy(planPolicy, sectionPolicy, {}).RG).toEqual({ kind: "absolute", pace_sec_per_km: 290 });
    expect(getEffectivePacePolicy(planPolicy, {}, {}).RG).toEqual({ kind: "absolute", pace_sec_per_km: 300 });
  });

  it("aggregateTemplateWeek resolves each week against its own effective policy, not a shared one", () => {
    const week1: Week = { number: 1, pace_policy: {}, raw_dsl: "WEEK 1", days: [day({ segments: [{ type: "continuous", target: target("distance", 1000), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "1km @ RG" }] })] };
    const week2: Week = { number: 2, pace_policy: { RG: { kind: "absolute", pace_sec_per_km: 280 } }, raw_dsl: "WEEK 2", days: [] };
    const section: Section = { name: "Base", week_spec: "1-2", pace_policy: {}, raw_dsl: "SECTION \"Base\" WEEKS 1-2", weeks: [week1, week2] };
    const planPolicy: PacePolicy = { RG: { kind: "absolute", pace_sec_per_km: 300 } };
    // week1 has no own override, so it resolves against the plan-level RG (300s/km) — distance is unaffected here since target is already distance-kind, but the effective-policy plumbing is what's under test.
    const totals = aggregateTemplateWeek(section, week1, planPolicy);
    expect(totals.distance).toEqual({ meters: 1000, approximate: false });
  });
});

describe("view-model builders", () => {
  it("buildTemplateSectionView carries raw_dsl through untouched, including the default section's empty one", () => {
    const week: Week = { number: 1, pace_policy: {}, raw_dsl: "WEEK 1", days: [day({})] };
    const defaultSection: Section = { name: "Plan", week_spec: "*", pace_policy: {}, raw_dsl: "", weeks: [week] };
    const view = buildTemplateSectionView(defaultSection, {});
    expect(view.raw_dsl).toBe("");
    expect(view.name).toBe("Plan"); // underlying name is untouched — display substitution is the component's job, not the builder's
    expect(view.weeks[0].raw_dsl).toBe("WEEK 1");
    expect(view.weeks[0].days[0].dsl).toBe("D1: 5km @ RG");
  });

  it("buildInstanceSectionView groups flat resolved days and computes totals the same way", () => {
    const resolvedDay: ResolvedDay = { section_name: "Base", week_number: 1, date: "2026-09-01", day: 1, workout_type: "run", needs_review: false, segments: [{ type: "continuous", target: target("distance", 6000), resolved_pace_sec_per_km: 300, raw: "6km @ RG" }] };
    const days = [{ ...resolvedDay, dsl: "D1: 6km @ RG" }];
    const view = buildInstanceSectionView("Base", "SECTION \"Base\" WEEKS 1", [{ number: 1, days }], buildDayClassificationContext(days));
    expect(view.totals.distance).toEqual({ meters: 6000, approximate: false });
    expect(view.weeks[0].days[0].dsl).toBe("D1: 6km @ RG");
    expect(view.weeks[0].raw_dsl).toBe("");
    expect(view.weeks[0].days[0].paceTargetBands?.pieces[0]).toMatchObject({
      kind: "band", startDistanceM: 0, endDistanceM: 6000,
    });
    // HRA-148: trainingLoadCategory is populated on the instance path (it's the week's
    // only, and therefore longest, run day, so the long-run overlay wins here).
    expect(view.weeks[0].days[0].trainingLoadCategory).toBe("long_run");
  });

  it("buildTemplateSectionView never sets trainingLoadCategory — classification needs a resolved pace, which a template day doesn't have yet", () => {
    const week: Week = { number: 1, pace_policy: {}, raw_dsl: "WEEK 1", days: [day({})] };
    const section: Section = { name: "Base", week_spec: "1", pace_policy: {}, raw_dsl: "SECTION \"Base\" WEEKS 1", weeks: [week] };
    const view = buildTemplateSectionView(section, {});
    expect(view.weeks[0].days[0].trainingLoadCategory).toBeUndefined();
  });
});

describe("buildContinuousSegmentPresentation (HRA-229)", () => {
  function dayView(segments: WorkoutSegment[]): DayView {
    return {
      day: 1, workout_type: "run", dsl: "D1: x", needs_review: false, warnings: [],
      distance: { meters: 0, approximate: false }, segments,
    };
  }

  it("normalizes a whole-km distance target, keeping the pace token verbatim", () => {
    const view = dayView([{
      type: "continuous", target: { kind: "distance", distance_m: 10000, raw: "10km" },
      intensity: { kind: "anchor", anchor: "FL", raw: "FL" }, raw: "10km @ FL",
    }]);
    expect(buildContinuousSegmentPresentation(view)).toEqual({ distanceOrDuration: "10 km", pace: "FL" });
  });

  it("normalizes a meters target that's a whole number of km", () => {
    const view = dayView([{
      type: "continuous", target: { kind: "distance", distance_m: 8000, raw: "8000m" },
      intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "8000m @ RG",
    }]);
    expect(buildContinuousSegmentPresentation(view)).toEqual({ distanceOrDuration: "8 km", pace: "RG" });
  });

  it("a mile-authored distance target displays in mi, never reformatted into km", () => {
    const view = dayView([{
      type: "continuous", target: { kind: "distance", distance_m: 4828.02, raw: "3mi" },
      intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "3mi @ RG",
    }]);
    expect(buildContinuousSegmentPresentation(view)).toEqual({ distanceOrDuration: "3 mi", pace: "RG" });
  });

  it("normalizes a duration target's spacing, keeping an absolute pace token verbatim", () => {
    const view = dayView([{
      type: "continuous", target: { kind: "duration", duration_sec: 1800, raw: "30min" },
      intensity: { kind: "absolute", pace_sec_per_km: 256, raw: "4:16/km" }, raw: "30min @ 4:16/km",
    }]);
    expect(buildContinuousSegmentPresentation(view)).toEqual({ distanceOrDuration: "30 min", pace: "4:16/km" });
  });

  it("returns null for a non-run day, a multi-segment day, and a non-continuous single segment", () => {
    expect(buildContinuousSegmentPresentation({ ...dayView([]), workout_type: "rest" })).toBeNull();
    expect(buildContinuousSegmentPresentation(dayView([
      { type: "continuous", target: target("distance", 5000), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" },
      { type: "continuous", target: target("distance", 1000), intensity: { kind: "anchor", anchor: "FL", raw: "FL" }, raw: "1km @ FL" },
    ]))).toBeNull();
    expect(buildContinuousSegmentPresentation(dayView([
      { type: "rest_block", target: target("distance", 400), raw: "REST 400m" },
    ]))).toBeNull();
  });

  it("returns null when a template day has no segments array (instance path)", () => {
    const view = dayView([]);
    delete (view as { segments?: WorkoutSegment[] }).segments;
    expect(buildContinuousSegmentPresentation(view)).toBeNull();
  });
});

describe("buildIntervalSegmentPresentation (HRA-230)", () => {
  function dayView(segments: WorkoutSegment[]): DayView {
    return {
      day: 1, workout_type: "run", dsl: "D1: x", needs_review: false, warnings: [],
      distance: { meters: 0, approximate: false }, segments,
    };
  }

  it("groups the epic's own example — distance work + distance recovery with an offset pace — into one block", () => {
    const view = dayView([{
      type: "interval", reps: 3,
      work_target: { kind: "distance", distance_m: 8000, raw: "8000m" },
      work_intensity: { kind: "anchor", anchor: "RG", raw: "RG" },
      rest: {
        target: { kind: "distance", distance_m: 1000, raw: "1km" },
        intensity: { kind: "offset", anchor: "RG", offset_sec_per_km: 30, raw: "RG+30" },
        raw: "r:1km @ RG+30",
      },
      raw: "3x8000m @ RG r:1km @ RG+30",
    }]);
    expect(buildIntervalSegmentPresentation(view)).toEqual({
      repetitions: "3", distanceOrDuration: "8 km", pace: "RG",
      recovery: { recovery: "1 km", recoveryPace: "RG+30" },
    });
  });

  it("renders a duration recovery target with its own pace", () => {
    const view = dayView([{
      type: "interval", reps: 5,
      work_target: { kind: "distance", distance_m: 1000, raw: "1000m" },
      work_intensity: { kind: "absolute", pace_sec_per_km: 240, raw: "4:00/km" },
      rest: {
        target: { kind: "duration", duration_sec: 90, raw: "90s" },
        intensity: { kind: "absolute", pace_sec_per_km: 360, raw: "6:00/km" },
        raw: "r:90s @ 6:00/km",
      },
      raw: "5x1000m @ 4:00/km r:90s @ 6:00/km",
    }]);
    expect(buildIntervalSegmentPresentation(view)).toEqual({
      repetitions: "5", distanceOrDuration: "1 km", pace: "4:00/km",
      recovery: { recovery: "90 s", recoveryPace: "6:00/km" },
    });
  });

  it("renders a standing/walk/jog recovery with no pace as a recovery row with no recovery pace field", () => {
    const view = dayView([{
      type: "interval", reps: 8,
      work_target: { kind: "distance", distance_m: 400, raw: "400m" },
      work_intensity: { kind: "anchor", anchor: "TH", raw: "TH" },
      rest: {
        target: { kind: "distance", distance_m: 400, raw: "400m" },
        rest_type: "stand",
        raw: "r:400m stand",
      },
      raw: "8x400m @ TH r:400m stand",
    }]);
    expect(buildIntervalSegmentPresentation(view)).toEqual({
      repetitions: "8", distanceOrDuration: "400 m", pace: "TH",
      recovery: { recovery: "400 m", recoveryPace: undefined },
    });
  });

  it("renders only the primary row, with no recovery, for an interval with no r: clause", () => {
    const view = dayView([{
      type: "interval", reps: 4,
      work_target: { kind: "distance", distance_m: 3000, raw: "3000m" },
      work_intensity: { kind: "offset", anchor: "RG", offset_sec_per_km: -20, raw: "RG-20" },
      raw: "4x3000m @ RG-20",
    }]);
    expect(buildIntervalSegmentPresentation(view)).toEqual({
      repetitions: "4", distanceOrDuration: "3 km", pace: "RG-20", recovery: undefined,
    });
  });

  it("returns null for a non-run day, a multi-segment day, and a non-interval single segment", () => {
    expect(buildIntervalSegmentPresentation({ ...dayView([]), workout_type: "rest" })).toBeNull();
    expect(buildIntervalSegmentPresentation(dayView([
      { type: "interval", reps: 3, work_target: target("distance", 1000), work_intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "3x1km @ RG" },
      { type: "continuous", target: target("distance", 1000), intensity: { kind: "anchor", anchor: "FL", raw: "FL" }, raw: "1km @ FL" },
    ]))).toBeNull();
    expect(buildIntervalSegmentPresentation(dayView([
      { type: "continuous", target: target("distance", 5000), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" },
    ]))).toBeNull();
  });
});

describe("buildStateDayPresentation (HRA-231)", () => {
  function dayView(workoutType: DayView["workout_type"], overrides: Partial<DayView> = {}): DayView {
    return {
      day: 1, workout_type: workoutType, dsl: "D1: x", needs_review: false, warnings: [],
      distance: { meters: 0, approximate: false }, ...overrides,
    };
  }

  it("returns the workout_type for REST, OTHER, and TODO days", () => {
    expect(buildStateDayPresentation(dayView("rest"))).toBe("rest");
    expect(buildStateDayPresentation(dayView("other"))).toBe("other");
    expect(buildStateDayPresentation(dayView("todo"))).toBe("todo");
  });

  it("returns null for run, cross, and strength days", () => {
    expect(buildStateDayPresentation(dayView("run"))).toBeNull();
    expect(buildStateDayPresentation(dayView("cross"))).toBeNull();
    expect(buildStateDayPresentation(dayView("strength"))).toBeNull();
  });

  it("a note survives regardless of the structured state — notes are a plain passthrough field", () => {
    const view = dayView("rest", { notes: "easy shakeout" });
    expect(buildStateDayPresentation(view)).toBe("rest");
    expect(view.notes).toBe("easy shakeout");
  });
});

describe("buildUnsupportedPresentation (HRA-231)", () => {
  function dayView(workoutType: DayView["workout_type"], segments?: WorkoutSegment[]): DayView {
    return {
      day: 1, workout_type: workoutType, dsl: "D1: x", needs_review: false, warnings: [],
      distance: { meters: 0, approximate: false }, segments,
    };
  }

  it("flags a CROSS day as unsupported", () => {
    expect(buildUnsupportedPresentation(dayView("cross"))).toBe("cross_strength");
  });

  it("flags a STRENGTH day as unsupported", () => {
    expect(buildUnsupportedPresentation(dayView("strength"))).toBe("cross_strength");
  });

  it("flags a run day containing a progression segment as unsupported", () => {
    const view = dayView("run", [{
      type: "progression", target: target("distance", 5000),
      start_intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, end_intensity: { kind: "anchor", anchor: "FL", raw: "FL" },
      raw: "5km PROG RG -> FL",
    }]);
    expect(buildUnsupportedPresentation(view)).toBe("progression");
  });

  it("flags a mixed day (continuous + progression) as unsupported at the day level", () => {
    const view = dayView("run", [
      { type: "continuous", target: target("distance", 5000), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" },
      { type: "progression", target: target("distance", 3000), start_intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, end_intensity: { kind: "anchor", anchor: "FL", raw: "FL" }, raw: "3km PROG RG -> FL" },
    ]);
    expect(buildUnsupportedPresentation(view)).toBe("progression");
  });

  it("returns null for REST/OTHER/TODO days and a plain continuous run day", () => {
    expect(buildUnsupportedPresentation(dayView("rest"))).toBeNull();
    expect(buildUnsupportedPresentation(dayView("todo"))).toBeNull();
    expect(buildUnsupportedPresentation(dayView("other"))).toBeNull();
    expect(buildUnsupportedPresentation(dayView("run", [
      { type: "continuous", target: target("distance", 5000), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" },
    ]))).toBeNull();
  });
});

describe("buildMultiSegmentPresentation (HRA-232)", () => {
  function dayView(segments: WorkoutSegment[]): DayView {
    return {
      day: 1, workout_type: "run", dsl: "D1: x", needs_review: false, warnings: [],
      distance: { meters: 0, approximate: false }, segments,
    };
  }

  it("returns null for a single-segment day, a non-run day, and a day with no segments array", () => {
    expect(buildMultiSegmentPresentation(dayView([
      { type: "continuous", target: target("distance", 5000), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" },
    ]))).toBeNull();
    expect(buildMultiSegmentPresentation({ ...dayView([]), workout_type: "rest" })).toBeNull();
    const noSegments = dayView([]);
    delete (noSegments as { segments?: WorkoutSegment[] }).segments;
    expect(buildMultiSegmentPresentation(noSegments)).toBeNull();
  });

  it("the epic's own example — two continuous segments in source order, each labeled Segment 1 / Segment 2", () => {
    const view = dayView([
      { type: "continuous", target: target("distance", 10000), intensity: { kind: "offset", anchor: "RG", offset_sec_per_km: 20, raw: "RG+20" }, raw: "10km @ RG+20" },
      { type: "continuous", target: target("distance", 10000), intensity: { kind: "offset", anchor: "RG", offset_sec_per_km: -5, raw: "RG-5" }, raw: "10km @ RG-5" },
    ]);
    expect(buildMultiSegmentPresentation(view)).toEqual([
      { index: 1, kind: "continuous", presentation: { distanceOrDuration: "10 km", pace: "RG+20" } },
      { index: 2, kind: "continuous", presentation: { distanceOrDuration: "10 km", pace: "RG-5" } },
    ]);
  });

  it("a 3+ segment day mixing continuous and interval segments renders all segments, correctly labeled and ordered", () => {
    const view = dayView([
      { type: "continuous", target: target("distance", 3000), intensity: { kind: "anchor", anchor: "FL", raw: "FL" }, raw: "3km @ FL" },
      {
        type: "interval", reps: 4,
        work_target: { kind: "distance", distance_m: 1000, raw: "1000m" },
        work_intensity: { kind: "anchor", anchor: "RG", raw: "RG" },
        rest: { target: { kind: "distance", distance_m: 200, raw: "200m" }, raw: "r:200m" },
        raw: "4x1000m @ RG r:200m",
      },
      { type: "continuous", target: target("distance", 2000), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "2km @ RG" },
    ]);
    const entries = buildMultiSegmentPresentation(view);
    expect(entries).toHaveLength(3);
    expect(entries!.map(e => e.index)).toEqual([1, 2, 3]);
    expect(entries![0]).toEqual({ index: 1, kind: "continuous", presentation: { distanceOrDuration: "3 km", pace: "FL" } });
    expect(entries![1]).toMatchObject({ index: 2, kind: "interval", presentation: { repetitions: "4", distanceOrDuration: "1 km", pace: "RG" } });
    expect(entries![2]).toEqual({ index: 3, kind: "continuous", presentation: { distanceOrDuration: "2 km", pace: "RG" } });
  });

  it("marks a progression segment within a multi-segment day as unsupported at its own slot, without dropping it from the sequence", () => {
    const view = dayView([
      { type: "continuous", target: target("distance", 5000), intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" },
      { type: "progression", target: target("distance", 3000), start_intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, end_intensity: { kind: "anchor", anchor: "FL", raw: "FL" }, raw: "3km PROG RG -> FL" },
    ]);
    expect(buildMultiSegmentPresentation(view)).toEqual([
      { index: 1, kind: "continuous", presentation: { distanceOrDuration: "5 km", pace: "RG" } },
      { index: 2, kind: "unsupported" },
    ]);
  });
});

describe("buildContinuousSegmentPresentation / buildIntervalSegmentPresentation — unknown-token marking (HRA-231)", () => {
  function dayView(segments: WorkoutSegment[]): DayView {
    return {
      day: 1, workout_type: "run", dsl: "D1: x", needs_review: false, warnings: [],
      distance: { meters: 0, approximate: false }, segments,
    };
  }

  it("flags a ?-placeholder continuous target as unknown, keeping the known pace unflagged", () => {
    const view = dayView([{
      type: "continuous", target: { kind: "unknown", raw: "?" },
      intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "? @ RG",
    }]);
    expect(buildContinuousSegmentPresentation(view)).toEqual({
      distanceOrDuration: "?", distanceOrDurationUnknown: true, pace: "RG",
    });
  });

  it("flags a ?-placeholder interval — unspecified reps, unknown work target and pace — leaving the recovery leg unflagged", () => {
    const view = dayView([{
      type: "interval", reps: null,
      work_target: { kind: "unknown", raw: "?" }, work_intensity: { kind: "unknown", raw: "?" },
      rest: { target: { kind: "distance", distance_m: 400, raw: "400m" }, intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "r:400m @ RG" },
      raw: "?x? @ ? r:400m @ RG",
    }]);
    expect(buildIntervalSegmentPresentation(view)).toEqual({
      repetitions: "?", repetitionsUnknown: true,
      distanceOrDuration: "?", distanceOrDurationUnknown: true,
      pace: "?", paceUnknown: true,
      recovery: { recovery: "400 m", recoveryPace: "RG" },
    });
  });
});

describe("aggregateResolvedDays", () => {
  it("matches the same categorization rule as the template path", () => {
    const days: ResolvedDay[] = [
      { section_name: "Base", week_number: 1, date: "2026-09-01", day: 1, workout_type: "run", needs_review: false, segments: [] },
      { section_name: "Base", week_number: 1, date: "2026-09-02", day: 2, workout_type: "rest", needs_review: false, segments: [] },
    ];
    const totals = aggregateResolvedDays(days);
    expect(totals).toMatchObject({ totalDays: 2, activeDays: 1, runningDays: 1, restDays: 1 });
  });
});

describe("reconstructDslFromResolvedDay (HRA-118)", () => {
  function resolvedDay(overrides: Partial<ResolvedDay>): ResolvedDay {
    return { section_name: "Base", week_number: 1, date: "2026-09-01", day: 3, workout_type: "run", needs_review: false, segments: [], ...overrides };
  }

  it("reconstructs a continuous segment using the target's original raw text and an absolute-pace intensity", () => {
    const seg: ResolvedSegment = { type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: 280, raw: "5km @ RG-20" };
    expect(reconstructDslFromResolvedDay(resolvedDay({ segments: [seg] }))).toBe("D3: 5km @ 4:40/km");
  });

  it("reconstructs an interval with reps, work leg, and rest leg", () => {
    const seg: ResolvedSegment = {
      type: "interval", reps: 4, work_target: { kind: "distance", distance_m: 1000, raw: "1000m" }, work_resolved_pace_sec_per_km: 280,
      rest: { target: { kind: "distance", distance_m: 1000, raw: "1km" }, resolved_pace_sec_per_km: 310, raw: "r:1km @ RG+10" }, raw: "4x1000m @ RG-20 r:1km @ RG+10",
    };
    expect(reconstructDslFromResolvedDay(resolvedDay({ segments: [seg] }))).toBe("D3: 4x1000m @ 4:40/km r:1km @ 5:10/km");
  });

  it("uses ? for an unresolved (null) intensity rather than fabricating a pace", () => {
    const seg: ResolvedSegment = { type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: null, raw: "5km @ FL" };
    expect(reconstructDslFromResolvedDay(resolvedDay({ segments: [seg] }))).toBe("D3: 5km @ ?");
  });

  it("reconstructs REST/TODO/OTHER/CROSS days by literal keyword, with suffix/category/note carried through", () => {
    expect(reconstructDslFromResolvedDay(resolvedDay({ workout_type: "rest" }))).toBe("D3: REST");
    expect(reconstructDslFromResolvedDay(resolvedDay({ workout_type: "todo" }))).toBe("D3: TODO");
    expect(reconstructDslFromResolvedDay(resolvedDay({ workout_type: "other", notes: "handwritten note" }))).toBe("D3: OTHER # handwritten note");
    expect(reconstructDslFromResolvedDay(resolvedDay({
      day: 6, suffix: "a", category: "double", workout_type: "cross",
      activity_target: { kind: "duration", duration_sec: 2700, raw: "45min" }, activity_description: "bike", notes: "easy spin",
    }))).toBe("D6a [double]: CROSS 45min bike # easy spin");
  });
});

describe("computeResolvedDayMetrics (HRA-145)", () => {
  function resolvedDay(overrides: Partial<ResolvedDay>): ResolvedDay {
    return { section_name: "Base", week_number: 1, date: "2026-09-01", day: 3, workout_type: "run", needs_review: false, segments: [], ...overrides };
  }

  it("continuous: derives speed (3600/pace) and duration (distance/pace) from a resolved distance target", () => {
    const seg: ResolvedSegment = { type: "continuous", target: target("distance", 6000), resolved_pace_sec_per_km: 300, raw: "6km @ RG" };
    const metrics = computeResolvedDayMetrics(resolvedDay({ segments: [seg] }));
    expect(metrics).toEqual({ totalDistanceM: 6000, minSpeedKmh: 12, maxSpeedKmh: 12, totalDurationSec: 1800 });
  });

  it("interval: distance and duration both include the rest leg; speed excludes it (a recovery jog isn't the work effort)", () => {
    const seg: ResolvedSegment = {
      type: "interval", reps: 4, work_target: target("distance", 1000), work_resolved_pace_sec_per_km: 280,
      rest: { target: target("distance", 1000), resolved_pace_sec_per_km: 310, raw: "r:1km @ RG+10" }, raw: "4x1000m @ RG-20 r:1km @ RG+10",
    };
    const metrics = computeResolvedDayMetrics(resolvedDay({ segments: [seg] }));
    expect(metrics.totalDistanceM).toBe(8000); // 4 x (1000m work + 1000m rest) — bug fix, rest leg used to be dropped
    expect(metrics.minSpeedKmh).toBeCloseTo(3600 / 280); // work-leg pace only
    expect(metrics.maxSpeedKmh).toBeCloseTo(3600 / 280);
    expect(metrics.totalDurationSec).toBe((280 + 310) * 4); // work + rest, x4 reps — real elapsed clock time
  });

  it("progression: both start AND end pace count toward min/max speed; duration uses the start pace", () => {
    const seg: ResolvedSegment = {
      type: "progression", target: target("distance", 5000),
      start_resolved_pace_sec_per_km: 300, end_resolved_pace_sec_per_km: 250, raw: "5km PROG RG -> RG-50",
    };
    const metrics = computeResolvedDayMetrics(resolvedDay({ segments: [seg] }));
    expect(metrics.totalDistanceM).toBe(5000);
    expect(metrics.minSpeedKmh).toBeCloseTo(3600 / 300); // 12
    expect(metrics.maxSpeedKmh).toBeCloseTo(3600 / 250); // 14.4
    expect(metrics.totalDurationSec).toBe((5000 / 1000) * 300); // start pace, mirrors the distance rule's own choice
  });

  it("unresolved anchor (distance target, null pace): speed and duration are excluded entirely, never treated as zero", () => {
    // A distance-kind target's own distance is data, not pace-derived, so it
    // still counts — only speed (needs a pace directly) and duration (needs
    // pace to convert distance -> time) are unresolvable without one.
    const seg: ResolvedSegment = { type: "continuous", target: target("distance", 5000), resolved_pace_sec_per_km: null, raw: "5km @ FL" };
    const metrics = computeResolvedDayMetrics(resolvedDay({ segments: [seg] }));
    expect(metrics).toEqual({ totalDistanceM: 5000, minSpeedKmh: null, maxSpeedKmh: null, totalDurationSec: 0 });
  });

  it("unresolved anchor (duration target, null pace): distance is excluded (needs pace to convert), but duration is the target's own known time, not pace-derived", () => {
    const seg: ResolvedSegment = { type: "continuous", target: target("duration", 600), resolved_pace_sec_per_km: null, raw: "10min @ FL" };
    const metrics = computeResolvedDayMetrics(resolvedDay({ segments: [seg] }));
    expect(metrics).toEqual({ totalDistanceM: 0, minSpeedKmh: null, maxSpeedKmh: null, totalDurationSec: 600 });
  });

  it("REST/TODO days have no distance, no speed, and no duration", () => {
    expect(computeResolvedDayMetrics(resolvedDay({ workout_type: "rest" }))).toEqual({ totalDistanceM: 0, minSpeedKmh: null, maxSpeedKmh: null, totalDurationSec: 0 });
    expect(computeResolvedDayMetrics(resolvedDay({ workout_type: "todo" }))).toEqual({ totalDistanceM: 0, minSpeedKmh: null, maxSpeedKmh: null, totalDurationSec: 0 });
  });

  it("CROSS/STRENGTH: distance/duration come from activity_target directly, speed is never resolvable (no intensity concept)", () => {
    const metrics = computeResolvedDayMetrics(resolvedDay({
      workout_type: "cross", activity_target: { kind: "duration", duration_sec: 2700, raw: "45min" },
    }));
    expect(metrics).toEqual({ totalDistanceM: 0, minSpeedKmh: null, maxSpeedKmh: null, totalDurationSec: 2700 });
  });
});

describe("classifyResolvedDay / buildDayClassificationContext (HRA-147)", () => {
  function resolvedDay(overrides: Partial<ResolvedDay>): ResolvedDay {
    return { section_name: "Base", week_number: 1, date: "2026-09-01", day: 1, workout_type: "run", needs_review: false, segments: [], ...overrides };
  }
  function continuousSeg(paceSecPerKm: number | null, distanceM = 5000): ResolvedSegment {
    return { type: "continuous", target: target("distance", distanceM), resolved_pace_sec_per_km: paceSecPerKm, raw: `${distanceM}m` };
  }

  it("structural categories (cross/rest/interval/progression) always win over the pace heuristic, regardless of pace", () => {
    const ctx = buildDayClassificationContext([]);
    const interval: ResolvedSegment = { type: "interval", reps: 4, work_target: target("distance", 1000), work_resolved_pace_sec_per_km: 900, raw: "4x1000m" }; // deliberately very slow pace
    const progression: ResolvedSegment = { type: "progression", target: target("distance", 5000), start_resolved_pace_sec_per_km: 900, end_resolved_pace_sec_per_km: 900, raw: "5km PROG" };
    expect(classifyResolvedDay(resolvedDay({ segments: [interval] }), ctx)).toBe("intervals");
    expect(classifyResolvedDay(resolvedDay({ segments: [progression] }), ctx)).toBe("progressive");
    expect(classifyResolvedDay(resolvedDay({ workout_type: "cross" }), ctx)).toBe("cross_training");
    expect(classifyResolvedDay(resolvedDay({ workout_type: "strength" }), ctx)).toBe("cross_training");
    expect(classifyResolvedDay(resolvedDay({ workout_type: "rest" }), ctx)).toBe("rest");
    expect(classifyResolvedDay(resolvedDay({ workout_type: "todo" }), ctx)).toBe("easy_recovery");
    expect(classifyResolvedDay(resolvedDay({ workout_type: "other" }), ctx)).toBe("easy_recovery"); // HRA-156
  });

  it("buckets a continuous day's resolved pace into a tercile of every resolved pace across the whole instance", () => {
    // Six days, paces 200..300s/km in steps of 20 — the population the tercile bounds are computed against.
    const days = [200, 220, 240, 260, 280, 300].map((pace, i) =>
      resolvedDay({ day: i + 1, segments: [continuousSeg(pace)] }));
    const ctx = buildDayClassificationContext(days);
    // fastBound ~= 233.33, midBound ~= 266.67 (linear-interpolated 1/3 and 2/3 percentiles)
    expect(classifyResolvedDay(days[0], ctx)).toBe("threshold"); // 200 <= fastBound
    expect(classifyResolvedDay(days[2], ctx)).toBe("tempo"); // 240, between the two bounds
    expect(classifyResolvedDay(days[5], ctx)).toBe("easy_recovery"); // 300, slowest third
  });

  it("a day with zero resolvable pace classifies as Easy/Recovery, never crashes or falls through to undefined", () => {
    // An unknown-kind target with no resolved pace has zero volume (neither distance nor
    // duration resolves), so this day is never a week's "long run" outlier by accident here.
    const zeroVolumeDay = () => resolvedDay({
      segments: [{ type: "continuous", target: target("unknown"), resolved_pace_sec_per_km: null, raw: "? @ ?" }],
    });
    const ctx = buildDayClassificationContext([zeroVolumeDay()]);
    expect(classifyResolvedDay(zeroVolumeDay(), ctx)).toBe("easy_recovery");
    // Also true when the whole instance has no resolvable pace at all (empty tercile population).
    const emptyCtx = buildDayClassificationContext([]);
    expect(classifyResolvedDay(resolvedDay({ segments: [continuousSeg(250)] }), emptyCtx)).toBe("easy_recovery");
  });

  it("Long-run overlay overrides the pace-tier badge on the week's strict-max-volume run day", () => {
    const longDay = resolvedDay({ day: 1, segments: [continuousSeg(260, 15000)] }); // tempo-tier pace, but by far the week's longest
    const shortDay1 = resolvedDay({ day: 3, segments: [continuousSeg(200, 5000)] });
    const shortDay2 = resolvedDay({ day: 5, segments: [continuousSeg(320, 6000)] });
    const ctx = buildDayClassificationContext([longDay, shortDay1, shortDay2]);
    expect(classifyResolvedDay(longDay, ctx)).toBe("long_run"); // would otherwise be "tempo" by pace alone
    expect(classifyResolvedDay(shortDay1, ctx)).toBe("threshold"); // not the week's outlier — keeps its own pace tier
  });

  it("Long-run overlay never fires on a tie for the week's max volume — falls back to the pace tier", () => {
    const dayA = resolvedDay({ day: 1, segments: [continuousSeg(250, 10000)] });
    const dayB = resolvedDay({ day: 3, segments: [continuousSeg(250, 10000)] }); // exact tie
    const ctx = buildDayClassificationContext([dayA, dayB]);
    expect(classifyResolvedDay(dayA, ctx)).toBe("threshold"); // same pace for both → both fall at the tercile's fastest bound
    expect(classifyResolvedDay(dayB, ctx)).toBe("threshold");
  });

  it("Long-run overlay never overrides a structural category, even on the week's longest day", () => {
    const interval: ResolvedSegment = { type: "interval", reps: 8, work_target: target("distance", 2000), work_resolved_pace_sec_per_km: 250, raw: "8x2000m" };
    const longIntervalDay = resolvedDay({ day: 1, segments: [interval] }); // 16000m — the week's longest by far
    const shortRun = resolvedDay({ day: 3, segments: [continuousSeg(250, 5000)] });
    const ctx = buildDayClassificationContext([longIntervalDay, shortRun]);
    expect(classifyResolvedDay(longIntervalDay, ctx)).toBe("intervals");
  });

  it("week grouping for the Long-run overlay is scoped by section AND week_number, not week_number alone", () => {
    // Both sections have a "week 1" — if grouping ignored section_name, these
    // four days would be pooled into one group and only the 20000m day would win.
    const baseLong = resolvedDay({ section_name: "Base", week_number: 1, day: 1, segments: [continuousSeg(200, 5000)] });
    const baseShort = resolvedDay({ section_name: "Base", week_number: 1, day: 3, segments: [continuousSeg(200, 3000)] });
    const peakLong = resolvedDay({ section_name: "Peak", week_number: 1, day: 1, segments: [continuousSeg(200, 20000)] });
    const peakShort = resolvedDay({ section_name: "Peak", week_number: 1, day: 3, segments: [continuousSeg(200, 2000)] });
    const ctx = buildDayClassificationContext([baseLong, baseShort, peakLong, peakShort]);
    expect(classifyResolvedDay(baseLong, ctx)).toBe("long_run"); // wins its own section's week 1, despite being far shorter than Peak's
    expect(classifyResolvedDay(peakLong, ctx)).toBe("long_run");
  });
});

describe("classifyResolvedDay — inferred progression (HRA-183)", () => {
  function resolvedDay(overrides: Partial<ResolvedDay>): ResolvedDay {
    return { section_name: "Base", week_number: 1, date: "2026-09-01", day: 1, workout_type: "run", needs_review: false, segments: [], ...overrides };
  }
  function continuousSeg(paceSecPerKm: number | null, distanceM = 5000): ResolvedSegment {
    return { type: "continuous", target: target("distance", distanceM), resolved_pace_sec_per_km: paceSecPerKm, raw: `${distanceM}m` };
  }
  const staged = (p1: number | null, p2: number | null, p3: number | null): ResolvedSegment[] =>
    [continuousSeg(p1), continuousSeg(p2), continuousSeg(p3)];

  it("a running day with three or more continuous stages that clearly accelerate is inferred Progressive", () => {
    const ctx = buildDayClassificationContext([]);
    // 1 and 3 September fixtures from the Story: 266 -> 256 -> 246 sec/km.
    const sept1 = resolvedDay({ date: "2026-09-01", day: 1, segments: staged(266, 256, 246) });
    const sept3 = resolvedDay({ date: "2026-09-03", day: 3, segments: staged(266, 256, 246) });
    expect(classifyResolvedDay(sept1, ctx)).toBe("progressive");
    expect(classifyResolvedDay(sept3, ctx)).toBe("progressive");
  });

  it("does not infer Progressive on a two-stage faster finish — three stages is the minimum", () => {
    const ctx = buildDayClassificationContext([]);
    const twoStage = resolvedDay({ segments: [continuousSeg(266), continuousSeg(246)] });
    expect(classifyResolvedDay(twoStage, ctx)).not.toBe("progressive");
  });

  it("does not infer Progressive when a stage is equal to or slower than the one before it", () => {
    const ctx = buildDayClassificationContext([]);
    const equalMiddle = resolvedDay({ segments: staged(266, 266, 246) });
    const slowerMiddle = resolvedDay({ segments: staged(266, 270, 246) }); // faster net (266->246) but not a clean acceleration
    expect(classifyResolvedDay(equalMiddle, ctx)).not.toBe("progressive");
    expect(classifyResolvedDay(slowerMiddle, ctx)).not.toBe("progressive");
  });

  it("does not infer Progressive when segment types are mixed, even if the continuous stages accelerate", () => {
    const ctx = buildDayClassificationContext([]);
    const restBlock: ResolvedSegment = { type: "rest_block", target: target("distance", 400), raw: "REST 400m" };
    const mixed = resolvedDay({ segments: [continuousSeg(266), continuousSeg(256), restBlock, continuousSeg(246)] });
    expect(classifyResolvedDay(mixed, ctx)).not.toBe("progressive");
  });

  it("does not infer Progressive when any stage's pace is unresolved", () => {
    const ctx = buildDayClassificationContext([]);
    const unresolved = resolvedDay({ segments: staged(266, null, 246) });
    expect(classifyResolvedDay(unresolved, ctx)).not.toBe("progressive");
  });

  it("existing structural precedence is unchanged: interval, explicit progression, cross-training, and rest still win outright", () => {
    const ctx = buildDayClassificationContext([]);
    const interval: ResolvedSegment = { type: "interval", reps: 4, work_target: target("distance", 1000), work_resolved_pace_sec_per_km: 266, raw: "4x1000m" };
    const explicitProg: ResolvedSegment = { type: "progression", target: target("distance", 5000), start_resolved_pace_sec_per_km: 266, end_resolved_pace_sec_per_km: 246, raw: "5km PROG" };
    expect(classifyResolvedDay(resolvedDay({ segments: [interval, ...staged(266, 256, 246)] }), ctx)).toBe("intervals");
    expect(classifyResolvedDay(resolvedDay({ segments: [explicitProg] }), ctx)).toBe("progressive");
    expect(classifyResolvedDay(resolvedDay({ workout_type: "cross" }), ctx)).toBe("cross_training");
    expect(classifyResolvedDay(resolvedDay({ workout_type: "rest" }), ctx)).toBe("rest");
  });

  it("an inferred progression is not overridden by the week's long-run overlay, same as a structural category", () => {
    const progDay = resolvedDay({ day: 1, segments: staged(266, 256, 246).map(seg => ({ ...seg, target: target("distance", 8000) })) }); // week's longest by far
    const shortRun = resolvedDay({ day: 3, segments: [continuousSeg(250, 3000)] });
    const ctx = buildDayClassificationContext([progDay, shortRun]);
    expect(classifyResolvedDay(progDay, ctx)).toBe("progressive");
  });
});

describe("groupResolvedDaysIntoSectionViews (HRA-118)", () => {
  it("groups a flat day list by section_name then week_number, preserving first-seen order", () => {
    const days = [
      { section_name: "Base", week_number: 1, date: "2026-09-01", day: 1, workout_type: "run" as const, needs_review: false, segments: [], dsl: "D1: 5km @ RG" },
      { section_name: "Peak", week_number: 3, date: "2026-09-15", day: 1, workout_type: "run" as const, needs_review: false, segments: [], dsl: "D1: 10km @ RG" },
      { section_name: "Base", week_number: 2, date: "2026-09-08", day: 1, workout_type: "run" as const, needs_review: false, segments: [], dsl: "D1: 6km @ RG" },
    ];
    const views = groupResolvedDaysIntoSectionViews(days);
    expect(views.map(v => v.name)).toEqual(["Base", "Peak"]);
    expect(views[0].weeks.map(w => w.number)).toEqual([1, 2]);
    expect(views[0].weeks[0].raw_dsl).toBe("");
    expect(views[0].weeks[0].days[0].date).toBe("2026-09-01");
  });
});
