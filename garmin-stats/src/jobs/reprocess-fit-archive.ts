/** Reparse archived FIT files into the PostgreSQL runtime database. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import { getArg } from "../config.ts";
import { FOUNDER_USER_ID } from "../db/founder.ts";
import { parseFit } from "../domain/fit-parser.ts";
import { summarizeWorkout, type WorkoutTrackPoint } from "../domain/workout-metrics.ts";
import { classifyByStatistics } from "../domain/stats-classifier.ts";
import { createOwnedActivitiesRepo } from "../repositories/owned-activities.repo.ts";
import { createOwnedSettingsRepo } from "../repositories/owned-settings.repo.ts";

interface AthleteMetricRow {
  current_easy_pace_sec_per_km: number | null;
  current_race_pace_sec_per_km: number | null;
  current_long_run_target_m: number | null;
}

const archivePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fit-archive");
// HRA-352: an operator-run maintenance script over the single shared
// fit-archive/ folder — same explicit-owner convention as the sync jobs, so
// a repair run never touches another owner's activity row by filename alone
// (filename is only unique per-owner, not globally — see 001_postgresql_foundation.sql).
const USER_ID = getArg("--user-id") ?? FOUNDER_USER_ID;

async function main(): Promise<void> {
  if (!fs.existsSync(archivePath)) throw new Error(`Archive folder not found: ${archivePath}`);
  const db = openPostgresDatabase();
  try {
    const files = fs.readdirSync(archivePath).filter(file => file.toLowerCase().endsWith(".fit"));
    let updated = 0;
    let skipped = 0;
    let classified = 0;
    for (const filename of files) {
      const activityRow = await db.get<{ id: number; system_classification: string | null }>(
        "SELECT id,system_classification FROM activities WHERE user_id=$1 AND filename=$2", [USER_ID, filename],
      );
      if (!activityRow) { skipped++; continue; }
      const { activity, trackPoints } = parseFit(fs.readFileSync(path.join(archivePath, filename)), filename);
      const classifiedNow = await db.transaction(async client => {
        await client.query(`UPDATE activities SET duration_sec=$1,moving_time_sec=$2,distance_m=$3,avg_pace_minkm=$4,calories=$5,avg_hr=$6,max_hr=$7,avg_cadence=$8,ascent_m=$9,descent_m=$10,avg_speed_ms=$11,max_speed_ms=$12 WHERE id=$13`, [activity.duration_sec, activity.moving_time_sec, activity.distance_m, activity.avg_pace_minkm, activity.calories, activity.avg_hr, activity.max_hr, activity.avg_cadence, activity.ascent_m, activity.descent_m, activity.avg_speed_ms, activity.max_speed_ms, activityRow.id]);
        await client.query("DELETE FROM track_points WHERE activity_id=$1", [activityRow.id]);
        for (const point of trackPoints) await client.query("INSERT INTO track_points (activity_id,elapsed_sec,timestamp_unix,distance_m,heart_rate,speed_ms,cadence,altitude_m,temperature,power,lat,lon,stamina) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [activityRow.id, point.elapsed_sec, point.timestamp_unix, point.distance_m, point.heart_rate, point.speed_ms, point.cadence, point.altitude_m, point.temperature, point.power, point.lat, point.lon, point.stamina]);

        // HRA-394: fill in a still-missing classification with reprocessed
        // evidence (fresh distance/duration/track points can matter — this
        // script exists specifically to repair a parser bug's fallout). Only
        // when unset: reprocessing repairs upstream measurements, it never
        // silently overwrites a classification a human may already have
        // seen or manually overridden.
        if (activity.sport === "running" && activityRow.system_classification == null) {
          const queryable = clientQueryable(client);
          const settings = await createOwnedSettingsRepo(queryable, USER_ID).get() as AthleteMetricRow | undefined;
          const summary = summarizeWorkout(activity, trackPoints as WorkoutTrackPoint[], { splitMeters: 1000 });
          const result = classifyByStatistics(summary, {
            currentEasyPaceSecPerKm: settings?.current_easy_pace_sec_per_km ?? null,
            currentRacePaceSecPerKm: settings?.current_race_pace_sec_per_km ?? null,
            currentLongRunTargetM: settings?.current_long_run_target_m ?? null,
          });
          await createOwnedActivitiesRepo(queryable, USER_ID).updateSystemClassification({ $id: activityRow.id, $classification: result.classification, $explanation: result.explanation });
          return true;
        }
        return false;
      });
      updated++;
      if (classifiedNow) classified++;
    }
    console.log(`Reprocessed ${updated} archived FIT file(s); ${skipped} had no matching activity; ${classified} previously unclassified running activit${classified === 1 ? "y" : "ies"} classified.`);
  } finally { await db.close(); }
}

void main();
