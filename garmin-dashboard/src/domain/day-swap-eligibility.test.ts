import { describe, it, expect } from "vitest";
import { flattenSwapTargets, swapBlockedReason } from "./day-swap-eligibility";
import type { DayView, SectionView } from "./runplan-aggregate";

function day(overrides: Partial<DayView>): DayView {
  return {
    day: 1, workout_type: "run", dsl: "D1: 5km @ RG", needs_review: false, warnings: [],
    distance: { meters: 5000, approximate: false }, id: 1, date: "2026-09-15", ...overrides,
  };
}

function ctx(overrides: Partial<Parameters<typeof swapBlockedReason>[2]> = {}) {
  return { today: "2026-09-10", raceDate: null, hasActivity: () => false, ...overrides };
}

describe("swapBlockedReason", () => {
  it("allows an eligible future, incomplete target in the same plan", () => {
    const source = day({ id: 1, date: "2026-09-15" });
    const target = day({ id: 2, date: "2026-09-17" });
    expect(swapBlockedReason(source, target, ctx())).toBeNull();
  });

  it("blocks the source day itself (unavailable no-op)", () => {
    const source = day({ id: 1, date: "2026-09-15" });
    expect(swapBlockedReason(source, source, ctx())).toBe("same-day");
  });

  it("blocks a past day", () => {
    const source = day({ id: 1, date: "2026-09-15" });
    const target = day({ id: 2, date: "2026-09-01" });
    expect(swapBlockedReason(source, target, ctx({ today: "2026-09-10" }))).toBe("past-or-completed");
  });

  it("blocks a day with a matched recorded activity, even if it's in the future", () => {
    const source = day({ id: 1, date: "2026-09-15" });
    const target = day({ id: 2, date: "2026-09-17" });
    expect(swapBlockedReason(source, target, ctx({ hasActivity: d => d === "2026-09-17" }))).toBe("past-or-completed");
  });

  it("blocks race day", () => {
    const source = day({ id: 1, date: "2026-09-15" });
    const target = day({ id: 2, date: "2026-09-20" });
    expect(swapBlockedReason(source, target, ctx({ raceDate: "2026-09-20" }))).toBe("race-day");
  });

  it("allows a rest day and a cross-week day as valid targets", () => {
    const source = day({ id: 1, date: "2026-09-15", workout_type: "run" });
    const rest = day({ id: 2, date: "2026-09-16", workout_type: "rest" });
    const crossWeek = day({ id: 3, date: "2026-09-22", workout_type: "run" });
    expect(swapBlockedReason(source, rest, ctx())).toBeNull();
    expect(swapBlockedReason(source, crossWeek, ctx())).toBeNull();
  });
});

describe("flattenSwapTargets", () => {
  it("skips template-only days (no id/date) and orders by section/week/day", () => {
    const source = day({ id: 1, date: "2026-09-15" });
    const sections: SectionView[] = [
      {
        name: "Base", raw_dsl: "SECTION \"Base\"", totals: { totalDays: 0, activeDays: 0, runningDays: 0, restDays: 0, otherDays: 0, distance: { meters: 0, approximate: false } },
        weeks: [
          {
            number: 1, raw_dsl: "WEEK 1",
            totals: { totalDays: 0, activeDays: 0, runningDays: 0, restDays: 0, otherDays: 0, distance: { meters: 0, approximate: false } },
            days: [
              day({ id: 1, date: "2026-09-15" }),
              day({ id: undefined, date: undefined, day: 2 }),
              day({ id: 2, date: "2026-09-17", day: 3 }),
            ],
          },
        ],
      },
    ];
    const targets = flattenSwapTargets(source, sections, ctx());
    expect(targets).toHaveLength(2);
    expect(targets.map(t => t.day.id)).toEqual([1, 2]);
    expect(targets[0].blocked).toBe("same-day");
    expect(targets[1].blocked).toBeNull();
  });
});
