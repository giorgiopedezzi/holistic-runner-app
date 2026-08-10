/**
 * controllers/activities.controller.ts
 * HTTP boundary for activities + track points + the workout-classifier workflow:
 * parse/validate input, call a repository (reads) or service (writes/business
 * logic), shape the response + status. No SQL, no transactions, no business rules.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { dateRange, readJsonBody } from "../http/request.ts";
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
  const service = ctx.services.activities;
  const classification = ctx.services.classification;

  const range: Handler = (_req, res) => send(res, repo.dateRange());

  const list: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, repo.list(from, to));
  };

  const count: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, repo.countInRange(from, to));
  };

  const trash: Handler = (_req, res) => send(res, repo.trash());

  const getById: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (isNaN(id)) throw badRequest("Invalid activity id.");
    const row = repo.byId(id);
    if (!row) throw notFound(`Activity ${id} not found.`);
    return send(res, row);
  };

  const track: Handler = (_req, res, url) => {
    // Path is /api/activities/:id/track — the id is the middle segment, not the last.
    const id = parseInt(url.pathname.match(/^\/api\/activities\/(\d+)\/track$/)?.[1] ?? "");
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
    const id = parseInt(url.pathname.match(/^\/api\/activities\/(\d+)\/classify$/)![1]);
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
    const id = parseInt(url.pathname.match(/^\/api\/activities\/(\d+)\/feedback$/)![1]);
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

  return { range, list, count, trash, getById, track, deleteRange, deleteById, classify, feedback, confirm, restorePurge };
}
