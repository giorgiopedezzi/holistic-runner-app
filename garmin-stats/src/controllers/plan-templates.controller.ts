/**
 * controllers/plan-templates.controller.ts
 * HTTP boundary for reusable training-plan templates and their instantiation
 * (HRA-112). Parses/validates the DSL via domain/runplan/parser.ts at
 * create/update time — a template can't be saved unless it parses AND is
 * fully `valid` (HRA-111's bottom-up validity model), matching the "errors
 * don't allow saving the plan" rule this whole schema was designed around.
 * Instantiation delegates the transactional work to
 * services/plan-instances.service.ts; this file owns only HTTP shaping and
 * request validation, same split as activities.controller.ts.
 */
import type { AppContext, Handler } from "../http/context.ts";
import type { PlanTemplateRow } from "../db.ts";
import { parseRunPlanDSL, parsePaceValue } from "../domain/runplan/parser.ts";
import { instantiatePlan } from "../domain/runplan/instantiate.ts";
import type { PacePolicy, RunPlan } from "../domain/runplan/types.ts";
import { send, sendNoContent } from "../http/respond.ts";
import { parsePageParams, readJsonBody } from "../http/request.ts";
import { paginated } from "../http/envelope.ts";
import { badRequest, notFound, unprocessable } from "../http/problem.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseId(pathname: string): number {
  return Number(pathname.split("/").pop());
}
// /api/v1/plan-templates/:id/instantiate — the template id is the 2nd-to-last segment.
function parseTemplateIdForAction(pathname: string): number {
  const parts = pathname.split("/");
  return Number(parts[parts.length - 2]);
}

type TemplateBody = Partial<{ name: string; dsl_source: string }>;
type InstantiateBody = Partial<{ start_date: string; pace_overrides: Record<string, string>; target_activity_id: number | null }>;

// plan.errors is only plan-SCOPED errors (circular pace refs, unrecognized
// lines) — a day's own hard errors (e.g. missing interval rest) live on
// day.errors and don't bubble up automatically (HRA-111's valid/errors model
// is bottom-up for the *valid* flag, not a flattened error list). Walk the
// whole tree so a 422 body actually tells the caller which day is broken.
function collectAllErrors(plan: RunPlan): { field: string; message: string }[] {
  const errors = plan.errors.map(e => ({ field: `line:${e.line}`, message: e.message }));
  for (const section of plan.sections) {
    errors.push(...section.errors.map(e => ({ field: `line:${e.line}`, message: e.message })));
    for (const week of section.weeks) {
      errors.push(...week.errors.map(e => ({ field: `line:${e.line}`, message: e.message })));
      for (const day of week.days) {
        errors.push(...day.errors.map(e => ({ field: `week ${week.number} day ${day.day}`, message: e.message })));
      }
    }
  }
  return errors;
}

export function createPlanTemplatesController(ctx: AppContext) {
  const templates = ctx.repos.planTemplates;
  const activitiesRepo = ctx.repos.activities;
  const instancesRepo = ctx.repos.planInstances;
  const instancesService = ctx.services.planInstances;

  const list: Handler = (_req, res, url) => {
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = templates.count().count;
    return send(res, paginated(templates.listPage(limit, offset), total, limit, offset));
  };

  const getById: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan template id.");
    const row = templates.byId(id);
    if (!row) throw notFound(`No plan template with id ${id}.`);
    return send(res, row);
  };

  // Shared by create/update: parse the DSL and require it to be fully valid
  // (HRA-111 ok:true && plan.valid) — a template with hard errors can't be
  // saved, same rule the future accordion UI will enforce client-side.
  function validate(body: TemplateBody): { name: string; dslSource: string; plan: RunPlan } {
    const name = body.name?.trim();
    if (!name) throw unprocessable("name is required.");
    if (!body.dsl_source?.trim()) throw unprocessable("dsl_source is required.");
    const result = parseRunPlanDSL(body.dsl_source);
    if (!result.ok) {
      throw unprocessable("DSL failed to parse.", { errors: result.errors.map(e => ({ field: `line:${e.line}`, message: e.message })) });
    }
    if (!result.plan.valid) {
      throw unprocessable("DSL parsed but is not valid — fix every flagged day before saving.", {
        errors: collectAllErrors(result.plan),
      });
    }
    return { name, dslSource: body.dsl_source, plan: result.plan };
  }

  const create: Handler = async (req, res) => {
    const body = await readJsonBody<TemplateBody>(req);
    const { name, dslSource, plan } = validate(body);
    const row: PlanTemplateRow = templates.create({
      name, dsl_source: dslSource, parsed_plan: JSON.stringify(plan), event: plan.metadata.event ?? null,
    });
    res.setHeader("Location", `/api/v1/plan-templates/${row.id}`);
    return send(res, row, 201);
  };

  // PUT /api/v1/plan-templates/:id — full replacement (rest-api §2): a new
  // dsl_source is re-parsed from scratch, same validation as create.
  const update: Handler = async (req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan template id.");
    if (!templates.byId(id)) throw notFound(`No plan template with id ${id}.`);
    const body = await readJsonBody<TemplateBody>(req);
    const { name, dslSource, plan } = validate(body);
    return send(res, templates.update(id, {
      name, dsl_source: dslSource, parsed_plan: JSON.stringify(plan), event: plan.metadata.event ?? null,
    }));
  };

  // DELETE cascades to the template's plan_instances (ON DELETE CASCADE, db.ts).
  const remove: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan template id.");
    if (!templates.byId(id)) throw notFound(`No plan template with id ${id}.`);
    templates.remove(id);
    return sendNoContent(res);
  };

  // POST /api/v1/plan-templates/:id/instantiate — resolve the template for
  // one race: override pace anchors + set a start date, persist the result.
  const instantiate: Handler = async (req, res, url) => {
    const templateId = parseTemplateIdForAction(url.pathname);
    if (!Number.isInteger(templateId)) throw badRequest("Invalid plan template id.");
    const template = templates.byId(templateId);
    if (!template) throw notFound(`No plan template with id ${templateId}.`);

    const body = await readJsonBody<InstantiateBody>(req);
    if (!body.start_date || !ISO_DATE.test(body.start_date)) {
      throw unprocessable("start_date is required in YYYY-MM-DD format.");
    }

    const plan = JSON.parse(template.parsed_plan) as RunPlan;

    let paceOverrides: PacePolicy | undefined;
    if (body.pace_overrides) {
      paceOverrides = {};
      for (const [anchor, raw] of Object.entries(body.pace_overrides)) {
        const value = parsePaceValue(raw, plan.metadata.offset_unit);
        if (!value) throw unprocessable(`Invalid pace_overrides value for "${anchor}": ${raw}`);
        paceOverrides[anchor] = value;
      }
    }

    // target_activity_id: same rule as date_ranges.activity_id — race-typed,
    // dated strictly after the resolved plan's last day. Validated in full
    // (existence, type, AND the date bound) BEFORE any write — instantiating
    // twice (once here to know the end date, once inside the service) is
    // cheap and pure; the alternative (validate after persisting) would leave
    // an orphaned instance + days behind on a 422.
    let targetActivityId: number | null = null;
    if (body.target_activity_id != null) {
      targetActivityId = Number(body.target_activity_id);
      if (!Number.isInteger(targetActivityId)) throw unprocessable("target_activity_id must be an integer.");
      const targetActivity = activitiesRepo.byId(targetActivityId) as unknown as { activity_type_id: number; date_only: string } | undefined;
      if (!targetActivity) throw unprocessable(`Unknown target_activity_id ${targetActivityId}.`);
      if (targetActivity.activity_type_id === 1) throw unprocessable("Only race-type activities (not Training) can be linked.");

      const previewDays = instantiatePlan(plan, { startDate: body.start_date, paceOverrides });
      const lastDay = previewDays.reduce((max, d) => (d.date > max ? d.date : max), body.start_date);
      if (targetActivity.date_only <= lastDay) {
        throw unprocessable("The linked race must take place after the plan's last day.");
      }
    }

    const { instance, days } = instancesService.instantiate(templateId, plan, { startDate: body.start_date, paceOverrides }, targetActivityId);

    res.setHeader("Location", `/api/v1/plan-instances/${instance.id}`);
    return send(res, { ...instance, days }, 201);
  };

  const instanceById: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan instance id.");
    const instance = instancesRepo.instanceById(id);
    if (!instance) throw notFound(`No plan instance with id ${id}.`);
    return send(res, { ...instance, days: instancesRepo.daysByInstance(id) });
  };

  return { list, getById, create, update, remove, instantiate, instanceById };
}
