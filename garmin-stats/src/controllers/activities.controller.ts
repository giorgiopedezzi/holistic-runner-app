/**
 * controllers/activities.controller.ts
 * HTTP boundary for activities + track points + the workout-classifier workflow:
 * parse/validate input, call a repository (reads) or service (writes/business
 * logic), shape the response + status. No SQL, no transactions, no business rules.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { dateRange, parsePageParams, readJsonBody } from "../http/request.ts";
import { paginated } from "../http/envelope.ts";
import { badRequest, notFound, unprocessable } from "../http/problem.ts";
import { WORKOUT_CLASSIFICATIONS } from "../integrations/ollama.ts";

// Correction reasons for the thumbs-down flow (also duplicated in the dashboard's
// types/api.ts — no shared package between the two npm projects).
const CORRECTION_REASONS = [
  "Warmup/cooldown skewed data",
  "Perception felt harder than numbers",
  "Traffic/Stops disrupted pace",
  "Other",
];

function parseId(pathname: string): number {
  return parseInt(pathname.split("/").pop() ?? "");
}

export function createActivitiesController(ctx: AppContext) {
  const repo = ctx.repos.activities;
  const activityTypes = ctx.repos.activityTypes;
  const service = ctx.services.activities;
  const classification = ctx.services.classification;

  const range: Handler = (_req, res) => send(res, repo.dateRange());

  const list: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = (repo.countInRange(from, to) as { count: number }).count;
    return send(res, paginated(repo.listPage(from, to, limit, offset), total, limit, offset));
  };

  const count: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, repo.countInRange(from, to));
  };

  // GET /api/v1/activities/races — race-type activities (not Training), full
  // history, for the "link a race" dropdown on the date-ranges save form.
  const races: Handler = (_req, res, url) => {
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = (repo.racesCount() as { count: number }).count;
    return send(res, paginated(repo.races(limit, offset), total, limit, offset));
  };

  const trash: Handler = (_req, res, url) => {
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = (repo.trashCount() as { count: number }).count;
    return send(res, paginated(repo.trashPage(limit, offset), total, limit, offset));
  };

  const getById: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (isNaN(id)) throw badRequest("Invalid activity id.");
    const row = repo.byId(id);
    if (!row) throw notFound(`Activity ${id} not found.`);
    return send(res, row);
  };

  const track: Handler = (_req, res, url) => {
    // Path is /api/activities/:id/track — the id is the middle segment, not the last.
    const id = parseInt(url.pathname.match(/^\/api\/v1\/activities\/(\d+)\/track$/)?.[1] ?? "");
    if (isNaN(id)) throw badRequest("Invalid activity id.");
    return send(res, repo.track(id));
  };

  const deleteRange: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, service.softDeleteRange(from, to));
  };

  const deleteById: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (isNaN(id)) throw badRequest("Invalid activity id.");
    return send(res, service.softDeleteById(id));
  };

  // POST /api/activities/:id/classify — body { splitMeters?: number, method?: 'ai'|'statistical' }.
  const classify: Handler = async (req, res, url) => {
    const id = parseInt(url.pathname.match(/^\/api\/v1\/activities\/(\d+)\/classify$/)![1]);
    const body = await readJsonBody<{ splitMeters?: unknown; method?: unknown }>(req);
    const splitMeters = body.splitMeters != null ? Number(body.splitMeters) : 1000;
    if (!Number.isFinite(splitMeters) || splitMeters <= 0) {
      throw unprocessable("splitMeters must be a positive number.");
    }
    const method = body.method ?? "ai";
    if (method !== "ai" && method !== "statistical") {
      throw unprocessable("method must be 'ai' or 'statistical'.");
    }
    await classification.classify(id, splitMeters, method);
    return send(res, repo.byId(id));
  };

  // POST /api/activities/:id/feedback — body
  // { feedback: 'approved'|'rejected', source: 'ai'|'statistical', correctionReason?, finalClassification? }.
  const feedback: Handler = async (req, res, url) => {
    const id = parseInt(url.pathname.match(/^\/api\/v1\/activities\/(\d+)\/feedback$/)![1]);
    const body = await readJsonBody<{
      feedback?: unknown; source?: unknown; correctionReason?: unknown; finalClassification?: unknown;
    }>(req);
    if (body.feedback !== "approved" && body.feedback !== "rejected") {
      throw unprocessable("feedback must be 'approved' or 'rejected'.");
    }
    if (body.source !== "ai" && body.source !== "statistical") {
      throw unprocessable("source must be 'ai' or 'statistical'.");
    }
    const current = repo.byId(id) as unknown as
      { ai_classification: string | null; statistical_classification: string | null } | undefined;
    if (!current) throw notFound(`Activity ${id} not found.`);
    const sourceClassification = body.source === "ai" ? current.ai_classification : current.statistical_classification;

    let finalClassification: string | null = sourceClassification;
    let correctionReason: string | null = null;
    if (body.feedback === "approved") {
      if (!sourceClassification) {
        throw unprocessable(`Activity has no ${body.source} classification yet.`);
      }
    } else {
      if (typeof body.correctionReason !== "string" || !CORRECTION_REASONS.includes(body.correctionReason)) {
        throw unprocessable(`correctionReason must be one of: ${CORRECTION_REASONS.join(", ")}`);
      }
      if (typeof body.finalClassification !== "string" || !(WORKOUT_CLASSIFICATIONS as readonly string[]).includes(body.finalClassification)) {
        throw unprocessable(`finalClassification must be one of: ${WORKOUT_CLASSIFICATIONS.join(", ")}`);
      }
      correctionReason = body.correctionReason;
      finalClassification = body.finalClassification;
    }
    repo.updateFeedback({
      $id: id, $user_feedback: body.feedback, $user_correction_reason: correctionReason,
      $final_classification: finalClassification, $classification_method: body.source,
    });
    return send(res, repo.byId(id));
  };

  // PUT /api/v1/activities/:id/type — body { activity_type_id, name? }. Full
  // replacement of this sub-resource (rest-api §2/§1, same "own path per
  // Settings card" pattern as HRA-40) — the type and its name are set
  // together, not merged field-by-field.
  const setType: Handler = async (req, res, url) => {
    const id = parseInt(url.pathname.match(/^\/api\/v1\/activities\/(\d+)\/type$/)![1]);
    const current = repo.byId(id) as unknown as { distance_m: number | null } | undefined;
    if (!current) throw notFound(`Activity ${id} not found.`);

    const body = await readJsonBody<{ activity_type_id?: unknown; name?: unknown }>(req);
    const activityTypeId = Number(body.activity_type_id);
    if (!Number.isInteger(activityTypeId)) throw unprocessable("activity_type_id must be an integer.");
    const type = activityTypes.byId(activityTypeId);
    if (!type) throw unprocessable(`Unknown activity_type_id ${activityTypeId}.`);
    if ((current.distance_m ?? 0) < type.min_distance_m) {
      throw unprocessable(`Activity distance is shorter than ${type.name} requires.`);
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      throw unprocessable("name must be a string.");
    }
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

    repo.updateType({ $id: id, $activity_type_id: activityTypeId, $activity_name: name });
    return send(res, repo.byId(id));
  };

  // POST /api/activities/confirm — bulk-equivalent of thumbs-up. Body { ids, method? }.
  const confirm: Handler = async (req, res) => {
    const body = await readJsonBody<{ ids?: unknown; method?: unknown }>(req);
    const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
    if (ids.length === 0) throw unprocessable("ids must be a non-empty array of integers.");
    const method = body.method ?? "ai";
    if (method !== "ai" && method !== "statistical") {
      throw unprocessable("method must be 'ai' or 'statistical'.");
    }
    return send(res, service.confirm(ids, method));
  };

  // POST /api/activities/restore | /api/activities/purge — body { ids: number[] }.
  const restorePurge: Handler = async (req, res, url) => {
    const body = await readJsonBody<{ ids?: unknown }>(req);
    const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
    if (ids.length === 0) throw unprocessable("ids must be a non-empty array of integers.");
    const purge = url.pathname.endsWith("/purge");
    return send(res, purge ? service.purge(ids) : service.restore(ids));
  };

  return { range, list, count, races, trash, getById, track, deleteRange, deleteById, classify, feedback, setType, confirm, restorePurge };
}
