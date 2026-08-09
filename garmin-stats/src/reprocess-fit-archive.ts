/**
 * reprocess-fit-archive.ts
 * One-time backfill: re-parses every archived .FIT file in fit-archive/ with
 * the updated fit-parser.ts (which now extracts moving_time_sec and
 * per-point timestamp_unix) and rewrites the matching activities/track_points
 * rows in place. Needed because those two fields didn't exist when the
 * original sync ran, so existing rows have them NULL.
 * Usage: npm run reprocess:fit
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openDb, initSchema, activityParams, trackPointParams } from "./db.ts";
import { parseFit } from "./domain/fit-parser.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const fitArchivePath = path.resolve(__dirname, "../fit-archive");

async function main(): Promise<void> {
  console.log("=== Garmin Stats — Reprocess FIT Archive ===\n");

  if (!fs.existsSync(fitArchivePath)) {
    console.error(`Archive folder not found: ${fitArchivePath}`);
    process.exit(1);
  }

  const db = openDb();
  initSchema(db);

  const stmtGetActivity = db.prepare("SELECT id FROM activities WHERE filename = ?");
  // Rewrites every field the parser derives (not just the two that motivated
  // this script originally) — the fields this script is expected to fix
  // change over time as fit-parser.ts itself gets corrected, so a partial
  // UPDATE here would silently stop backfilling once a future field is added.
  const stmtUpdateActivity = db.prepare(`
    UPDATE activities SET
      duration_sec = $duration_sec, moving_time_sec = $moving_time_sec,
      distance_m = $distance_m, avg_pace_minkm = $avg_pace_minkm,
      calories = $calories, avg_hr = $avg_hr, max_hr = $max_hr,
      avg_cadence = $avg_cadence, ascent_m = $ascent_m, descent_m = $descent_m,
      avg_speed_ms = $avg_speed_ms, max_speed_ms = $max_speed_ms
    WHERE id = $id
  `);
  const stmtCountPoints = db.prepare("SELECT COUNT(*) AS n FROM track_points WHERE activity_id = ?");
  const stmtDeletePoints = db.prepare("DELETE FROM track_points WHERE activity_id = ?");
  const stmtInsertPoint = db.prepare(`
    INSERT INTO track_points
    (activity_id, elapsed_sec, timestamp_unix, distance_m, heart_rate, speed_ms,
     cadence, altitude_m, temperature, power, lat, lon)
    VALUES
        ($activity_id, $elapsed_sec, $timestamp_unix, $distance_m, $heart_rate, $speed_ms,
         $cadence, $altitude_m, $temperature, $power, $lat, $lon)
  `);

  const files = fs.readdirSync(fitArchivePath).filter(f => f.toLowerCase().endsWith(".fit"));
  console.log(`Found ${files.length} archived .FIT files\n`);

  let updated = 0, notInDb = 0, mismatched = 0, errors = 0;

  for (const fname of files) {
    const activityRow = stmtGetActivity.get(fname) as { id: number } | undefined;
    if (!activityRow) {
      notInDb++;
      console.log(`  ~  ${fname}  no matching activity in DB (skipped)`);
      continue;
    }

    try {
      const buf = fs.readFileSync(path.join(fitArchivePath, fname));
      const { activity, trackPoints } = parseFit(buf, fname);
      const oldCount = (stmtCountPoints.get(activityRow.id) as { n: number }).n;

      db.exec("BEGIN");
      try {
        const params = activityParams({ ...activity, source: "garmin" });
        stmtUpdateActivity.run({
          $id: activityRow.id,
          $duration_sec: params.$duration_sec,
          $moving_time_sec: params.$moving_time_sec,
          $distance_m: params.$distance_m,
          $avg_pace_minkm: params.$avg_pace_minkm,
          $calories: params.$calories,
          $avg_hr: params.$avg_hr,
          $max_hr: params.$max_hr,
          $avg_cadence: params.$avg_cadence,
          $ascent_m: params.$ascent_m,
          $descent_m: params.$descent_m,
          $avg_speed_ms: params.$avg_speed_ms,
          $max_speed_ms: params.$max_speed_ms,
        });
        stmtDeletePoints.run(activityRow.id);
        for (const pt of trackPoints) {
          stmtInsertPoint.run(trackPointParams({ activity_id: activityRow.id, ...pt }));
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }

      const newCount = trackPoints.length;
      if (newCount !== oldCount) {
        mismatched++;
        console.log(`  !  ${fname}  track point count changed: ${oldCount} -> ${newCount}`);
      } else {
        console.log(`  ✓  ${fname}  moving_time_sec=${activity.moving_time_sec ?? "null"}  avg_cadence=${activity.avg_cadence ?? "null"}  points=${newCount}`);
      }
      updated++;
    } catch (e) {
      console.error(`  ✗  ${fname}: ${e instanceof Error ? e.message : e}`);
      errors++;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Updated       : ${updated}`);
  console.log(`  Not in DB     : ${notInDb}`);
  console.log(`  Count mismatch: ${mismatched}`);
  console.log(`  Errors        : ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
