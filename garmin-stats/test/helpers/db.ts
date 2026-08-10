/**
 * test/helpers/db.ts
 * Backend test fixtures (HRA-59). A throwaway in-memory SQLite DB with the real
 * schema (initSchema from src/db.ts) plus a small, deterministic seed dataset.
 *
 * Reused by T2/T3: every test gets its own isolated DB via createTestDb(), so no
 * test can see another's writes and none of them ever touch the real database
 * file resolved from config.json.
 *
 * We build the DatabaseSync here (not via src/db.ts's openDb(), which opens the
 * real configured DB path) and only borrow initSchema + the typed param builders.
 * Foreign keys are enabled explicitly so track_points CASCADE-delete behaves like
 * production (openDb() sets this pragma; initSchema alone does not).
 */
import { DatabaseSync } from "node:sqlite";
import {
  initSchema,
  activityParams,
  trackPointParams,
  bodyMeasurementParams,
  type ActivityRow,
  type TrackPointRow,
  type BodyMeasurementRow,
} from "../../src/db.ts";

export interface TestDb {
  db: DatabaseSync;
  /** Close the DB and free the in-memory storage. Always call in a finally. */
  cleanup: () => void;
}

/** A fresh, isolated in-memory DB with the full schema applied. */
export function createTestDb(): TestDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
  return { db, cleanup: () => db.close() };
}

// ── Deterministic sample rows ────────────────────────────────────────────────
// Small but representative: one Garmin run and one Strava ride, so tests can
// exercise multi-source reads, dedup keys, and the source-agnostic delete path.
// Numbers loosely mirror the documented reference activity but are NOT parsed
// from a real FIT file — that's T2's job.

type NewActivity = Omit<ActivityRow, "id" | "imported_at">;

export const SAMPLE_ACTIVITIES: NewActivity[] = [
  {
    filename: "2026-08-04-10-28-43.fit",
    activity_date: "2026-08-04T10:28:43",
    date_only: "2026-08-04",
    sport: "running",
    duration_sec: 3035,      // 50:35
    moving_time_sec: 2159,   // 35:59
    distance_m: 6215.9,
    avg_pace_minkm: 5.79,
    calories: 512,
    avg_hr: 148,
    max_hr: 171,
    avg_cadence: 168,
    ascent_m: 31,
    descent_m: 24,
    avg_speed_ms: 2.88,
    max_speed_ms: 4.1,
    source: "garmin",
  },
  {
    filename: "strava-12345.json",
    activity_date: "2026-07-20T07:15:00",
    date_only: "2026-07-20",
    sport: "cycling",
    duration_sec: 5400,
    moving_time_sec: 5100,
    distance_m: 42000,
    avg_pace_minkm: null,
    calories: 900,
    avg_hr: 132,
    max_hr: 160,
    avg_cadence: 84,
    ascent_m: 350,
    descent_m: null,         // Strava never exposes total descent
    avg_speed_ms: 7.78,
    max_speed_ms: 14.2,
    source: "strava",
  },
];

// A handful of track points for the Garmin activity (id 1 after seeding), with
// real wall-clock timestamp_unix so pause-from-timestamps logic has data.
const T0 = 1_754_300_923; // unix seconds ~ 2026-08-04T10:28:43Z
export const SAMPLE_TRACK_POINTS: Omit<TrackPointRow, "activity_id">[] = [
  { elapsed_sec: 0,  timestamp_unix: T0,      distance_m: 0,     heart_rate: 110, speed_ms: 0.0, cadence: 0,   altitude_m: 100, temperature: 22, power: null, lat: 45.0, lon: 9.0 },
  { elapsed_sec: 10, timestamp_unix: T0 + 10, distance_m: 28,    heart_rate: 132, speed_ms: 2.8, cadence: 164, altitude_m: 101, temperature: 22, power: null, lat: 45.001, lon: 9.001 },
  { elapsed_sec: 20, timestamp_unix: T0 + 20, distance_m: 57,    heart_rate: 145, speed_ms: 2.9, cadence: 168, altitude_m: 102, temperature: 22, power: null, lat: 45.002, lon: 9.002 },
];

export const SAMPLE_BODY: BodyMeasurementRow = {
  measured_at: "2026-08-01T06:30:00",
  date_only: "2026-08-01",
  weight_kg: 78.8,
  fat_ratio: 12.4,
  fat_mass_kg: 9.77,
  muscle_mass_kg: 65.6,
  hydration_kg: 48.2,
  bone_mass_kg: 3.4,
  bmi: 22.1,
  heart_rate: 52,
};

/**
 * Seed the deterministic sample dataset. Returns the inserted activity ids so
 * callers can address track points / deletes without re-querying.
 */
export function seedSampleData(db: DatabaseSync): { activityIds: number[] } {
  const insertActivity = db.prepare(`
    INSERT INTO activities
      (filename, activity_date, date_only, sport, duration_sec, distance_m, avg_pace_minkm,
       calories, avg_hr, max_hr, avg_cadence, ascent_m, descent_m, avg_speed_ms, max_speed_ms,
       source, moving_time_sec)
    VALUES
      ($filename, $activity_date, $date_only, $sport, $duration_sec, $distance_m, $avg_pace_minkm,
       $calories, $avg_hr, $max_hr, $avg_cadence, $ascent_m, $descent_m, $avg_speed_ms, $max_speed_ms,
       $source, $moving_time_sec)
  `);
  const activityIds: number[] = [];
  for (const a of SAMPLE_ACTIVITIES) {
    const info = insertActivity.run(activityParams(a));
    activityIds.push(Number(info.lastInsertRowid));
  }

  const insertTrack = db.prepare(`
    INSERT INTO track_points
      (activity_id, elapsed_sec, timestamp_unix, distance_m, heart_rate, speed_ms, cadence,
       altitude_m, temperature, power, lat, lon)
    VALUES
      ($activity_id, $elapsed_sec, $timestamp_unix, $distance_m, $heart_rate, $speed_ms, $cadence,
       $altitude_m, $temperature, $power, $lat, $lon)
  `);
  for (const tp of SAMPLE_TRACK_POINTS) {
    insertTrack.run(trackPointParams({ ...tp, activity_id: activityIds[0] }));
  }

  const insertBody = db.prepare(`
    INSERT INTO body_measurements
      (measured_at, date_only, weight_kg, fat_ratio, fat_mass_kg, muscle_mass_kg,
       hydration_kg, bone_mass_kg, bmi, heart_rate)
    VALUES
      ($measured_at, $date_only, $weight_kg, $fat_ratio, $fat_mass_kg, $muscle_mass_kg,
       $hydration_kg, $bone_mass_kg, $bmi, $heart_rate)
  `);
  insertBody.run(bodyMeasurementParams(SAMPLE_BODY));

  return { activityIds };
}
