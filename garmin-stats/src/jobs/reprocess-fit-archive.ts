/** Reparse archived FIT files into the PostgreSQL runtime database. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPostgresDatabase } from "../db/postgres.ts";
import { parseFit } from "../domain/fit-parser.ts";

const archivePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fit-archive");

async function main(): Promise<void> {
  if (!fs.existsSync(archivePath)) throw new Error(`Archive folder not found: ${archivePath}`);
  const db = openPostgresDatabase();
  try {
    const files = fs.readdirSync(archivePath).filter(file => file.toLowerCase().endsWith(".fit"));
    let updated = 0;
    let skipped = 0;
    for (const filename of files) {
      const activityRow = await db.get<{ id: number }>("SELECT id FROM activities WHERE filename=$1", [filename]);
      if (!activityRow) { skipped++; continue; }
      const { activity, trackPoints } = parseFit(fs.readFileSync(path.join(archivePath, filename)), filename);
      await db.transaction(async client => {
        await client.query(`UPDATE activities SET duration_sec=$1,moving_time_sec=$2,distance_m=$3,avg_pace_minkm=$4,calories=$5,avg_hr=$6,max_hr=$7,avg_cadence=$8,ascent_m=$9,descent_m=$10,avg_speed_ms=$11,max_speed_ms=$12 WHERE id=$13`, [activity.duration_sec, activity.moving_time_sec, activity.distance_m, activity.avg_pace_minkm, activity.calories, activity.avg_hr, activity.max_hr, activity.avg_cadence, activity.ascent_m, activity.descent_m, activity.avg_speed_ms, activity.max_speed_ms, activityRow.id]);
        await client.query("DELETE FROM track_points WHERE activity_id=$1", [activityRow.id]);
        for (const point of trackPoints) await client.query("INSERT INTO track_points (activity_id,elapsed_sec,timestamp_unix,distance_m,heart_rate,speed_ms,cadence,altitude_m,temperature,power,lat,lon,stamina) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [activityRow.id, point.elapsed_sec, point.timestamp_unix, point.distance_m, point.heart_rate, point.speed_ms, point.cadence, point.altitude_m, point.temperature, point.power, point.lat, point.lon, point.stamina]);
      });
      updated++;
    }
    console.log(`Reprocessed ${updated} archived FIT file(s); ${skipped} had no matching activity.`);
  } finally { await db.close(); }
}

void main();
