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
import type { PlanInstanceDayRow, PlanInstanceRow, PlanTemplateRow } from "../db.ts";
import { parseRunPlanDSL, parsePaceValue, parseDayEntry } from "../domain/runplan/parser.ts";
import { instantiatePlan, resolveDay } from "../domain/runplan/instantiate.ts";
import type { ResolvedDay } from "../domain/runplan/instantiate.ts";
import { getEffectivePacePolicy } from "../domain/runplan/pace.ts";
import { eventTypeSchema } from "../domain/runplan/schema.ts";
import { toGarminWorkoutFit } from "../integrations/garmin-workout.ts";
import { dedupeZipEntryNames, writeZip } from "../domain/zip/writer.ts";
import type { PlanInstanceDayInput } from "../repositories/plan-instances.repo.ts";
import type { DayEntry, DayParseContext, EventType, PacePolicy, RunPlan } from "../domain/runplan/types.ts";
import { send, sendNoContent } from "../http/respond.ts";
import { parsePageParams, readJsonBody } from "../http/request.ts";
import { paginated } from "../http/envelope.ts";
import { badRequest, conflict, notFound, unprocessable } from "../http/problem.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GOAL_TIME_RE = /^(\d{2}):(\d{2}):(\d{2})$/;
// HRA-149: scheduled_time is HH:MM, 24-hour, no seconds — distinct from
// GOAL_TIME_RE above (HH:MM:SS, an elapsed duration, not a time of day).
const SCHEDULED_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Mirrors the standard-distance seed values in db.ts's activity_types table
// (5k/10k/half/marathon) — custom has no fixed distance, which is why
// distance_m is mandatory on create/update whenever event === "custom"
// (HRA-120's resolveEventAndDistance below).
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
// /api/v1/plan-instances/:id/days/:dayId — both ids are fixed-position segments.
function parseInstanceAndDayId(pathname: string): { instanceId: number; dayId: number } {
  const parts = pathname.split("/");
  return { instanceId: Number(parts[4]), dayId: Number(parts[6]) };
}

type TemplateBody = Partial<{ name: string; event: string; distance_m: number; dsl_source: string }>;
type GenerateBody = Partial<{ dsl_source: string }>;
type InstantiateBody = Partial<{
  name: string; start_date: string; pace_overrides: Record<string, string>;
  goal_time: string; distance_m: number; race_pace_anchor: string;
  target_activity_id: number | null;
  // HRA-121: the instance's own free-text race description — independent of
  // target_activity_id (an actual linked activity row). race_url is a plain
  // free-text link (e.g. the race's registration page), not validated as a
  // well-formed URL server-side — same "trust the user" treatment as
  // race_name.
  race_name: string; race_date: string; race_url: string;
  // HRA-124: free-text label attached as `notes` on every day auto-filled to
  // plug a gap in a template week (a D-number 1-7 the template never
  // declared for that week).
  rest_day_label: string;
}>;
// HRA-115: a day edit is now its raw DSL text (same grammar as a template's
// D-line) plus the section/week/date scope it lives in — not pre-resolved
// segments. The backend re-parses+resolves it against that scope's own
// effective pace policy (see updateInstance below).
type InstanceDayBody = { section_name: string; week_number: number; date: string; dsl: string };
// HRA-135: PATCH body — every field optional (at least one required, checked
// in patchInstance below); race_name/race_date/race_url are nullable so a
// caller can explicitly clear one via `null` (JSON Merge Patch semantics),
// distinct from omitting the key entirely to leave it untouched.
type InstanceUpdateBody = Partial<{
  name: string; race_name: string | null; race_date: string | null; race_url: string | null;
  days: InstanceDayBody[];
}>;
// HRA-132: effective_from is required (the cutover — server-floored to
// "today", never trusted from the client); start_date/pace_overrides are
// both optional, falling back to the instance's own current value for
// whichever is omitted.
type RegenerateBody = Partial<{ start_date: string; pace_overrides: Record<string, string>; effective_from: string }>;
// HRA-149: PATCH /api/v1/plan-instances/:id/days/:dayId — a smaller, more
// honest write than the bulk days-replace above: one field's worth of edit
// on one already-existing day. All optional (at least one required); dsl is
// re-parsed+resolved the same way the bulk day-replace path does, notes and
// scheduled_time are independent columns (notes overrides whatever the dsl
// parse itself produced, when both are supplied in the same request).
type DayPatchBody = Partial<{ dsl: string; notes: string | null; scheduled_time: string | null }>;

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

  // HRA-120: event is now an explicit, validated request field (replacing
  // free DSL text) — required, one of eventTypeSchema's 5 values;
  // distance_m is required iff event === "custom", rejected for any other
  // event (a standard event already has a fixed distance, see
  // STANDARD_DISTANCE_M above).
  function resolveEventAndDistance(body: TemplateBody): { event: EventType; distanceM: number | undefined } {
    const parsedEvent = eventTypeSchema.safeParse(body.event);
    if (!parsedEvent.success) {
      throw unprocessable(`event is required and must be one of: ${eventTypeSchema.options.join(", ")}.`);
    }
    const event = parsedEvent.data;
    if (event === "custom") {
      if (typeof body.distance_m !== "number" || !(body.distance_m > 0)) {
        throw unprocessable("distance_m is required and must be a positive number when event is custom.");
      }
      return { event, distanceM: body.distance_m };
    }
    if (body.distance_m != null) {
      throw unprocessable("distance_m may only be supplied when event is custom.");
    }
    return { event, distanceM: undefined };
  }

  // Shared by create/update: parse the DSL and require zero outstanding
  // warnings anywhere in the tree (HRA-113 gate 1) — a template can't be
  // saved while any day is still flagged, same rule the future accordion UI
  // enforces client-side.
  function validate(body: TemplateBody): { name: string; dslSource: string; plan: RunPlan } {
    const name = body.name?.trim();
    if (!name) throw unprocessable("name is required.");
    if (!body.dsl_source?.trim()) throw unprocessable("dsl_source is required.");
    const { event, distanceM } = resolveEventAndDistance(body);
    const result = parseRunPlanDSL(body.dsl_source);
    if (!result.ok) {
      throw unprocessable("DSL failed to parse.", { errors: result.errors.map(e => ({ field: `line:${e.line}`, message: e.message })) });
    }
    const warnings = collectAllWarnings(result.plan, result.warnings);
    if (warnings.length > 0) {
      throw unprocessable("DSL parsed but has outstanding warnings — resolve every flagged item before saving.", { errors: warnings });
    }
    // event/distance_m come from the request body, not DSL text (HRA-120) —
    // unconditionally overwrite whatever the now-vestigial EVENT/DISTANCE
    // lines the parser saw produced.
    result.plan.metadata.event = event;
    result.plan.metadata.distance_m = distanceM;
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

  // Resolves the distance used to convert a goal_time into the
  // race_pace_anchor's pace (docs/runplan-dsl-future-notes.md §6, HRA-121:
  // generalized from a hardcoded RG anchor): an explicit distance_m on the
  // instantiate call wins, then the template's own distance_m (HRA-120:
  // always set on a custom-event template, from its create/update request
  // body), then the event's fixed standard distance. custom has no standard
  // distance, so this only 422s if a custom-event template somehow has no
  // distance_m at all — shouldn't happen given create/update's own gate.
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
    const name = body.name?.trim();
    if (!name) throw unprocessable("name is required.");
    if (!body.start_date || !ISO_DATE.test(body.start_date)) {
      throw unprocessable("start_date is required in YYYY-MM-DD format.");
    }
    // HRA-121: both optional, independent of target_activity_id below — a
    // free-text description of the race this instance targets, for a race
    // that hasn't happened yet and may not have any activity row at all.
    if (body.race_date != null && !ISO_DATE.test(body.race_date)) {
      throw unprocessable("race_date must be in YYYY-MM-DD format.");
    }
    const raceName = body.race_name?.trim() || null;
    const raceDate = body.race_date ?? null;
    const raceUrl = body.race_url?.trim() || null;
    const restDayLabel = body.rest_day_label?.trim() || undefined;

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

    // goal_time: an alternate input for whichever anchor race_pace_anchor
    // names, converted via distance at instantiation time (never part of
    // template parsing). HRA-121: race_pace_anchor is now required whenever
    // goal_time is supplied — no default (it used to be hardcoded to RG).
    // Explicit override + goal_time for the same anchor are ambiguous —
    // reject rather than silently picking a winner.
    if (body.goal_time) {
      const racePaceAnchor = body.race_pace_anchor?.trim();
      if (!racePaceAnchor) throw unprocessable("race_pace_anchor is required when goal_time is supplied.");
      if (paceOverrides?.[racePaceAnchor]) {
        throw unprocessable(`Provide either goal_time or an explicit "${racePaceAnchor}" pace_overrides value, not both.`);
      }
      const m = GOAL_TIME_RE.exec(body.goal_time);
      if (!m) throw unprocessable("goal_time must be in HH:MM:SS format.");
      const goalSec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
      const distanceM = resolveGoalConversionDistance(plan, body.distance_m);
      paceOverrides = { ...paceOverrides, [racePaceAnchor]: { kind: "absolute", pace_sec_per_km: goalSec / (distanceM / 1000) } };
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

      const previewDays = instantiatePlan(plan, { startDate: body.start_date, paceOverrides, restDayLabel });
      const lastDay = previewDays.reduce((max, d) => (d.date > max ? d.date : max), body.start_date);
      if (targetActivity.date_only <= lastDay) {
        throw unprocessable("The linked race must take place after the plan's last day.");
      }
    }

    const { instance, days } = instancesService.instantiate(
      templateId, plan, { startDate: body.start_date, paceOverrides, restDayLabel }, targetActivityId, name, raceName, raceDate, raceUrl,
    );

    res.setHeader("Location", `/api/v1/plan-instances/${instance.id}`);
    return send(res, { ...instance, days }, 201);
  };

  // GET /api/v1/plan-instances?template_id=&limit=&offset= — HRA-118's
  // instance card list view. template_id is optional (the Story's own "or a
  // combined view" wording); when given, must reference a real template
  // (400, not silently returning an empty page for a typo'd id).
  const listInstances: Handler = (_req, res, url) => {
    const templateIdParam = url.searchParams.get("template_id");
    let templateId: number | undefined;
    if (templateIdParam != null) {
      templateId = Number(templateIdParam);
      if (!Number.isInteger(templateId)) throw badRequest("Invalid template_id.");
      if (!templates.byId(templateId)) throw notFound(`No plan template with id ${templateId}.`);
    }
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = instancesRepo.count(templateId).count;
    return send(res, paginated(instancesRepo.listPage(limit, offset, templateId), total, limit, offset));
  };

  // GET /api/v1/plan-instance-days?date=YYYY-MM-DD (HRA-206) — every run-type
  // plan_instance_day matching a calendar date, across every plan instance
  // (any approved_at state — the Story's own scope), for
  // ActivityDetailBody's "planned vs actual" picker: 0 matches → no UI
  // change, 1 → the chart renders automatically, >=2 → a picker. Only
  // workout_type === 'run' ever matches (REST/CROSS/STRENGTH/OTHER are
  // excluded per docs/runplan-dsl.md's existing "excluded from
  // planned-vs-actual" note) — hardcoded here, not a query param, since this
  // endpoint has exactly one caller and one use case.
  const daysByDate: Handler = (_req, res, url) => {
    const date = url.searchParams.get("date");
    if (!date || !ISO_DATE.test(date)) throw badRequest("date is required in YYYY-MM-DD format.");
    return send(res, instancesRepo.daysByDateAndWorkoutType(date, "run"));
  };

  // GET /api/v1/plan-instances/active?date=YYYY-MM-DD (HRA-248) — "Your
  // agenda"'s today-centered home view: the one APPROVED plan instance whose
  // resolved days cover `date`, in the same response shape GET
  // /api/v1/plan-instances/:id already uses (extends the
  // daysByDateAndWorkoutType pattern, per the Story's own scope). 404 (not
  // an empty 200) when no approved instance's days include the date —
  // mirrors instanceById's own not-found treatment below, and is what lets
  // the frontend tell "no active plan today" apart from a genuine fetch
  // failure (never the same rendered state as a loading/error branch).
  const activeForDate: Handler = (_req, res, url) => {
    const date = url.searchParams.get("date");
    if (!date || !ISO_DATE.test(date)) throw badRequest("date is required in YYYY-MM-DD format.");
    const instanceId = instancesRepo.activeInstanceIdForDate(date);
    if (instanceId == null) throw notFound(`No active plan instance for ${date}.`);
    return send(res, { ...instancesRepo.instanceById(instanceId), days: instancesRepo.daysByInstance(instanceId) });
  };

  const instanceById: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan instance id.");
    const instance = instancesRepo.instanceById(id);
    if (!instance) throw notFound(`No plan instance with id ${id}.`);
    return send(res, { ...instance, days: instancesRepo.daysByInstance(id) });
  };

  // PATCH /api/v1/plan-instances/:id — partial update (HRA-135, replacing
  // the earlier PUT): body is {name?, race_name?, race_date?, race_url?,
  // days?}, all optional but at least one required; each provided field
  // replaces its current value, every omitted field is left untouched.
  // `days`, when provided, still fully replaces the day set (unchanged
  // semantics from the old PUT, HRA-113 AC9/HRA-114/HRA-115) — each day
  // carries its raw DSL text (`dsl`, same grammar as a template's D-line)
  // instead of pre-resolved segments. For each day: look up its section/week
  // in the source template's own parsed plan to get that scope's effective
  // PacePolicy, merge in the instance's own pace_overrides (same precedence
  // instantiatePlan itself applies — overrides at plan level, template
  // section/week overrides still win on top), parseDayEntry against that
  // policy, then resolveDay it the same way instantiatePlan resolves a
  // segment. Same zero-needs_review-to-save gate as before, derived from the
  // fresh parse rather than a client-supplied flag. `event` is never
  // accepted here — read-only/derived from the template at instantiation
  // time (HRA-114). Never touches or re-instantiates the source template —
  // an instance is allowed to diverge from what the template would
  // currently produce (docs/runplan-dsl-future-notes.md §7).
  const patchInstance: Handler = async (req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan instance id.");
    const instance = instancesRepo.instanceById(id);
    if (!instance) throw notFound(`No plan instance with id ${id}.`);

    const body = await readJsonBody<InstanceUpdateBody>(req);
    const hasName = "name" in body;
    const hasRaceName = "race_name" in body;
    const hasRaceDate = "race_date" in body;
    const hasRaceUrl = "race_url" in body;
    const hasDays = "days" in body;
    if (!hasName && !hasRaceName && !hasRaceDate && !hasRaceUrl && !hasDays) {
      throw unprocessable("At least one of name, race_name, race_date, race_url, days is required.");
    }

    const fields: Partial<{ name: string; race_name: string | null; race_date: string | null; race_url: string | null }> = {};
    if (hasName) {
      const name = body.name?.trim();
      if (!name) throw unprocessable("name must not be blank.");
      fields.name = name;
    }
    if (hasRaceName) fields.race_name = body.race_name?.trim() || null;
    if (hasRaceDate) {
      if (body.race_date != null && !ISO_DATE.test(body.race_date)) {
        throw unprocessable("race_date must be in YYYY-MM-DD format.");
      }
      fields.race_date = body.race_date ?? null;
    }
    if (hasRaceUrl) fields.race_url = body.race_url?.trim() || null;

    let dayInputs: Omit<PlanInstanceDayInput, "instance_id">[] | undefined;
    if (hasDays) {
      const template = templates.byId(instance.template_id);
      if (!template) throw notFound(`No plan template with id ${instance.template_id}.`);
      const plan = JSON.parse(template.parsed_plan) as RunPlan;
      const instanceOverrides: PacePolicy = instance.pace_overrides ? JSON.parse(instance.pace_overrides) : {};
      const overriddenPlan: RunPlan = {
        ...plan,
        metadata: { ...plan.metadata, pace_policy: { ...plan.metadata.pace_policy, ...instanceOverrides } },
      };

      if (!Array.isArray(body.days) || body.days.length === 0) {
        throw unprocessable("days must be a non-empty array when provided.");
      }

      const flagged: { field: string; message: string }[] = [];
      dayInputs = [];
      for (const d of body.days) {
        if (!d.section_name || !d.week_number || !d.date || !d.dsl?.trim()) {
          throw unprocessable("Each day requires section_name, week_number, date, and dsl.");
        }
        const section = overriddenPlan.sections.find(s => s.name === d.section_name);
        const week = section?.weeks.find(w => w.number === d.week_number);
        if (!section || !week) {
          throw unprocessable(`Unknown section/week for day: "${d.section_name}" week ${d.week_number}.`);
        }
        const policy = getEffectivePacePolicy(overriddenPlan, section, week);
        const ctx: DayParseContext = {
          unit: overriddenPlan.metadata.unit, offset_unit: overriddenPlan.metadata.offset_unit,
          default_rest: overriddenPlan.metadata.default_rest, pacePolicy: policy,
          // An instance's pace must actually resolve — no TBD leniency here,
          // unlike template parsing (parser.ts's parseRunPlanDSL).
          allowUnboundPace: false,
        };
        const parsedDay = parseDayEntry(d.dsl, ctx);
        if (parsedDay.needs_review) {
          flagged.push({ field: `week ${d.week_number} day ${parsedDay.day}`, message: `Day ${parsedDay.day} (${d.date}) still needs review.` });
          continue;
        }
        const resolved = resolveDay(parsedDay, d.section_name, d.week_number, d.date, policy);
        dayInputs.push({
          section_name: resolved.section_name, week_number: resolved.week_number, date: resolved.date, day: resolved.day,
          suffix: resolved.suffix ?? null, category: resolved.category ?? null, workout_type: resolved.workout_type,
          segments: JSON.stringify(resolved.segments),
          activity_target: resolved.activity_target ? JSON.stringify(resolved.activity_target) : null,
          activity_description: resolved.activity_description ?? null, notes: resolved.notes ?? null,
          needs_review: resolved.needs_review ? 1 : 0,
          // HRA-149: a wholesale days replace never backfills scheduled_time —
          // NULL reads as the 08:00 display default until set via the
          // per-day PATCH.
          scheduled_time: null,
        });
      }
      if (flagged.length > 0) {
        throw unprocessable("One or more days still need review — resolve every flag before saving.", { errors: flagged });
      }
    }

    const { instance: updated, days } = instancesService.patchInstance(id, fields, dayInputs);
    return send(res, { ...updated, days });
  };

  // Shared by the persisting PATCH (patchInstanceDay) and the parse-only
  // preview (validateInstanceDay) below — both need this day's own effective
  // section/week scope + PacePolicy to parseDayEntry the same way
  // patchInstance's bulk days-replace resolves each day. Kept private to this
  // controller: no other caller needs a day's parse without an instance+day.
  function parseDayInScope(
    instance: PlanInstanceRow, day: PlanInstanceDayRow, dsl: string,
  ): { parsedDay: DayEntry; policy: PacePolicy } {
    const template = templates.byId(instance.template_id);
    if (!template) throw notFound(`No plan template with id ${instance.template_id}.`);
    const plan = JSON.parse(template.parsed_plan) as RunPlan;
    const instanceOverrides: PacePolicy = instance.pace_overrides ? JSON.parse(instance.pace_overrides) : {};
    const overriddenPlan: RunPlan = {
      ...plan,
      metadata: { ...plan.metadata, pace_policy: { ...plan.metadata.pace_policy, ...instanceOverrides } },
    };
    const section = overriddenPlan.sections.find(s => s.name === day.section_name);
    const week = section?.weeks.find(w => w.number === day.week_number);
    if (!section || !week) {
      throw unprocessable(`Unknown section/week for this day: "${day.section_name}" week ${day.week_number}.`);
    }
    const policy = getEffectivePacePolicy(overriddenPlan, section, week);
    const ctx: DayParseContext = {
      unit: overriddenPlan.metadata.unit, offset_unit: overriddenPlan.metadata.offset_unit,
      default_rest: overriddenPlan.metadata.default_rest, pacePolicy: policy,
      // An instance's pace must actually resolve — no TBD leniency here,
      // unlike template parsing (parser.ts's parseRunPlanDSL).
      allowUnboundPace: false,
    };
    return { parsedDay: parseDayEntry(dsl, ctx), policy };
  }

  // PATCH /api/v1/plan-instances/:id/days/:dayId (HRA-149) — a single day's
  // dsl/notes/scheduled_time, independently. Rejected outright on an already-
  // approved instance (mirrors HRA-126's intended "editable only until
  // approved" lock, which the earlier Story only enforced client-side). dsl,
  // when supplied, is re-parsed+resolved against this day's own existing
  // section/week/date scope and the template's effective PacePolicy — same
  // logic as the bulk days-replace path in patchInstance above, just for one
  // day instead of the whole set. Never touches or re-instantiates the
  // source template.
  const patchInstanceDay: Handler = async (req, res, url) => {
    const { instanceId, dayId } = parseInstanceAndDayId(url.pathname);
    if (!Number.isInteger(instanceId) || !Number.isInteger(dayId)) throw badRequest("Invalid plan instance or day id.");
    const instance = instancesRepo.instanceById(instanceId);
    if (!instance) throw notFound(`No plan instance with id ${instanceId}.`);
    if (instance.approved_at) throw conflict("This instance is approved and its days can no longer be edited.");
    const day = instancesRepo.dayById(dayId);
    if (!day || day.instance_id !== instanceId) throw notFound(`No day with id ${dayId} on plan instance ${instanceId}.`);

    const body = await readJsonBody<DayPatchBody>(req);
    const hasDsl = "dsl" in body;
    const hasNotes = "notes" in body;
    const hasScheduledTime = "scheduled_time" in body;
    if (!hasDsl && !hasNotes && !hasScheduledTime) {
      throw unprocessable("At least one of dsl, notes, scheduled_time is required.");
    }

    let scheduledTime: string | null | undefined;
    if (hasScheduledTime) {
      if (body.scheduled_time != null && !SCHEDULED_TIME_RE.test(body.scheduled_time)) {
        throw unprocessable("scheduled_time must be in HH:MM 24-hour format.");
      }
      scheduledTime = body.scheduled_time ?? null;
    }

    let dslFields: { day: number; suffix: string | null; category: string | null; workout_type: string; segments: string; activity_target: string | null; activity_description: string | null; notes: string | null; needs_review: number } | undefined;
    if (hasDsl) {
      if (!body.dsl?.trim()) throw unprocessable("dsl must not be blank.");
      const { parsedDay, policy } = parseDayInScope(instance, day, body.dsl);
      if (parsedDay.needs_review) {
        throw unprocessable("Day still needs review — resolve every flag before saving.", {
          errors: parsedDay.warnings.map(w => ({ field: `week ${day.week_number} day ${parsedDay.day}`, message: w.message })),
        });
      }
      const resolved = resolveDay(parsedDay, day.section_name, day.week_number, day.date, policy);
      dslFields = {
        day: resolved.day, suffix: resolved.suffix ?? null, category: resolved.category ?? null, workout_type: resolved.workout_type,
        segments: JSON.stringify(resolved.segments),
        activity_target: resolved.activity_target ? JSON.stringify(resolved.activity_target) : null,
        activity_description: resolved.activity_description ?? null, notes: resolved.notes ?? null,
        needs_review: resolved.needs_review ? 1 : 0,
      };
    }
    const notes = hasNotes ? (body.notes?.trim() || null) : undefined;

    const updated = instancesService.patchDay(dayId, dslFields, notes, scheduledTime);
    return send(res, updated);
  };

  // POST /api/v1/plan-instances/:id/days/:dayId/validate (HRA-162, resolved
  // fields added in a live follow-up) — parse-only preview of a day's DSL
  // edit, never persists: what the List view's per-day editor calls
  // (debounced) as the user types, so warning feedback (and now
  // workout_type/distance, for keeping the day's own total and its
  // week/section rollups live too) updates live instead of only after the
  // whole-day bulk Save round-trip. Deliberately reuses parseDayInScope —
  // the exact same parseDayEntry call and ParseWarning taxonomy the
  // persisting PATCH above validates against — never a separate
  // client-side grammar reimplementation that could drift from parser.ts
  // (docs/runplan-dsl.md's warnings-only model). Always 200: parseDayEntry
  // itself never hard-rejects (docs/runplan-dsl.md), it only ever produces
  // warnings — the caller reads needs_review/warnings from the body, same
  // shape a DayEntry itself carries. No approved-instance guard (unlike the
  // PATCH above): this never mutates anything, so there's nothing for that
  // lock to protect.
  // When the parse itself succeeds (parsedDay.needs_review false), also
  // resolves it — same resolveDay call the persisting PATCH makes — and
  // returns workout_type/segments/activity_target/activity_description so
  // the frontend can compute this day's own distance via its existing
  // computeResolvedDayDistance, without a client-side DSL parser and
  // without persisting anything. needs_review in the response then reflects
  // resolveDay's own verdict (day.needs_review || an unresolved pace
  // anchor) rather than only the syntactic parse's — a day can parse fine
  // but still need review once resolved (the PATCH endpoint already
  // tolerates and persists exactly this case; this endpoint previously
  // under-reported it as always false). When parsing itself fails, resolve
  // is skipped (its inputs may be malformed) and the response stays exactly
  // the pre-existing {needs_review: true, warnings} shape.
  const validateInstanceDay: Handler = async (req, res, url) => {
    const { instanceId, dayId } = parseInstanceAndDayId(url.pathname);
    if (!Number.isInteger(instanceId) || !Number.isInteger(dayId)) throw badRequest("Invalid plan instance or day id.");
    const instance = instancesRepo.instanceById(instanceId);
    if (!instance) throw notFound(`No plan instance with id ${instanceId}.`);
    const day = instancesRepo.dayById(dayId);
    if (!day || day.instance_id !== instanceId) throw notFound(`No day with id ${dayId} on plan instance ${instanceId}.`);

    const body = await readJsonBody<{ dsl?: string }>(req);
    if (!body.dsl?.trim()) throw unprocessable("dsl is required.");

    const { parsedDay, policy } = parseDayInScope(instance, day, body.dsl);
    if (parsedDay.needs_review) {
      return send(res, { needs_review: true, warnings: parsedDay.warnings });
    }
    const resolved = resolveDay(parsedDay, day.section_name, day.week_number, day.date, policy);
    return send(res, {
      needs_review: resolved.needs_review, warnings: parsedDay.warnings,
      workout_type: resolved.workout_type, segments: resolved.segments,
      activity_target: resolved.activity_target ?? null, activity_description: resolved.activity_description ?? null,
    });
  };

  // GET /api/v1/plan-instances/:id/days/:dayId/fit (HRA-202) — exports one
  // already-resolved plan_instance_days row as a Garmin Workout .fit file,
  // wrapping toGarminWorkoutFit (integrations/garmin-workout.ts) — the same
  // domain transform the DSL editor's characterization tests exercise. Read-
  // only: nothing is parsed or persisted here, so an approved instance is not
  // guarded against (unlike patchInstanceDay above). Rejects (422) exactly
  // the day states toGarminWorkoutFit itself rejects — needs_review, or a
  // workout_type other than run/rest — surfacing each GarminExportError as a
  // field-level error the frontend's toast can read the reason from.
  function sanitizeFitFilename(name: string): string {
    return name.replace(/["\\\r\n]/g, "");
  }

  // Shared by dayFit and scopeFit below — both turn a PlanInstanceDayRow into
  // the ResolvedDay shape toGarminWorkoutFit expects (JSON columns parsed,
  // nulls normalized to undefined).
  function toResolvedDay(day: PlanInstanceDayRow): ResolvedDay {
    return {
      section_name: day.section_name, week_number: day.week_number, date: day.date, day: day.day,
      suffix: day.suffix ?? undefined, category: day.category ?? undefined,
      workout_type: day.workout_type as ResolvedDay["workout_type"],
      segments: JSON.parse(day.segments),
      activity_target: day.activity_target ? JSON.parse(day.activity_target) : undefined,
      activity_description: day.activity_description ?? undefined,
      notes: day.notes ?? undefined,
      needs_review: day.needs_review === 1,
    };
  }

  const dayFit: Handler = (_req, res, url) => {
    const { instanceId, dayId } = parseInstanceAndDayId(url.pathname);
    if (!Number.isInteger(instanceId) || !Number.isInteger(dayId)) throw badRequest("Invalid plan instance or day id.");
    const instance = instancesRepo.instanceById(instanceId);
    if (!instance) throw notFound(`No plan instance with id ${instanceId}.`);
    const day = instancesRepo.dayById(dayId);
    if (!day || day.instance_id !== instanceId) throw notFound(`No day with id ${dayId} on plan instance ${instanceId}.`);

    const outcome = toGarminWorkoutFit(toResolvedDay(day));
    if (!outcome.ok) {
      throw unprocessable("This day cannot be exported to a Garmin Workout FIT file.", {
        errors: outcome.errors.map(e => ({ field: e.code, message: e.message })),
      });
    }

    const instanceName = instance.name ?? `Plan Instance ${instance.id}`;
    const filename = sanitizeFitFilename(`${instanceName}_${day.date.replace(/-/g, "")}.fit`);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(outcome.bytes);
  };

  // GET /api/v1/plan-instances/:id/fit?section_name=&week_number= (HRA-203) —
  // bundles every exportable day in a section (or, when week_number is also
  // given, one week within that section) into a single uncompressed ZIP,
  // reusing dayFit's own toGarminWorkoutFit path per day. section_name/
  // week_number are query params, not path segments (rest-api-standards §3:
  // path = identity, query = filtering) — section_name is a free-text
  // denormalized column, not a real addressable sub-resource, so this stays
  // one route filtered two ways rather than two resource shapes.
  // Skip-and-continue (Story scope): a day toGarminWorkoutFit itself rejects
  // (needs_review, or a workout_type other than run/rest) is omitted from
  // the zip rather than failing the whole request — counts go back as
  // X-Export-* response headers (the body is opaque binary, so they can't
  // ride in it) for the frontend's own toast text. Zero exportable days in
  // scope (no matching rows at all, or every match rejected) is a 422 with
  // no zip written, mirroring dayFit's own rejection shape.
  const scopeFit: Handler = (_req, res, url) => {
    const id = parseIdForAction(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan instance id.");
    const instance = instancesRepo.instanceById(id);
    if (!instance) throw notFound(`No plan instance with id ${id}.`);

    const sectionName = url.searchParams.get("section_name");
    if (!sectionName) throw badRequest("section_name is required.");
    const weekParam = url.searchParams.get("week_number");
    let weekNumber: number | undefined;
    if (weekParam != null) {
      weekNumber = Number(weekParam);
      if (!Number.isInteger(weekNumber)) throw badRequest("week_number must be an integer.");
    }

    const days = weekNumber != null
      ? instancesRepo.daysBySectionAndWeek(id, sectionName, weekNumber)
      : instancesRepo.daysBySection(id, sectionName);

    const included: { day: PlanInstanceDayRow; bytes: Buffer }[] = [];
    let skipped = 0;
    for (const day of days) {
      const outcome = toGarminWorkoutFit(toResolvedDay(day));
      if (!outcome.ok) { skipped++; continue; }
      included.push({ day, bytes: outcome.bytes });
    }
    if (included.length === 0) {
      throw unprocessable("No exportable days in this scope.");
    }

    const instanceName = instance.name ?? `Plan Instance ${instance.id}`;
    const entries = dedupeZipEntryNames(included.map(({ day, bytes }) => ({
      name: sanitizeFitFilename(`${instanceName}_${day.date.replace(/-/g, "")}.fit`),
      data: bytes,
      date: new Date(`${day.date}T00:00:00Z`),
    })));
    const zipBytes = writeZip(entries);

    const dates = included.map(({ day }) => day.date).sort();
    const zipFilename = sanitizeFitFilename(
      `${instanceName}_${dates[0].replace(/-/g, "")}-${dates[dates.length - 1].replace(/-/g, "")}.zip`,
    );

    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
      "X-Export-Total": String(days.length),
      "X-Export-Included": String(included.length),
      "X-Export-Skipped": String(skipped),
      "Access-Control-Allow-Origin": "*",
    });
    res.end(zipBytes);
  };

  // POST /api/v1/plan-instances/:id/regenerate — HRA-132: regenerate an
  // instance's days from a cutover date onward, given a possibly-changed
  // start_date and/or pace policy overrides. Days before the cutover are
  // never touched (protects already-logged history); days from it onward
  // are fully regenerated from the template DSL, discarding any manual
  // edits on them (documented behavior, not a bug). Modeled as a POST action
  // sub-resource (same pattern as /instantiate and /approve above), not a
  // PUT/PATCH on the plain resource — it does more than replace fields, it
  // deletes/regenerates a date-bounded slice of a nested collection.
  // pace_overrides, when supplied, is the instance's new COMPLETE override
  // map (same semantics as /instantiate's own field) — not a partial merge
  // on top of whatever was stored before.
  const regenerateInstance: Handler = async (req, res, url) => {
    const id = parseIdForAction(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan instance id.");
    const instance = instancesRepo.instanceById(id);
    if (!instance) throw notFound(`No plan instance with id ${id}.`);
    const template = templates.byId(instance.template_id);
    if (!template) throw notFound(`No plan template with id ${instance.template_id}.`);

    const body = await readJsonBody<RegenerateBody>(req);
    if (!body.effective_from || !ISO_DATE.test(body.effective_from)) {
      throw unprocessable("effective_from is required in YYYY-MM-DD format.");
    }
    // Server-enforced floor — never trust the client's own "not before
    // today" check (rest-api-standards §10: validate at the boundary).
    const today = new Date().toISOString().slice(0, 10);
    if (body.effective_from < today) {
      throw unprocessable("effective_from cannot be before today.");
    }
    if (body.start_date != null && !ISO_DATE.test(body.start_date)) {
      throw unprocessable("start_date must be in YYYY-MM-DD format.");
    }

    const plan = JSON.parse(template.parsed_plan) as RunPlan;
    const startDate = body.start_date ?? instance.start_date;

    let paceOverrides: PacePolicy | undefined;
    if (body.pace_overrides) {
      paceOverrides = {};
      for (const [anchor, raw] of Object.entries(body.pace_overrides)) {
        const value = parsePaceValue(raw, plan.metadata.offset_unit);
        if (!value) throw unprocessable(`Invalid pace_overrides value for "${anchor}": ${raw}`);
        paceOverrides[anchor] = value;
      }
    } else if (instance.pace_overrides) {
      paceOverrides = JSON.parse(instance.pace_overrides) as PacePolicy;
    }

    const { instance: updated, days } = instancesService.regenerateFrom(id, plan, { startDate, paceOverrides }, body.effective_from);
    return send(res, { ...updated, days });
  };

  // POST /api/v1/plan-instances/:id/approve — gate 2, symmetric with the
  // template approve endpoint above.
  const approveInstance: Handler = (_req, res, url) => {
    const id = parseIdForAction(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan instance id.");
    if (!instancesRepo.instanceById(id)) throw notFound(`No plan instance with id ${id}.`);
    return send(res, instancesRepo.approve(id));
  };

  // DELETE /api/v1/plan-instances/:id — hard delete, no trash, same reasoning
  // as plan-templates' delete above (HRA-115). ON DELETE CASCADE
  // (plan_instance_days.instance_id) removes the instance's days too.
  const removeInstance: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid plan instance id.");
    if (!instancesRepo.instanceById(id)) throw notFound(`No plan instance with id ${id}.`);
    instancesRepo.remove(id);
    return sendNoContent(res);
  };

  return {
    list, getById, generate, create, update, approveTemplate, remove,
    instantiate, instanceById, patchInstance, patchInstanceDay, validateInstanceDay, dayFit, scopeFit,
    regenerateInstance, approveInstance, removeInstance, listInstances, daysByDate, activeForDate,
  };
}
