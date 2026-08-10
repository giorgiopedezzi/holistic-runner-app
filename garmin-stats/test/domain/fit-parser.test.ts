/**
 * test/domain/fit-parser.test.ts  (HRA-60)
 * Characterizes fit-parser.ts against the documented reference activity
 * (fit-archive/2026-08-04-10-28-43.fit, CLAUDE.md's reference — id 200 in the
 * live DB). These numbers guard the many subtle FIT fixes that have regressed
 * before: the base-type mask, the session field-id mappings (sport=5,
 * ascent/descent=22/23), the cadence ×2-for-running convention, and — most
 * importantly — the developer-field payload skipping, whose absence once made
 * this exact file parse with a clean summary but ZERO track points.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFit } from "../../src/domain/fit-parser.ts";

const REF_NAME = "2026-08-04-10-28-43.fit";
const refPath = fileURLToPath(new URL(`../../fit-archive/${REF_NAME}`, import.meta.url));
const parsed = parseFit(readFileSync(refPath), REF_NAME);
const { activity: a, trackPoints: tp } = parsed;

test("summary fields match the documented reference activity", () => {
  assert.equal(a.date_only, "2026-08-04");
  assert.equal(a.sport, "running");

  // Ascent/descent: the off-by-N session-field-mapping regression (22/23, not
  // 24/25) — a wrong mapping read 36/0 for this file.
  assert.equal(a.ascent_m, 31);
  assert.equal(a.descent_m, 24);

  // Duration 50:35 (total_elapsed_time), moving 35:59 (total_timer_time).
  assert.ok(a.duration_sec != null && a.moving_time_sec != null);
  assert.equal(Math.floor(a.duration_sec! / 60), 50);
  assert.equal(Math.floor(a.duration_sec! % 60), 35);
  assert.equal(Math.floor(a.moving_time_sec! / 60), 35);
  assert.equal(Math.floor(a.moving_time_sec! % 60), 59);
  // Moving < total, because this activity has real auto-paused stretches.
  assert.ok(a.moving_time_sec! < a.duration_sec!);

  // Distance ~6.2km.
  assert.ok(a.distance_m! > 6200 && a.distance_m! < 6210, `distance_m=${a.distance_m}`);
});

test("avg_cadence is computed in the sane running band, not the bogus session field", () => {
  // The 56/89 session cadence fields produced nonsense (e.g. 1684 spm); the
  // parser computes the mean of ×2-scaled per-record cadence instead.
  assert.ok(a.avg_cadence != null);
  assert.ok(a.avg_cadence! >= 150 && a.avg_cadence! <= 190, `avg_cadence=${a.avg_cadence}`);
  assert.equal(a.avg_cadence, 170);
});

test("track points are parsed (the developer-field payload regression guard)", () => {
  // The dev-field payload bug made this file parse with 0 track points.
  assert.ok(tp.length > 0, "must not be zero (dev-field desync regression)");
  assert.equal(tp.length, 2167);
});

test("every track point has real wall-clock timestamp_unix, spanning the duration", () => {
  assert.ok(tp.every((p) => p.timestamp_unix != null), "all points should carry field 253");
  const span = tp[tp.length - 1].timestamp_unix! - tp[0].timestamp_unix!;
  // Wall-clock span equals total elapsed time (not moving time), within a sample.
  assert.ok(Math.abs(span - a.duration_sec!) <= 2, `span=${span} vs duration=${a.duration_sec}`);
});
