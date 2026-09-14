/** One-time PostgreSQL repair for historical plan-slot dates and duplicates. */
import { openPostgresDatabase } from "../db/postgres.ts";
import { instantiatePlan } from "../domain/runplan/instantiate.ts";
import type { PacePolicy, RunPlan } from "../domain/runplan/types.ts";

type Instance = { id: number; start_date: string; pace_overrides: unknown; parsed_plan: unknown };
type Day = { id: number; section_name: string; week_number: number; day: number; date: string };
const key = (section: string, week: number, day: number) => `${section}\u0000${week}\u0000${day}`;
const json = <T>(value: unknown): T => typeof value === "string" ? JSON.parse(value) as T : value as T;

async function main(): Promise<void> {
  const db = openPostgresDatabase();
  try {
    const instances = await db.all<Instance>("SELECT pi.id,pi.start_date,pi.pace_overrides,pt.parsed_plan FROM plan_instances pi JOIN plan_templates pt ON pt.id=pi.template_id");
    let fixed = 0;
    for (const instance of instances) {
      const expected = new Map(instantiatePlan(json<RunPlan>(instance.parsed_plan), { startDate: instance.start_date, paceOverrides: instance.pace_overrides == null ? undefined : json<PacePolicy>(instance.pace_overrides) }).map(day => [key(day.section_name, day.week_number, day.day), day.date]));
      const days = await db.all<Day>("SELECT d.id,w.section_name,w.week_number,w.day,d.date FROM plan_instance_days d JOIN plan_instance_workouts w ON w.instance_id=d.instance_id AND w.workout_id=d.workout_id WHERE d.instance_id=$1", [instance.id]);
      const groups = new Map<string, Day[]>();
      for (const day of days) groups.set(key(day.section_name, day.week_number, day.day), [...(groups.get(key(day.section_name, day.week_number, day.day)) ?? []), day]);
      await db.transaction(async client => {
        for (const [identity, rows] of groups) {
          const correctDate = expected.get(identity);
          if (!correctDate) continue;
          const survivor = rows.find(row => row.date === correctDate) ?? rows.sort((a, b) => a.id - b.id)[0];
          for (const row of rows) if (row.id !== survivor.id) { await client.query("DELETE FROM plan_instance_days WHERE id=$1", [row.id]); fixed++; }
          if (survivor.date !== correctDate) { await client.query("UPDATE plan_instance_days SET date=$1 WHERE id=$2", [correctDate, survivor.id]); fixed++; }
        }
      });
    }
    console.log(`Repaired ${fixed} plan-instance slot row(s).`);
  } finally { await db.close(); }
}

void main();
