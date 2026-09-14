import type { Queryable } from "../db/query.ts";
import type { PlanTemplateRow } from "../db.ts";
const FIELDS = "id, name, dsl_source, parsed_plan::text AS parsed_plan, event, approved_at, created_at";
export type PlanTemplateInput = Omit<PlanTemplateRow, "id" | "created_at" | "approved_at">;
export function createPlanTemplatesRepo(db: Queryable) { return {
  listPage: (limit: number, offset: number) => db.all<PlanTemplateRow>(`SELECT ${FIELDS} FROM plan_templates ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
  count: () => db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM plan_templates"),
  byId: (id: number) => db.get<PlanTemplateRow>(`SELECT ${FIELDS} FROM plan_templates WHERE id = $1`, [id]),
  create: (p: PlanTemplateInput) => db.get<PlanTemplateRow>(`INSERT INTO plan_templates (user_id, name, dsl_source, parsed_plan, event) VALUES ((SELECT id FROM users ORDER BY created_at LIMIT 1), $1, $2, $3::jsonb, $4) RETURNING ${FIELDS}`, [p.name, p.dsl_source, p.parsed_plan, p.event]),
  update: (id: number, p: PlanTemplateInput) => db.get<PlanTemplateRow>(`UPDATE plan_templates SET name=$2, dsl_source=$3, parsed_plan=$4::jsonb, event=$5, approved_at=NULL WHERE id=$1 RETURNING ${FIELDS}`, [id, p.name, p.dsl_source, p.parsed_plan, p.event]),
  approve: (id: number) => db.get<PlanTemplateRow>(`UPDATE plan_templates SET approved_at=now() WHERE id=$1 RETURNING ${FIELDS}`, [id]),
  remove: (id: number) => db.run("DELETE FROM plan_templates WHERE id = $1", [id]),
}; }
export type PlanTemplatesRepo = ReturnType<typeof createPlanTemplatesRepo>;
