/**
 * test/domain/reporting/planned-metrics.test.ts (HRA-335, AC8)
 * computePlannedDayDistance / computePlannedDayDurationSec — pure, no I/O.
 * Proves this backend port stays in lockstep with garmin-dashboard's CURRENT
 * (bug-fixed) distanceFromResolvedSegment/durationFromResolvedSegment rule:
 * an interval's rest leg is real ground/clock time and counts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlannedDayDistance, computePlannedDayDurationSec } from "../../../src/domain/reporting/planned-metrics.ts";
import type { ResolvedSegment } from "../../../src/domain/runplan/instantiate.ts";

test("continuous segment distance is the target's own distance_m", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: { kind: "distance", distance_m: 10000, raw: "10km" }, resolved_pace_sec_per_km: 300, raw: "10km @ RG" },
  ];
  assert.equal(computePlannedDayDistance("run", segments).meters, 10000);
});

test("interval distance includes the rest leg between reps (mirrors the frontend's own documented bug fix)", () => {
  // 3x3000m work with r:1km rest -> 3 * (3000 + 1000) = 12000m, not 9000m.
  const segments: ResolvedSegment[] = [
    {
      type: "interval", reps: 3,
      work_target: { kind: "distance", distance_m: 3000, raw: "3000m" }, work_resolved_pace_sec_per_km: 240,
      rest: { target: { kind: "distance", distance_m: 1000, raw: "1km" }, resolved_pace_sec_per_km: 360, raw: "r:1km" },
      raw: "3x3000m @ RG+20 r:1km @ RG+40",
    },
  ];
  assert.equal(computePlannedDayDistance("run", segments).meters, 12000);
});

test("a segment with an unresolved (null) pace and a duration target is excluded, not zeroed", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: { kind: "duration", duration_sec: 1800, raw: "30min" }, resolved_pace_sec_per_km: null, raw: "30min @ ?" },
  ];
  const result = computePlannedDayDistance("run", segments);
  assert.equal(result.meters, 0);
});

test("a duration target converts to distance via its resolved pace and is flagged approximate", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: { kind: "duration", duration_sec: 1800, raw: "30min" }, resolved_pace_sec_per_km: 300, raw: "30min @ RG" },
  ];
  const result = computePlannedDayDistance("run", segments);
  assert.equal(result.meters, 6000); // 1800s / 300 sec/km * 1000
  assert.equal(result.approximate, true);
});

test("non-run workout types (rest/cross/todo) contribute zero distance and duration here", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: { kind: "distance", distance_m: 10000, raw: "10km" }, resolved_pace_sec_per_km: 300, raw: "10km @ RG" },
  ];
  assert.deepEqual(computePlannedDayDistance("rest", segments), { meters: 0, approximate: false });
  assert.equal(computePlannedDayDurationSec("rest", segments), 0);
});

test("interval duration includes the rest leg's own clock time", () => {
  const segments: ResolvedSegment[] = [
    {
      type: "interval", reps: 2,
      work_target: { kind: "distance", distance_m: 1000, raw: "1000m" }, work_resolved_pace_sec_per_km: 240,
      rest: { target: { kind: "duration", duration_sec: 90, raw: "90s" }, resolved_pace_sec_per_km: null, raw: "r:90s" },
      raw: "2x1000m @ RG-20 r:90s",
    },
  ];
  // work: 1000m @ 240 sec/km = 240s per rep; rest: 90s per rep. (240+90)*2 = 660s.
  assert.equal(computePlannedDayDurationSec("run", segments), 660);
});
