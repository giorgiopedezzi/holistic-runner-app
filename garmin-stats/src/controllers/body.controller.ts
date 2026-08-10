/**
 * controllers/body.controller.ts
 * HTTP boundary for Withings body measurements + the km/weight correlation.
 * parse/validate input, call the repository (reads) or service (writes + the
 * correlation threshold), shape the response + status. No SQL, no business rules.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { dateRange, parsePageParams, readJsonBody } from "../http/request.ts";
import { paginated, wholePage } from "../http/envelope.ts";
import { unprocessable } from "../http/problem.ts";

export function createBodyController(ctx: AppContext) {
  const repo = ctx.repos.body;
  const service = ctx.services.body;

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

  const monthly: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, wholePage(repo.monthly(from, to) as unknown[]));
  };

  const trash: Handler = (_req, res, url) => {
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = (repo.trashCount() as { count: number }).count;
    return send(res, paginated(repo.trashPage(limit, offset), total, limit, offset));
  };

  const correlation: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    // HRA-32: an empty correlation is a normal 200 with [] — not a 204. "No
    // overlapping data" is data (an empty set), and a collection endpoint should
    // return the same list shape whether or not it's empty.
    const { rows } = service.correlation(from, to);
    return send(res, wholePage(rows as unknown[]));
  };

  const deleteRange: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, service.softDeleteRange(from, to));
  };

  // POST /api/body-measurements/restore | /api/body-measurements/purge — body { ids: number[] }.
  const restorePurge: Handler = async (req, res, url) => {
    const body = await readJsonBody<{ ids?: unknown }>(req);
    const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
    if (ids.length === 0) throw unprocessable("ids must be a non-empty array of integers.");
    const purge = url.pathname.endsWith("/purge");
    return send(res, purge ? service.purge(ids) : service.restore(ids));
  };

  return { range, list, count, monthly, trash, correlation, deleteRange, restorePurge };
}
