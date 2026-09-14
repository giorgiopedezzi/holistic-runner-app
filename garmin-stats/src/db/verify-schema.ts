import { randomUUID } from "node:crypto";
import { Client } from "pg";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const days = await client.query<{ id: string; instance_id: string; workout_id: string }>(`
      SELECT id::text, instance_id::text, workout_id
      FROM plan_instance_days
      WHERE instance_id = (SELECT instance_id FROM plan_instance_days GROUP BY instance_id HAVING COUNT(*) >= 2 LIMIT 1)
      ORDER BY id
      LIMIT 2
    `);
    if (days.rows.length !== 2) throw new Error("Need two plan slots to verify a workout swap.");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("UPDATE plan_instance_days SET workout_id = $1 WHERE id = $2", [days.rows[1].workout_id, days.rows[0].id]);
    await client.query("UPDATE plan_instance_days SET workout_id = $1 WHERE id = $2", [days.rows[0].workout_id, days.rows[1].id]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    console.log("deferrable workout-slot swap: verified");

    const activity = await client.query<{ id: string }>("SELECT id::text FROM activities LIMIT 1");
    if (activity.rows.length !== 1) throw new Error("Need one activity to verify tenant protection.");
    const otherUser = randomUUID();
    await client.query("INSERT INTO users (id) VALUES ($1)", [otherUser]);
    let rejected = false;
    try {
      await client.query(
        "INSERT INTO workout_associations (user_id, activity_id, status) VALUES ($1, $2, 'manual_changed')",
        [otherUser, activity.rows[0].id],
      );
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Cross-tenant workout association was accepted.");
    console.log("tenant-safe activity association: verified");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

void main();
