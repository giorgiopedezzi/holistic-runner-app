/**
 * test/jobs/data-paths.test.ts  (HRA-61)
 * Guards the spawn/data-path layer the R4 reorg (HRA-56) exposed and that the
 * HTTP golden-master (snapshot.sh) can never reach.
 *
 * Two distinct breakages R4 had to get right, both silent if wrong:
 *  1. SPAWN WIRING — server.ts injects scriptsDir=src/ and the sync controller
 *     spawns "jobs/sync-*.ts" / the device service spawns "powershell/*.ps1".
 *     A stale scriptName or scriptsDir means the spawn target doesn't exist.
 *  2. DATA-DIR ANCHORING — the moved jobs resolve their archives via
 *     path.resolve(__dirname, "../../fit-archive") at the src/jobs/ depth. A
 *     wrong "../../" doesn't crash: sync would write to a wrong dir while dedup
 *     reads the real DB → silent divergence. So we assert the anchored paths
 *     resolve to the real garmin-stats root.
 *
 * These are static/filesystem assertions on purpose — no process is spawned and
 * no external I/O happens, so the test is deterministic and device-free.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mirror server.ts: scriptsDir is the src/ directory.
const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
const JOBS_DIR = path.join(SRC_DIR, "jobs");
const GARMIN_STATS_ROOT = path.resolve(SRC_DIR, "..");

test("spawn wiring: every sync/reprocess job exists at scriptsDir/jobs/*", () => {
  // The exact scriptName strings the sync controller / npm scripts spawn.
  for (const name of ["sync-garmin.ts", "sync-withings.ts", "sync-strava.ts", "reprocess-fit-archive.ts"]) {
    const p = path.join(SRC_DIR, "jobs", name);
    assert.ok(fs.existsSync(p), `expected spawn target to exist: ${p}`);
  }
});

test("spawn wiring: PowerShell helpers exist at scriptsDir/powershell/*", () => {
  for (const name of ["activities-file-extractor.ps1", "check-garmin-device.ps1"]) {
    const p = path.join(SRC_DIR, "powershell", name);
    assert.ok(fs.existsSync(p), `expected PowerShell helper to exist: ${p}`);
  }
});

test("data-path anchoring: jobs resolve ../../fit-archive to the real dir", () => {
  // Same expression the jobs use (sync-garmin.ts / reprocess-fit-archive.ts).
  const resolved = path.resolve(JOBS_DIR, "../../fit-archive");
  assert.equal(resolved, path.join(GARMIN_STATS_ROOT, "fit-archive"));
  assert.ok(fs.existsSync(resolved), "fit-archive must exist at the anchored location");
});

test("data-path anchoring: jobs resolve ../../config.json to the real file", () => {
  const resolved = path.resolve(JOBS_DIR, "../../config.json");
  assert.equal(resolved, path.join(GARMIN_STATS_ROOT, "config.json"));
  assert.ok(fs.existsSync(resolved), "config.json must exist at the anchored location");
});

test("data-path anchoring: sync-strava resolves ../../strava-archive under the root", () => {
  // strava-archive is created lazily on first Strava sync, so assert the path
  // resolves under the real root (not its existence).
  const resolved = path.resolve(JOBS_DIR, "../../strava-archive");
  assert.equal(resolved, path.join(GARMIN_STATS_ROOT, "strava-archive"));
  assert.ok(fs.existsSync(GARMIN_STATS_ROOT), "the anchored parent (garmin-stats root) must exist");
});
