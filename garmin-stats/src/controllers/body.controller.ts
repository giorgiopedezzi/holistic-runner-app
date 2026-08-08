/**
 * controllers/body.controller.ts
 * HTTP boundary for Withings body measurements + the km/weight correlation.
 * parse/validate input, call the repository (reads) or service (writes + the
 * correlation threshold), shape the response + status. No SQL, no business rules.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send, sendNoContent } from "../http/respond.ts";
import { dateRange, readBody } from "../http/request.ts";

export function createBodyController(ctx: AppContext) {
  const repo = ctx.repos.body;
  const service = ctx.services.body;

  const range: Handler = (_req, res) => send(res, repo.dateRange());

  const list: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, repo.list(from, to));
  };

  const count: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, repo.countInRange(from, to));
  };

  const monthly: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, repo.monthly(from, to));
  };

  const trash: Handler = (_req, res) => send(res, repo.trash());

  const correlation: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    const { hasData, rows } = service.correlation(from, to);
    if (!hasData) { sendNoContent(res); return; }
    return send(res, rows);
  };

  const deleteRange: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, service.softDeleteRange(from, to));
  };

  // POST /api/body/restore | /api/body/purge — body { ids: number[] }.
  const restorePurge: Handler = async (req, res, url) => {
    const body = JSON.parse((await readBody(req)) || "{}") as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
    if (ids.length === 0) return send(res, { error: "ids must be a non-empty array of integers" }, 400);
    const purge = url.pathname.endsWith("/purge");
    return send(res, purge ? service.purge(ids) : service.restore(ids));
  };

  return { range, list, count, monthly, trash, correlation, deleteRange, restorePurge };
}
