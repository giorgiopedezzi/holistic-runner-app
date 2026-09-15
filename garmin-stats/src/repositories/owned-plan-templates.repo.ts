import type { PlanTemplateRow } from "../db.ts";
import type { Queryable } from "../db/query.ts";
import type { PlanTemplateInput } from "./plan-templates.repo.ts";

const FIELDS = "id, name, dsl_source, parsed_plan::text AS parsed_plan, event, approved_at, created_at";

// Private templates are never inferred from a nullable owner: every lookup
// and mutation carries the authenticated owner explicitly.
export function createOwnedPlanTemplatesRepo(db: Queryable, userId: string) {
  return {
    listPage: (limit: number, offset: number) => db.all<PlanTemplateRow>(`SELECT ${FIELDS} FROM plan_templates WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]),
    count: () => db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM plan_templates WHERE user_id=$1", [userId]),
    byId: (id: number) => db.get<PlanTemplateRow>(`SELECT ${FIELDS} FROM plan_templates WHERE user_id=$1 AND id=$2`, [userId, id]),
    create: (p: PlanTemplateInput) => db.get<PlanTemplateRow>(`INSERT INTO plan_templates (user_id,name,dsl_source,parsed_plan,event) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING ${FIELDS}`, [userId,p.name,p.dsl_source,p.parsed_plan,p.event]),
    update: (id: number, p: PlanTemplateInput) => db.get<PlanTemplateRow>(`UPDATE plan_templates SET name=$3,dsl_source=$4,parsed_plan=$5::jsonb,event=$6,approved_at=NULL WHERE user_id=$1 AND id=$2 RETURNING ${FIELDS}`, [userId,id,p.name,p.dsl_source,p.parsed_plan,p.event]),
    approve: (id: number) => db.get<PlanTemplateRow>(`UPDATE plan_templates SET approved_at=now() WHERE user_id=$1 AND id=$2 RETURNING ${FIELDS}`, [userId,id]),
    remove: (id: number) => db.run("DELETE FROM plan_templates WHERE user_id=$1 AND id=$2", [userId,id]),
  };
}

export type OwnedPlanTemplatesRepo = ReturnType<typeof createOwnedPlanTemplatesRepo>;
