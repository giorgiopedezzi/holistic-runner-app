/**
 * controllers/plan-templates.controller.ts
 * HTTP boundary for reusable training-plan templates and their instantiation
 * (HRA-112, amended HRA-113). Parses the DSL via domain/runplan/parser.ts at
 * create/update time — a template can't be saved unless it parses AND has
 * zero outstanding warnings anywhere in the tree (HRA-113 gate 1, replacing
 * HRA-111's bottom-up `valid` model — see docs/runplan-dsl.md). A separate
 * "generate" endpoint exposes the same parse for preview without persisting,
 * and an "approve" endpoint implements gate 2 (deliberate, edit-revocable).
 * Instantiation delegates the transactional work to
 * services/plan-instances.service.ts; this file owns only HTTP shaping and
 * request validation, same split as activities.controller.ts.
 */
import type { AppContext, Handler } from "../http/context.ts";
import type { PlanTemplateRow } from "../db.ts";
import { parseRunPlanDSL, parsePaceValue } from "../domain/runplan/parser.ts";
import { instantiatePlan } from "../domain/runplan/instantiate.ts";
import type { PlanInstanceDayInput } from "../repositories/plan-instances.repo.ts";
import type { EventType, PacePolicy, RunPlan } from "../domain/runplan/types.ts";
import { send, sendNoContent } from "../http/respond.ts";
import { parsePageParams, readJsonBody } from "../http/request.ts";
import { paginated } from "../http/envelope.ts";
import { badRequest, notFound, unprocessable } from "../http/problem.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GOAL_TIME_RE = /^(\d{2}):(\d{2}):(\d{2})$/;

// Mirrors the standard-distance seed values in db.ts's activity_types table
// (5k/10k/half/marathon) — ultra/custom have no fixed distance, hence AC10's
// explicit distance_m requirement for those two event types.
const STANDARD_DISTANCE_M: Partial<Record<EventType, number>> = {
  "5k": 5000, "10k": 10000, half: 21097.5, marathon: 42195,
};

function parseId(pathname: string): number {
  return Number(pathname.split("/").pop());
}
// /api/v1/plan-templates/:id/instantiate, /:id/approve — the id is the 2nd-to-last segment.
function parseIdForAction(pathname: string): number {
  const parts = pathname.split("/");
  return Number(parts[parts.length - 2]);
}

type TemplateBody = Partial<{ name: string; dsl_source: string }>;
type GenerateBody = Partial<{ dsl_source: string }>;
type InstantiateBody = Partial<{
  start_date: string; pace_overrides: Record<string, string>;
  goal_time: string; distance_m: number;
  target_activity_id: number | null;
}>;
type InstanceDayBody = {
  section_name: string; week_number: number; date: string; day: number;
  suffix?: string; category?: string; workout_type: string; segments: unknown[];
  activity_target?: unknown; activity_description?: string; notes?: string;
  needs_review: boolean;
};
type InstanceUpdateBody = Partial<{ days: InstanceDayBody[] }>;

// HRA-113: nothing in the tree is a hard error anymore — walk plan-scoped
// (ParseResult.warnings) plus every day's own DayEntry.warnings so a 422 body
// tells the caller exactly which day is still flagged. Week/section "has
// warnings" is intentionally never computed as a separate value here — day +
// plan scope is all a caller needs to resolve every warning.
function collectAllWarnings(plan: RunPlan, planScoped: { line: number; message: string }[]): { field: string; message: string }[] {
  const out = planScoped.map(w => ({ field: `line:${w.line}`, message: w.message }));
  for (const section of plan.sections) {
    for (const week of section.weeks) {
      for (const day of week.days) {
        out.push(...day.warnings.map(w => ({ field: `week ${week.number} day ${day.day}`, message: w.message })));
      }
    }
  }
  return out;
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

  // POST /api/v1/plan-templates/generate — parse-only preview, never
  // persists. What the review UI calls on every edit before the user is
  // ready to save (docs/runplan-dsl-future-notes.md §3).
  const generate: Handler = async (req, res) => {
    const body = await readJsonBody<GenerateBody>(req);
    if (!body.dsl_source?.trim()) throw unprocessable("dsl_source is required.");
    const result = parseRunPlanDSL(body.dsl_source);
    if (!result.ok) {
      throw unprocessable("DSL failed to parse.", { errors: result.errors.map(e => ({ field: `line:${e.line}`, message: e.message })) });
    }
    return send(res, { plan: result.plan, warnings: result.warnings });
  };

  // Shared by create/update: parse the DSL and require zero outstanding
  // warnings anywhere in the tree (HRA-113 gate 1) — a template can't be
  // saved while any day is still flagged, same rule the future accordion UI
  // enforces client-side.
  function validate(body: TemplateBody): { name: string; dslSource: string; plan: RunPlan } {
    const name = body.name?.trim();
    if (!name) throw unprocessable("name is required.");
    if (!body.dsl_source?.trim()) throw unprocessable("dsl_source is required.");
    const result = parseRunPlanDSL(body.dsl_source);
    if (!result.ok) {
      throw unprocessable("DSL failed to parse.", { errors: result.errors.map(e => ({ field: `line:${e.line}`, message: e.message })) });
    }
    const warnings = collectAllWarnings(result.plan, result.warnings);
    if (warnings.length > 0) {
      throw unprocessable("DSL parsed but has outstanding warnings — resolve every flagged item before saving.", { errors: warnings });
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
  // dsl_source is re-parsed from scratch, same validation as create. Clears
  // approved_at (HRA-113 gate 2 — any edit revokes approval), handled inside
  // the repo's update statement.
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

  // POST /api/v1/plan-templates/:id/approve — gate 2: deliberate, only
  // reachable after a zero-warning save. Not gated on anything itself (a
  // saved row is by construction already at zero warnings); re-approving an
  // already-approved template just refreshes the timestamp.
  const approveTemplate: Handler = (_req, res, url) => {
    const id = parseIdForAction(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan template id.");
    if (!templates.byId(id)) throw notFound(`No plan template with id ${id}.`);
    return send(res, templates.approve(id));
  };

  // DELETE cascades to the template's plan_instances (ON DELETE CASCADE, db.ts).
  const remove: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan template id.");
    if (!templates.byId(id)) throw notFound(`No plan template with id ${id}.`);
    templates.remove(id);
    return sendNoContent(res);
  };

  // Resolves the distance used to convert a goal_time into an RG pace
  // (docs/runplan-dsl-future-notes.md §6): an explicit distance_m on the
  // instantiate call wins, then the template's own DISTANCE metadata, then
  // the event's fixed standard distance. ultra/custom have no standard
  // distance, so a goal_time for those events requires distance_m explicitly
  // (AC10) — surfaced as a 422, not a silent fallback.
  function resolveGoalConversionDistance(plan: RunPlan, explicitDistanceM: number | undefined): number {
    if (explicitDistanceM != null) return explicitDistanceM;
    if (plan.metadata.distance_m != null) return plan.metadata.distance_m;
    const standard = plan.metadata.event ? STANDARD_DISTANCE_M[plan.metadata.event] : undefined;
    if (standard != null) return standard;
    throw unprocessable(
      "distance_m is required to convert goal_time to a pace: the template has no DISTANCE and this event has no standard distance.",
    );
  }

  // POST /api/v1/plan-templates/:id/instantiate — resolve the template for
  // one race: override pace anchors + set a start date, persist the result.
  const instantiate: Handler = async (req, res, url) => {
    const templateId = parseIdForAction(url.pathname);
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

    // goal_time: an alternate input for the RG anchor, converted via distance
    // at instantiation time (never part of template parsing). Explicit RG
    // and goal_time together are ambiguous — reject rather than silently
    // picking a winner.
    if (body.goal_time) {
      if (paceOverrides?.RG) {
        throw unprocessable("Provide either goal_time or an explicit RG pace_overrides value, not both.");
      }
      const m = GOAL_TIME_RE.exec(body.goal_time);
      if (!m) throw unprocessable("goal_time must be in HH:MM:SS format.");
      const goalSec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
      const distanceM = resolveGoalConversionDistance(plan, body.distance_m);
      paceOverrides = { ...paceOverrides, RG: { kind: "absolute", pace_sec_per_km: goalSec / (distanceM / 1000) } };
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

  // PUT /api/v1/plan-instances/:id — full replacement of the instance's
  // resolved days (HRA-113 AC9). Structured JSON, not DSL text: an instance
  // holds concrete ResolvedDay data, not template source, and no accordion
  // UI exists yet to build a day-line-text edit contract against. Considered
  // and rejected: reusing day-line DSL text (the future-notes' tentative
  // recommendation) — deferred until the editor's actual shape is known,
  // flagged in the review comment as a deviation from that note. Symmetric
  // with template save (HRA-113 §3): zero days needing review is the
  // precondition, gated here rather than via parseRunPlanDSL since instance
  // days are already resolved, not DSL text to re-parse.
  const updateInstance: Handler = async (req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan instance id.");
    if (!instancesRepo.instanceById(id)) throw notFound(`No plan instance with id ${id}.`);
    const body = await readJsonBody<InstanceUpdateBody>(req);
    if (!Array.isArray(body.days) || body.days.length === 0) {
      throw unprocessable("days is required and must be a non-empty array.");
    }
    const flagged = body.days
      .filter(d => d.needs_review)
      .map(d => ({ field: `week ${d.week_number} day ${d.day}`, message: `Day ${d.day} (${d.date}) still needs review.` }));
    if (flagged.length > 0) {
      throw unprocessable("One or more days still need review — resolve every flag before saving.", { errors: flagged });
    }
    const dayInputs: Omit<PlanInstanceDayInput, "instance_id">[] = body.days.map(d => ({
      section_name: d.section_name, week_number: d.week_number, date: d.date, day: d.day,
      suffix: d.suffix ?? null, category: d.category ?? null, workout_type: d.workout_type,
      segments: JSON.stringify(d.segments), activity_target: d.activity_target ? JSON.stringify(d.activity_target) : null,
      activity_description: d.activity_description ?? null, notes: d.notes ?? null, needs_review: 0,
    }));
    const { instance, days } = instancesService.updateDays(id, dayInputs);
    return send(res, { ...instance, days });
  };

  // POST /api/v1/plan-instances/:id/approve — gate 2, symmetric with the
  // template approve endpoint above.
  const approveInstance: Handler = (_req, res, url) => {
    const id = parseIdForAction(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan instance id.");
    if (!instancesRepo.instanceById(id)) throw notFound(`No plan instance with id ${id}.`);
    return send(res, instancesRepo.approve(id));
  };

  return {
    list, getById, generate, create, update, approveTemplate, remove,
    instantiate, instanceById, updateInstance, approveInstance,
  };
}
