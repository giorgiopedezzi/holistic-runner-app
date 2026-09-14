import { Client } from "pg";

const TABLES = [
  "activities", "track_points", "body_measurements", "date_ranges", "user_settings",
  "plan_templates", "plan_instances", "plan_instance_workouts", "plan_instance_days",
  "workout_associations", "workout_segment_alignments", "activity_types",
] as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const table of TABLES) {
      const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
      console.log(`${table}: ${result.rows[0].count}`);
    }
    const checks = await client.query<{ orphan_days: string; orphan_points: string; cross_tenant_associations: string }>(`
      SELECT
        (SELECT COUNT(*) FROM plan_instance_days d
          LEFT JOIN plan_instance_workouts w ON w.instance_id = d.instance_id AND w.workout_id = d.workout_id
          WHERE w.workout_id IS NULL)::text AS orphan_days,
        (SELECT COUNT(*) FROM track_points p LEFT JOIN activities a ON a.id = p.activity_id WHERE a.id IS NULL)::text AS orphan_points,
        (SELECT COUNT(*) FROM workout_associations wa
          JOIN activities a ON a.id = wa.activity_id
          LEFT JOIN plan_instances pi ON pi.id = wa.instance_id
          WHERE a.user_id <> wa.user_id OR (pi.id IS NOT NULL AND pi.user_id <> wa.user_id))::text AS cross_tenant_associations
    `);
    console.log(`orphan_days: ${checks.rows[0].orphan_days}`);
    console.log(`orphan_points: ${checks.rows[0].orphan_points}`);
    console.log(`cross_tenant_associations: ${checks.rows[0].cross_tenant_associations}`);
  } finally {
    await client.end();
  }
}

void main();
