/**
 * test/domain/reporting/metrics.test.ts (HRA-335)
 * activityTimeBreakdown / aggregatePaceSecPerKm / safePercentage — pure, no
 * I/O. Covers AC8 (active/elapsed/paused stay distinct), AC9 (aggregate pace
 * from totals, never averaged labels), AC10 (no percentage without a valid
 * denominator).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityTimeBreakdown, aggregatePaceSecPerKm, raceComparisonTimeSec, safePercentage } from "../../../src/domain/reporting/metrics.ts";

test("activityTimeBreakdown derives paused as elapsed minus active", () => {
  const result = activityTimeBreakdown({ duration_sec: 1800, moving_time_sec: 1700 });
  assert.deepEqual(result, { elapsedSec: 1800, activeSec: 1700, pausedSec: 100 });
});

test("activityTimeBreakdown leaves paused unavailable when moving_time_sec is null (pre-migration rows)", () => {
  const result = activityTimeBreakdown({ duration_sec: 1800, moving_time_sec: null });
  assert.deepEqual(result, { elapsedSec: 1800, activeSec: null, pausedSec: null });
});

test("activityTimeBreakdown leaves paused unavailable rather than negative when active exceeds elapsed (bad data)", () => {
  const result = activityTimeBreakdown({ duration_sec: 1000, moving_time_sec: 1200 });
  assert.equal(result.pausedSec, null);
});

test("raceComparisonTimeSec is always elapsed time (AC8), never active/moving time", () => {
  assert.equal(raceComparisonTimeSec({ duration_sec: 1800 }), 1800);
});

test("aggregatePaceSecPerKm sums distance and time totals rather than averaging each record's own pace", () => {
  // Record A: 5km in 25min (5:00/km). Record B: 5km in 20min (4:00/km). A
  // naive average-of-paces would give 4:30/km; the correct distance/time
  // total gives 10km in 45min = 4:30/km too here by coincidence of equal
  // distances — the next test proves the two methods diverge.
  const pace = aggregatePaceSecPerKm([{ distanceM: 5000, timeSec: 1500 }, { distanceM: 5000, timeSec: 1200 }]);
  assert.equal(pace, 2700 / 10); // 270 sec/km = 4:30/km
});

test("aggregatePaceSecPerKm diverges from a naive pace-label average when distances differ", () => {
  // 1km in 4min (4:00/km) + 9km in 45min (5:00/km). Naive average of the two
  // labels = 4:30/km. Correct distance/time total = 10km in 49min = 4:54/km.
  const pace = aggregatePaceSecPerKm([{ distanceM: 1000, timeSec: 240 }, { distanceM: 9000, timeSec: 2700 }]);
  assert.equal(pace, 2940 / 10); // 294 sec/km = 4:54/km
  assert.notEqual(pace, 270); // the naive (wrong) average-of-labels answer
});

test("aggregatePaceSecPerKm drops a record missing either half rather than treating it as zero", () => {
  const pace = aggregatePaceSecPerKm([{ distanceM: 5000, timeSec: 1500 }, { distanceM: null, timeSec: 300 }, { distanceM: 2000, timeSec: null }]);
  assert.equal(pace, 300); // only the first record counts: 1500/(5000/1000)
});

test("aggregatePaceSecPerKm returns null (not 0 or Infinity) when nothing resolves", () => {
  assert.equal(aggregatePaceSecPerKm([]), null);
  assert.equal(aggregatePaceSecPerKm([{ distanceM: 0, timeSec: 100 }]), null);
});

test("safePercentage requires an explicit valid denominator (AC10)", () => {
  assert.equal(safePercentage(3, 4), 75);
  assert.equal(safePercentage(3, 0), null);
});
