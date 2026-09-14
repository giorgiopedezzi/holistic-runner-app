import type { Client } from "pg";

type OwnershipClient = Pick<Client, "query">;
export interface OwnershipCheck { name: string; violations: number }

const CHECKS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "orphan_track_points", sql: "SELECT COUNT(*)::int AS violations FROM track_points p LEFT JOIN activities a ON a.id = p.activity_id WHERE a.id IS NULL" },
  { name: "orphan_plan_workouts", sql: "SELECT COUNT(*)::int AS violations FROM plan_instance_workouts w LEFT JOIN plan_instances i ON i.id = w.instance_id AND i.user_id = w.user_id WHERE i.id IS NULL" },
  { name: "orphan_plan_days", sql: "SELECT COUNT(*)::int AS violations FROM plan_instance_days d LEFT JOIN plan_instances i ON i.id = d.instance_id AND i.user_id = d.user_id LEFT JOIN plan_instance_workouts w ON w.instance_id = d.instance_id AND w.workout_id = d.workout_id AND w.user_id = d.user_id WHERE i.id IS NULL OR w.workout_id IS NULL" },
  { name: "cross_owner_date_ranges", sql: "SELECT COUNT(*)::int AS violations FROM date_ranges r JOIN activities a ON a.id = r.activity_id WHERE a.user_id <> r.user_id" },
  { name: "cross_owner_plan_instances", sql: "SELECT COUNT(*)::int AS violations FROM plan_instances i JOIN plan_templates t ON t.id = i.template_id WHERE t.user_id <> i.user_id" },
  { name: "cross_owner_associations", sql: "SELECT COUNT(*)::int AS violations FROM workout_associations w JOIN activities a ON a.id = w.activity_id LEFT JOIN plan_instances i ON i.id = w.instance_id WHERE a.user_id <> w.user_id OR (i.id IS NOT NULL AND i.user_id <> w.user_id)" },
  { name: "orphan_segment_alignments", sql: "SELECT COUNT(*)::int AS violations FROM workout_segment_alignments s LEFT JOIN workout_associations w ON w.id = s.association_id WHERE w.id IS NULL" },
  { name: "founder_settings_missing", sql: "SELECT CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = '00000000-0000-4000-8000-000000000001') AND NOT EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id = '00000000-0000-4000-8000-000000000001') THEN 1 ELSE 0 END::int AS violations" },
];

export async function ownershipIntegrityChecks(client: OwnershipClient): Promise<OwnershipCheck[]> {
  const results: OwnershipCheck[] = [];
  for (const check of CHECKS) {
    const result = await client.query<{ violations: number }>(check.sql);
    results.push({ name: check.name, violations: result.rows[0].violations });
  }
  return results;
}

export function assertOwnershipIntegrity(checks: readonly OwnershipCheck[]): void {
  const failed = checks.filter(check => check.violations > 0);
  if (failed.length > 0) throw new Error(`Ownership integrity failed: ${failed.map(check => `${check.name}=${check.violations}`).join(", ")}`);
}
