/**
 * controllers/activities.controller.ts
 * HTTP boundary for activities + track points + the workout-classifier workflow:
 * parse/validate input, call a repository (reads) or service (writes/business
 * logic), shape the response + status. No SQL, no transactions, no business rules.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { dateRange, readBody } from "../http/request.ts";
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
    if (isNaN(id)) return send(res, { error: "Invalid ID" }, 400);
    return send(res, repo.byId(id));
  };

  const track: Handler = (_req, res, url) => {
    // Path is /api/activities/:id/track — the id is the middle segment, not the last.
    const id = parseInt(url.pathname.match(/^\/api\/activities\/(\d+)\/track$/)?.[1] ?? "");
    if (isNaN(id)) return send(res, { error: "Invalid ID" }, 400);
    return send(res, repo.track(id));
  };

  const deleteRange: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, service.softDeleteRange(from, to));
  };

  const deleteById: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (isNaN(id)) return send(res, { error: "Invalid ID" }, 400);
    return send(res, service.softDeleteById(id));
  };

  // POST /api/activities/:id/classify — body { splitMeters?: number, method?: 'ai'|'statistical' }.
  const classify: Handler = async (req, res, url) => {
    const id = parseInt(url.pathname.match(/^\/api\/activities\/(\d+)\/classify$/)![1]);
    const body = JSON.parse((await readBody(req)) || "{}") as { splitMeters?: unknown; method?: unknown };
    const splitMeters = body.splitMeters != null ? Number(body.splitMeters) : 1000;
    if (!Number.isFinite(splitMeters) || splitMeters <= 0) {
      return send(res, { error: "splitMeters must be a positive number" }, 400);
    }
    const method = body.method ?? "ai";
    if (method !== "ai" && method !== "statistical") {
      return send(res, { error: "method must be 'ai' or 'statistical'" }, 400);
    }
    await classification.classify(id, splitMeters, method);
    return send(res, repo.byId(id));
  };

  // POST /api/activities/:id/feedback — body
  // { feedback: 'approved'|'rejected', source: 'ai'|'statistical', correctionReason?, finalClassification? }.
  const feedback: Handler = async (req, res, url) => {
    const id = parseInt(url.pathname.match(/^\/api\/activities\/(\d+)\/feedback$/)![1]);
    const body = JSON.parse((await readBody(req)) || "{}") as {
      feedback?: unknown; source?: unknown; correctionReason?: unknown; finalClassification?: unknown;
    };
    if (body.feedback !== "approved" && body.feedback !== "rejected") {
      return send(res, { error: "feedback must be 'approved' or 'rejected'" }, 400);
    }
    if (body.source !== "ai" && body.source !== "statistical") {
      return send(res, { error: "source must be 'ai' or 'statistical'" }, 400);
    }
    const current = repo.byId(id) as unknown as
      { ai_classification: string | null; statistical_classification: string | null } | undefined;
    if (!current) return send(res, { error: "Activity not found" }, 404);
    const sourceClassification = body.source === "ai" ? current.ai_classification : current.statistical_classification;

    let finalClassification: string | null = sourceClassification;
    let correctionReason: string | null = null;
    if (body.feedback === "approved") {
      if (!sourceClassification) {
        return send(res, { error: `Activity has no ${body.source} classification yet` }, 400);
      }
    } else {
      if (typeof body.correctionReason !== "string" || !CORRECTION_REASONS.includes(body.correctionReason)) {
        return send(res, { error: `correctionReason must be one of: ${CORRECTION_REASONS.join(", ")}` }, 400);
      }
      if (typeof body.finalClassification !== "string" || !(WORKOUT_CLASSIFICATIONS as readonly string[]).includes(body.finalClassification)) {
        return send(res, { error: `finalClassification must be one of: ${WORKOUT_CLASSIFICATIONS.join(", ")}` }, 400);
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
    const body = JSON.parse((await readBody(req)) || "{}") as { ids?: unknown; method?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
    if (ids.length === 0) return send(res, { error: "ids must be a non-empty array of integers" }, 400);
    const method = body.method ?? "ai";
    if (method !== "ai" && method !== "statistical") {
      return send(res, { error: "method must be 'ai' or 'statistical'" }, 400);
    }
    return send(res, service.confirm(ids, method));
  };

  // POST /api/activities/restore | /api/activities/purge — body { ids: number[] }.
  const restorePurge: Handler = async (req, res, url) => {
    const body = JSON.parse((await readBody(req)) || "{}") as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
    if (ids.length === 0) return send(res, { error: "ids must be a non-empty array of integers" }, 400);
    const purge = url.pathname.endsWith("/purge");
    return send(res, purge ? service.purge(ids) : service.restore(ids));
  };

  return { range, list, count, trash, getById, track, deleteRange, deleteById, classify, feedback, confirm, restorePurge };
}
