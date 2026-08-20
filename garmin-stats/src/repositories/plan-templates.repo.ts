/**
 * repositories/plan-templates.repo.ts
 * Data access for reusable training-plan templates (HRA-112) — the only layer
 * that runs SQL for this domain (rest-api-standards §11).
 */
import type { DatabaseSync } from "node:sqlite";
import type { PlanTemplateRow } from "../db.ts";

const SELECT_FIELDS = "id, name, dsl_source, parsed_plan, event, created_at FROM plan_templates";

export type PlanTemplateInput = Omit<PlanTemplateRow, "id" | "created_at">;

export function createPlanTemplatesRepo(db: DatabaseSync) {
  const listAll   = db.prepare(`SELECT ${SELECT_FIELDS} ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const countAll  = db.prepare("SELECT COUNT(*) AS count FROM plan_templates");
  const findById  = db.prepare(`SELECT ${SELECT_FIELDS} WHERE id = ?`);
  const insert    = db.prepare("INSERT INTO plan_templates (name, dsl_source, parsed_plan, event) VALUES ($name, $dsl_source, $parsed_plan, $event)");
  const update    = db.prepare("UPDATE plan_templates SET name = $name, dsl_source = $dsl_source, parsed_plan = $parsed_plan, event = $event WHERE id = $id");
  const deleteById = db.prepare("DELETE FROM plan_templates WHERE id = ?");

  return {
    listPage: (limit: number, offset: number): PlanTemplateRow[] => listAll.all(limit, offset) as unknown as PlanTemplateRow[],
    count:    (): { count: number } => countAll.get() as unknown as { count: number },
    byId:     (id: number): PlanTemplateRow | undefined => findById.get(id) as unknown as PlanTemplateRow | undefined,
    create:   (p: PlanTemplateInput): PlanTemplateRow => {
      const info = insert.run({ $name: p.name, $dsl_source: p.dsl_source, $parsed_plan: p.parsed_plan, $event: p.event });
      return findById.get(Number(info.lastInsertRowid)) as unknown as PlanTemplateRow;
    },
    update:   (id: number, p: PlanTemplateInput): PlanTemplateRow => {
      update.run({ $id: id, $name: p.name, $dsl_source: p.dsl_source, $parsed_plan: p.parsed_plan, $event: p.event });
      return findById.get(id) as unknown as PlanTemplateRow;
    },
    // ON DELETE CASCADE (plan_instances.template_id) removes derived instances too.
    remove:   (id: number) => deleteById.run(id),
  };
}

export type PlanTemplatesRepo = ReturnType<typeof createPlanTemplatesRepo>;
