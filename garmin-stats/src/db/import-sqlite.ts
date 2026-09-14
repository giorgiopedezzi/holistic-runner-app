import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { Client } from "pg";
import { getArg } from "../config.ts";
import { ensureFounder, FOUNDER_USER_ID } from "./founder.ts";

type SqliteRow = Record<string, unknown>;
const BATCH_SIZE = 250;
const DOMAIN_TABLES = [
  "activities", "track_points", "body_measurements", "user_settings", "date_ranges",
  "plan_templates", "plan_instances", "plan_instance_workouts", "plan_instance_days",
  "workout_associations", "workout_segment_alignments", "feedback", "strava_tokens", "withings_tokens",
] as const;

function sourcePath(): string {
  const value = getArg("--source");
  if (!value) throw new Error("Usage: npm run db:import-sqlite -- --source path/to/garmin.db");
  return path.resolve(value);
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Missing required environment variable: DATABASE_URL");
  return value;
}

function sourceRows(source: DatabaseSync, table: string): SqliteRow[] {
  return source.prepare(`SELECT * FROM ${table}`).all() as SqliteRow[];
}

function json(value: unknown, context: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return JSON.stringify(value);
  try { return JSON.stringify(JSON.parse(value)); }
  catch { throw new Error(`Invalid JSON in SQLite ${context}; import aborted.`); }
}

function bool(value: unknown): boolean { return value === 1 || value === true; }

async function insertRows(client: Client, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const values = batch.map((row, rowIndex) =>
      `(${row.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(", ")})`,
    ).join(", ");
    await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values}`, batch.flat());
  }
  console.log(`${table}: ${rows.length}`);
}

async function setSequence(client: Client, table: string): Promise<void> {
  await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) > 0 FROM ${table}))`, [table]);
}

async function assertDestinationEmpty(client: Client): Promise<void> {
  for (const table of DOMAIN_TABLES) {
    const { rows } = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
    if (rows[0].count !== "0") throw new Error(`Destination already contains ${table}; refusing to merge a SQLite import.`);
  }
  const users = await client.query<{ id: string }>("SELECT id::text FROM users");
  if (users.rows.some(row => row.id !== FOUNDER_USER_ID)) {
    throw new Error("Destination already contains users other than the deterministic founder; refusing import.");
  }
}

async function main(): Promise<void> {
  const sourceFile = sourcePath();
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await assertDestinationEmpty(client);
    await ensureFounder(client);

    const activityTypes = sourceRows(source, "activity_types");
    for (const row of activityTypes) {
      await client.query(
        "INSERT INTO activity_types (id, name, min_distance_m) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, min_distance_m = EXCLUDED.min_distance_m",
        [row.id, row.name, row.min_distance_m],
      );
    }
    console.log(`activity_types: ${activityTypes.length}`);

    const activities = sourceRows(source, "activities");
    const activityColumns = ["id", "user_id", "filename", "activity_date", "date_only", "sport", "duration_sec", "distance_m", "avg_pace_minkm", "calories", "avg_hr", "max_hr", "avg_cadence", "ascent_m", "descent_m", "avg_speed_ms", "max_speed_ms", "source", "moving_time_sec", "imported_at", "deleted_at", "purged", "ai_classification", "ai_explanation", "statistical_classification", "statistical_explanation", "user_feedback", "user_correction_reason", "final_classification", "classification_method", "activity_type_id", "activity_name"];
    await insertRows(client, "activities", activityColumns, activities.map(row => activityColumns.map(column => {
      if (column === "user_id") return FOUNDER_USER_ID;
      if (column === "purged") return bool(row.purged);
      return row[column];
    })));

    const points = sourceRows(source, "track_points");
    const pointColumns = ["id", "activity_id", "elapsed_sec", "timestamp_unix", "distance_m", "heart_rate", "speed_ms", "cadence", "altitude_m", "temperature", "power", "lat", "lon", "stamina"];
    await insertRows(client, "track_points", pointColumns, points.map(row => pointColumns.map(column => row[column])));

    const measurements = sourceRows(source, "body_measurements");
    const measurementColumns = ["id", "user_id", "measured_at", "date_only", "weight_kg", "fat_ratio", "fat_mass_kg", "muscle_mass_kg", "hydration_kg", "bone_mass_kg", "bmi", "heart_rate", "deleted_at", "purged"];
    await insertRows(client, "body_measurements", measurementColumns, measurements.map(row => measurementColumns.map(column => column === "user_id" ? FOUNDER_USER_ID : column === "purged" ? bool(row.purged) : row[column])));

    const settings = sourceRows(source, "settings");
    if (settings.length > 1) throw new Error("SQLite settings is not a singleton; import aborted.");
    if (settings[0]) {
      const columns = ["user_id", "outlier_speed_delta_per_sec", "outlier_cadence_delta_per_sec", "outlier_min_speed_kmh", "theme", "background_kind", "background_value", "unit_system", "timezone", "min_trend_group_size", "activity_detail_view", "accent_color", "date_format", "language", "palette", "updated_at"];
      await client.query(`UPDATE user_settings SET (${columns.slice(1).join(", ")}) = (${columns.slice(1).map((_, index) => `$${index + 2}`).join(", ")}) WHERE user_id = $1`, [FOUNDER_USER_ID, ...columns.slice(1).map(column => settings[0][column])]);
      console.log("user_settings: 1");
    }

    const ranges = sourceRows(source, "date_ranges");
    const rangeColumns = ["id", "user_id", "name", "from_date", "to_date", "activity_id", "created_at"];
    await insertRows(client, "date_ranges", rangeColumns, ranges.map(row => rangeColumns.map(column => column === "user_id" ? FOUNDER_USER_ID : row[column])));

    const templates = sourceRows(source, "plan_templates");
    const templateColumns = ["id", "user_id", "name", "dsl_source", "parsed_plan", "event", "approved_at", "created_at"];
    await insertRows(client, "plan_templates", templateColumns, templates.map(row => templateColumns.map(column => column === "user_id" ? FOUNDER_USER_ID : column === "parsed_plan" ? json(row.parsed_plan, "plan_templates.parsed_plan") : row[column])));

    const instances = sourceRows(source, "plan_instances");
    const instanceColumns = ["id", "user_id", "template_id", "start_date", "pace_overrides", "target_activity_id", "approved_at", "name", "event", "race_name", "race_date", "race_url", "schedule_timezone", "original_start_date", "original_days_snapshot", "current_revision", "original_revision", "created_at"];
    await insertRows(client, "plan_instances", instanceColumns, instances.map(row => instanceColumns.map(column => {
      if (column === "user_id") return FOUNDER_USER_ID;
      if (column === "pace_overrides" || column === "original_days_snapshot") return json(row[column], `plan_instances.${column}`);
      return row[column];
    })));

    const days = sourceRows(source, "plan_instance_days");
    const workoutIds = new Set<string>();
    const workoutInstancesById = new Map<string, number>();
    for (const row of days) {
      if (typeof row.workout_id !== "string" || row.workout_id.length === 0) throw new Error("SQLite plan_instance_days has a missing workout_id; import aborted.");
      const key = `${row.instance_id}:${row.workout_id}`;
      if (workoutIds.has(key)) throw new Error(`SQLite plan_instance_days duplicates logical workout ${key}; import aborted.`);
      workoutIds.add(key);
      const earlierInstance = workoutInstancesById.get(row.workout_id);
      if (earlierInstance !== undefined && earlierInstance !== row.instance_id) {
        throw new Error(`SQLite workout_id ${row.workout_id} occurs in multiple instances; import cannot safely infer associations.`);
      }
      workoutInstancesById.set(row.workout_id, row.instance_id as number);
    }
    const workoutColumns = ["instance_id", "workout_id", "user_id", "section_name", "week_number", "day", "suffix", "category", "workout_type", "segments", "activity_target", "activity_description", "notes", "needs_review", "customized_at"];
    await insertRows(client, "plan_instance_workouts", workoutColumns, days.map(row => workoutColumns.map(column => {
      if (column === "user_id") return FOUNDER_USER_ID;
      if (column === "segments") return json(row.segments, "plan_instance_days.segments");
      if (column === "needs_review") return bool(row.needs_review);
      return row[column];
    })));
    const dayColumns = ["id", "instance_id", "workout_id", "user_id", "date", "scheduled_time"];
    await insertRows(client, "plan_instance_days", dayColumns, days.map(row => dayColumns.map(column => column === "user_id" ? FOUNDER_USER_ID : row[column])));

    const workoutInstance = workoutInstancesById;
    const associations = sourceRows(source, "workout_associations");
    const associationColumns = ["id", "user_id", "activity_id", "instance_id", "workout_id", "status", "created_at", "updated_at"];
    await insertRows(client, "workout_associations", associationColumns, associations.map(row => associationColumns.map(column => {
      if (column === "user_id") return FOUNDER_USER_ID;
      if (column === "instance_id") {
        if (row.workout_id === null) return null;
        const instanceId = workoutInstance.get(row.workout_id as string);
        if (instanceId === undefined) throw new Error(`Association ${row.id} references unknown workout_id; import aborted.`);
        return instanceId;
      }
      return row[column];
    })));

    const associationsByActivity = new Map(associations.map(row => [row.activity_id, row]));
    const alignments = sourceRows(source, "workout_segment_alignments");
    const alignmentColumns = ["id", "association_id", "segment_index", "distance_m", "duration_sec", "created_at", "updated_at"];
    await insertRows(client, "workout_segment_alignments", alignmentColumns, alignments.map(row => {
      const association = associationsByActivity.get(row.activity_id);
      if (!association || association.workout_id !== row.workout_id) throw new Error("SQLite segment alignment has no matching activity association; import aborted.");
      return [row.id, association.id, row.segment_index, row.distance_m, row.duration_sec, row.created_at, row.updated_at];
    }));

    const feedback = sourceRows(source, "feedback");
    const feedbackColumns = ["id", "free_text", "pricing_choice", "pricing_why_not_free_text", "feature_interest", "feature_interest_other_free_text", "app_type_choice", "created_at"];
    await insertRows(client, "feedback", feedbackColumns, feedback.map(row => feedbackColumns.map(column => column === "feature_interest" ? json(row.feature_interest, "feedback.feature_interest") : row[column])));

    for (const [tokenTable] of [["strava_tokens"], ["withings_tokens"]] as const) {
      const tokens = sourceRows(source, tokenTable);
      if (tokens.length > 1) throw new Error(`SQLite ${tokenTable} is not a singleton; import aborted.`);
      if (tokens[0]) {
        await insertRows(client, tokenTable, ["user_id", "access_token", "refresh_token", "expires_at", "scope", "updated_at"], [[FOUNDER_USER_ID, tokens[0].access_token, tokens[0].refresh_token, tokens[0].expires_at, tokens[0].scope, tokens[0].updated_at]]);
      }
    }

    for (const table of ["activities", "track_points", "body_measurements", "date_ranges", "plan_templates", "plan_instances", "plan_instance_days", "workout_associations", "workout_segment_alignments", "feedback"]) await setSequence(client, table);
    await client.query("COMMIT");
    console.log("SQLite import committed.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    source.close();
    await client.end();
  }
}

void main();
