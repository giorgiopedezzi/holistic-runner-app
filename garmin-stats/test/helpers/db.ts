/**
 * PostgreSQL test fixtures. Every test receives a generated, isolated schema
 * with the versioned runtime migrations. There is no SQLite fallback.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { ensureFounder, FOUNDER_USER_ID } from "../../src/db/founder.ts";
import { PostgresDatabase } from "../../src/db/postgres.ts";

export interface TestDb {
  db: PostgresDatabase;
  cleanup: () => Promise<void>;
}

function testDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("PostgreSQL tests require TEST_DATABASE_URL or DATABASE_URL");
  return value;
}

const migrationsDir = fileURLToPath(new URL("../../src/db/migrations", import.meta.url));

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function createTestDb(): Promise<TestDb> {
  const databaseUrl = testDatabaseUrl();
  const schema = `hra_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await admin.query(`SET search_path TO ${quoteIdentifier(schema)}`);
    for (const file of (await fs.readdir(migrationsDir)).filter(name => name.endsWith(".sql")).sort()) {
      await admin.query(await fs.readFile(path.join(migrationsDir, file), "utf8"));
    }
    await ensureFounder(admin);
  } catch (error) {
    await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    throw error;
  } finally {
    await admin.end();
  }
  const db = new PostgresDatabase(databaseUrl, schema);
  return {
    db,
    cleanup: async () => {
      await db.close();
      const cleanupClient = new Client({ connectionString: databaseUrl });
      await cleanupClient.connect();
      try { await cleanupClient.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`); }
      finally { await cleanupClient.end(); }
    },
  };
}

export const SAMPLE_ACTIVITIES = [
  { filename: "2026-08-04-10-28-43.fit", activity_date: "2026-08-04T10:28:43", date_only: "2026-08-04", sport: "running", duration_sec: 3035, moving_time_sec: 2159, distance_m: 6215.9, avg_pace_minkm: 5.79, calories: 512, avg_hr: 148, max_hr: 171, avg_cadence: 168, ascent_m: 31, descent_m: 24, avg_speed_ms: 2.88, max_speed_ms: 4.1, source: "garmin" },
  { filename: "strava-12345.json", activity_date: "2026-07-20T07:15:00", date_only: "2026-07-20", sport: "cycling", duration_sec: 5400, moving_time_sec: 5100, distance_m: 42000, avg_pace_minkm: null, calories: 900, avg_hr: 132, max_hr: 160, avg_cadence: 84, ascent_m: 350, descent_m: null, avg_speed_ms: 7.78, max_speed_ms: 14.2, source: "strava" },
];

export const SAMPLE_TRACK_POINTS = [
  { elapsed_sec: 0, timestamp_unix: 1_754_300_923, distance_m: 0, heart_rate: 110, speed_ms: 0, cadence: 0, altitude_m: 100, temperature: 22, power: null, stamina: null, lat: 45, lon: 9 },
  { elapsed_sec: 10, timestamp_unix: 1_754_300_933, distance_m: 28, heart_rate: 132, speed_ms: 2.8, cadence: 164, altitude_m: 101, temperature: 22, power: null, stamina: null, lat: 45.001, lon: 9.001 },
  { elapsed_sec: 20, timestamp_unix: 1_754_300_943, distance_m: 57, heart_rate: 145, speed_ms: 2.9, cadence: 168, altitude_m: 102, temperature: 22, power: null, stamina: null, lat: 45.002, lon: 9.002 },
];

export const SAMPLE_BODY = { measured_at: "2026-08-01T06:30:00", date_only: "2026-08-01", weight_kg: 78.8, fat_ratio: 12.4, fat_mass_kg: 9.77, muscle_mass_kg: 65.6, hydration_kg: 48.2, bone_mass_kg: 3.4, bmi: 22.1, heart_rate: 52 };

export async function seedSampleData(db: PostgresDatabase): Promise<{ activityIds: number[] }> {
  const activityIds: number[] = [];
  for (const activity of SAMPLE_ACTIVITIES) {
    const row = await db.get<{ id: number }>(`INSERT INTO activities (user_id,filename,activity_date,date_only,sport,duration_sec,moving_time_sec,distance_m,avg_pace_minkm,calories,avg_hr,max_hr,avg_cadence,ascent_m,descent_m,avg_speed_ms,max_speed_ms,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`, [FOUNDER_USER_ID, activity.filename, activity.activity_date, activity.date_only, activity.sport, activity.duration_sec, activity.moving_time_sec, activity.distance_m, activity.avg_pace_minkm, activity.calories, activity.avg_hr, activity.max_hr, activity.avg_cadence, activity.ascent_m, activity.descent_m, activity.avg_speed_ms, activity.max_speed_ms, activity.source]);
    if (!row) throw new Error("seed activity insert did not return an id");
    activityIds.push(row.id);
  }
  for (const point of SAMPLE_TRACK_POINTS) {
    await db.run("INSERT INTO track_points (activity_id,elapsed_sec,timestamp_unix,distance_m,heart_rate,speed_ms,cadence,altitude_m,temperature,power,stamina,lat,lon) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [activityIds[0], point.elapsed_sec, point.timestamp_unix, point.distance_m, point.heart_rate, point.speed_ms, point.cadence, point.altitude_m, point.temperature, point.power, point.stamina, point.lat, point.lon]);
  }
  await db.run("INSERT INTO body_measurements (user_id,measured_at,date_only,weight_kg,fat_ratio,fat_mass_kg,muscle_mass_kg,hydration_kg,bone_mass_kg,bmi,heart_rate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [FOUNDER_USER_ID, SAMPLE_BODY.measured_at, SAMPLE_BODY.date_only, SAMPLE_BODY.weight_kg, SAMPLE_BODY.fat_ratio, SAMPLE_BODY.fat_mass_kg, SAMPLE_BODY.muscle_mass_kg, SAMPLE_BODY.hydration_kg, SAMPLE_BODY.bone_mass_kg, SAMPLE_BODY.bmi, SAMPLE_BODY.heart_rate]);
  return { activityIds };
}
