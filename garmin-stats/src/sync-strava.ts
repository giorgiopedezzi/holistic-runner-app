/**
 * sync-strava.ts
 * Fetches activities from the Strava API and saves them to SQLite, alongside
 * a permanent raw-JSON archive (summary + detail + streams) for future AI
 * analysis — Strava's public API has no "download original file" endpoint
 * for third-party apps, so JSON is the richest raw form available here,
 * unlike fit-archive/'s real .FIT files for Garmin.
 * Usage: npm run sync:strava [-- --from 2023-01-01] [-- --to 2023-06-01] [-- --verbose]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, getArg, hasFlag } from "./config.ts";
import { openDb, initSchema, activityParams, trackPointParams } from "./db.ts";
import { getValidToken } from "./strava-auth.ts";
import type { ActivityRow, TrackPointRow } from "./db.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const config  = loadConfig();
const VERBOSE = hasFlag("--verbose") || hasFlag("-v");
const FROM    = getArg("--from");
const TO      = getArg("--to");

const API_BASE = "https://www.strava.com/api/v3";

// Permanent archive of raw Strava API responses, kept alongside fit-archive/
// (not deleted after import) for future AI-driven analysis.
const archivePath = path.resolve(__dirname, "../strava-archive");
if (!fs.existsSync(archivePath)) fs.mkdirSync(archivePath, { recursive: true });

// sport_type is the modern, more granular field; type is its deprecated
// predecessor, kept as a fallback for older activities that only have it.
const SPORT_MAP: Record<string, string> = {
  Run: "running", TrailRun: "running", VirtualRun: "running",
  Ride: "cycling", VirtualRide: "cycling", EBikeRide: "cycling", GravelRide: "cycling", MountainBikeRide: "cycling",
  Walk: "walking",
  Hike: "hiking",
  Swim: "swimming",
};
function mapSport(sportType: string | undefined, type: string | undefined): string {
  return SPORT_MAP[sportType ?? ""] ?? SPORT_MAP[type ?? ""] ?? "other";
}

interface SummaryActivity {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  type?: string;
  sport_type?: string;
  start_date: string;
  start_date_local: string;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
}

interface DetailedActivity extends SummaryActivity {
  calories?: number;
}

interface StreamSet {
  time?:            { data: number[] };
  distance?:        { data: number[] };
  latlng?:          { data: [number, number][] };
  altitude?:        { data: number[] };
  velocity_smooth?: { data: number[] };
  heartrate?:       { data: number[] };
  cadence?:         { data: number[] };
  watts?:           { data: number[] };
  temp?:            { data: number[] };
}

async function stravaFetch<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Strava API error ${res.status} for ${url}: ${await res.text()}`);
  return await res.json() as T;
}

async function fetchActivityList(accessToken: string, startTs: number, endTs: number): Promise<SummaryActivity[]> {
  const all: SummaryActivity[] = [];
  let page = 1;
  for (;;) {
    const params = new URLSearchParams({
      after: String(startTs), before: String(endTs),
      page: String(page), per_page: "200",
    });
    const batch = await stravaFetch<SummaryActivity[]>(accessToken, `${API_BASE}/athlete/activities?${params}`);
    all.push(...batch);
    if (batch.length < 200) break;
    page++;
  }
  return all;
}

function decodeActivity(detail: DetailedActivity): Omit<ActivityRow, "id" | "imported_at"> {
  const sport = mapSport(detail.sport_type, detail.type);
  const activityDate = detail.start_date_local.replace("Z", "");
  const durationMin = detail.moving_time / 60;
  const distanceKm = detail.distance / 1000;
  // Strava reports running cadence as single-leg strides/min, same as the
  // FIT parser's raw field — ×2 to match this app's steps/min convention
  // (see CLAUDE.md's FIT parser notes) so Garmin and Strava runs compare
  // like-for-like on the same charts.
  const avgCadence = detail.average_cadence != null
    ? Math.round(sport === "running" ? detail.average_cadence * 2 : detail.average_cadence)
    : null;

  return {
    filename:       `strava-${detail.id}.json`,
    activity_date:  activityDate,
    date_only:      activityDate.slice(0, 10),
    sport,
    // duration_sec = total wall-clock time (elapsed_time), moving_time_sec =
    // active time excluding pauses (moving_time) — same convention as
    // Garmin's total_elapsed_time/total_timer_time, so the two sources'
    // "Duration" stat means the same thing. (Previously duration_sec used
    // moving_time here, silently mismatching Garmin's semantics.)
    duration_sec:   detail.elapsed_time,
    moving_time_sec: detail.moving_time,
    distance_m:     detail.distance,
    avg_pace_minkm: distanceKm > 0 ? durationMin / distanceKm : null,
    calories:       detail.calories != null ? Math.round(detail.calories) : null,
    avg_hr:         detail.average_heartrate != null ? Math.round(detail.average_heartrate) : null,
    max_hr:         detail.max_heartrate != null ? Math.round(detail.max_heartrate) : null,
    avg_cadence:    avgCadence,
    ascent_m:       detail.total_elevation_gain ?? null,
    descent_m:      null, // Strava doesn't expose total descent
    avg_speed_ms:   detail.average_speed ?? null,
    max_speed_ms:   detail.max_speed ?? null,
    source:         "strava",
  };
}

function decodeStreams(streams: StreamSet, sport: string): TrackPointRow[] {
  const n = streams.time?.data.length ?? 0;
  const points: TrackPointRow[] = [];
  for (let i = 0; i < n; i++) {
    const cadence = streams.cadence?.data[i];
    points.push({
      activity_id: 0, // filled in by caller once the row id is known
      elapsed_sec: streams.time?.data[i] ?? null,
      // Strava's `time` stream is elapsed-seconds-from-start, not real
      // wall-clock time, so unlike Garmin's parsed FIT timestamps there's no
      // source data for this column — pause detection falls back to the
      // speed heuristic for Strava activities.
      timestamp_unix: null,
      distance_m:  streams.distance?.data[i] ?? null,
      heart_rate:  streams.heartrate?.data[i] ?? null,
      speed_ms:    streams.velocity_smooth?.data[i] ?? null,
      cadence:     cadence != null ? Math.round(sport === "running" ? cadence * 2 : cadence) : null,
      altitude_m:  streams.altitude?.data[i] ?? null,
      temperature: streams.temp?.data[i] ?? null,
      power:       streams.watts?.data[i] ?? null,
      lat:         streams.latlng?.data[i]?.[0] ?? null,
      lon:         streams.latlng?.data[i]?.[1] ?? null,
    });
  }
  return points;
}

async function main(): Promise<void> {
  console.log("=== Garmin Stats — Sync Strava ===\n");
  const db = openDb();
  initSchema(db);
  const accessToken = await getValidToken(config, db);

  const last = db.prepare("SELECT MAX(activity_date) AS last FROM activities WHERE source = 'strava'").get() as { last: string | null };
  const startTs = FROM ? Math.floor(new Date(FROM).getTime() / 1000)
    : last?.last ? Math.floor(new Date(last.last).getTime() / 1000) - 86400
    : Math.floor(Date.now() / 1000) - 2 * 365 * 86400;
  const endTs = TO ? Math.floor(new Date(TO).getTime() / 1000) + 86400 - 1
    : Math.floor(Date.now() / 1000);

  console.log(`Fetching from ${new Date(startTs * 1000).toISOString().slice(0, 10)} to ${new Date(endTs * 1000).toISOString().slice(0, 10)}…`);
  const list = await fetchActivityList(accessToken, startTs, endTs);
  console.log(`  Found ${list.length} activities on Strava in range`);

  const stmtGetByFilename = db.prepare("SELECT id FROM activities WHERE filename = ?");
  const stmtDedup = db.prepare(`
    SELECT id FROM activities
    WHERE ABS(julianday(activity_date) - julianday($activity_date)) < (10.0 / 1440)
      AND (
        distance_m IS NULL OR $distance_m IS NULL
        OR ABS(distance_m - $distance_m) <= MAX(distance_m, $distance_m) * 0.1
      )
    LIMIT 1
  `);
  const stmtInsertPoint = db.prepare(`
    INSERT INTO track_points
    (activity_id, elapsed_sec, timestamp_unix, distance_m, heart_rate, speed_ms,
     cadence, altitude_m, temperature, power, lat, lon)
    VALUES
        ($activity_id, $elapsed_sec, $timestamp_unix, $distance_m, $heart_rate, $speed_ms,
         $cadence, $altitude_m, $temperature, $power, $lat, $lon)
  `);
  const stmtInsertActivity = db.prepare(`
    INSERT OR IGNORE INTO activities
    (filename, activity_date, date_only, sport, duration_sec, distance_m,
     avg_pace_minkm, calories, avg_hr, max_hr, avg_cadence,
     ascent_m, descent_m, avg_speed_ms, max_speed_ms, source, moving_time_sec)
    VALUES
    ($filename, $activity_date, $date_only, $sport, $duration_sec, $distance_m,
     $avg_pace_minkm, $calories, $avg_hr, $max_hr, $avg_cadence,
     $ascent_m, $descent_m, $avg_speed_ms, $max_speed_ms, $source, $moving_time_sec)
  `);

  let imported = 0, skipped = 0, duplicates = 0, errors = 0;

  for (const summary of list) {
    const filename = `strava-${summary.id}.json`;
    if (stmtGetByFilename.get(filename)) { skipped++; continue; }

    try {
      const detail  = await stravaFetch<DetailedActivity>(accessToken, `${API_BASE}/activities/${summary.id}`);
      const streams = await stravaFetch<StreamSet>(
        accessToken,
        `${API_BASE}/activities/${summary.id}/streams?keys=time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp&key_by_type=true`,
      );

      fs.writeFileSync(
        path.join(archivePath, `${summary.id}.json`),
        JSON.stringify({ summary, detail, streams }),
        "utf-8",
      );

      const row = decodeActivity(detail);

      const dup = stmtDedup.get({ $activity_date: row.activity_date, $distance_m: row.distance_m }) as { id: number } | undefined;
      if (dup) {
        duplicates++;
        if (VERBOSE) console.log(`  ~  ${row.date_only}  ${row.sport}  matches existing activity #${dup.id} — skipped as duplicate`);
        continue;
      }

      db.exec("BEGIN");
      try {
        stmtInsertActivity.run(activityParams(row));

        const inserted = stmtGetByFilename.get(filename) as { id: number } | undefined;
        if (!inserted) throw new Error("Insert did not produce a row id");

        for (const pt of decodeStreams(streams, row.sport ?? "other")) {
          stmtInsertPoint.run(trackPointParams({ ...pt, activity_id: inserted.id }));
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }

      imported++;
      if (VERBOSE) {
        const dist = row.distance_m ? `${(row.distance_m / 1000).toFixed(2)} km` : "-";
        console.log(`  ✓  ${row.date_only}  ${row.sport}  ${dist}`);
      }
    } catch (e) {
      console.error(`  ✗  activity ${summary.id}: ${e instanceof Error ? e.message : e}`);
      errors++;
    }
  }

  // "Skipped" folds in duplicates (server.ts parses Imported/Skipped/Errors
  // via regex into the SyncResult the dashboard shows) — Duplicates is
  // logged separately too since "already-imported" and "matched an existing
  // Garmin activity" are useful to tell apart when reading the console.
  console.log(`\nResults:\n  Imported  : ${imported}\n  Skipped   : ${skipped + duplicates}\n  Duplicates: ${duplicates}\n  Errors    : ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
