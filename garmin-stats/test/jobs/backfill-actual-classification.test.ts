/**
 * test/jobs/backfill-actual-classification.test.ts (HRA-394)
 * Pins the one non-trivial decision in the one-time backfill script: what to
 * do with an existing manual_classification value. The script's own
 * `main()` isn't unit-tested (same convention as reprocess-fit-archive.ts /
 * cleanup-plan-instance-day-dates.ts — an operator-run script over the real
 * database, not parameterized for test injection); the system_classification
 * recompute half reuses classification.service.ts's classify(), already
 * covered by stats-classifier.test.ts and http/classification.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLegacyManualOverride } from "../../src/jobs/backfill-actual-classification.ts";

test("the exact legacy Tapasciata label maps to the canonical key — the one safe semantic equivalence", () => {
  assert.equal(resolveLegacyManualOverride("Tapasciata / Light Maintenance"), "map-to-tapasciata");
});

test("every other legacy label is cleared, never translated by name similarity", () => {
  for (const legacy of ["Recovery Run", "Long Session", "Repeats/Intervals", "Progressive Run", "Fartlek"]) {
    assert.equal(resolveLegacyManualOverride(legacy), "clear");
  }
});

test("an already-canonical value is kept as-is (idempotent reruns)", () => {
  for (const canonical of ["easy_recovery", "long_run", "intervals", "progressive", "threshold", "tempo", "tapasciata"]) {
    assert.equal(resolveLegacyManualOverride(canonical), "keep");
  }
});

test("no override is kept as no override", () => {
  assert.equal(resolveLegacyManualOverride(null), "keep");
});

test("an unrecognized arbitrary value is cleared, not kept", () => {
  assert.equal(resolveLegacyManualOverride("some old free-text value"), "clear");
});
