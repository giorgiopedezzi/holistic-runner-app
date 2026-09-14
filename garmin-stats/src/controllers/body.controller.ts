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
import { requestIdentity } from "../http/auth-context.ts";
import { createOwnedBodyRepo } from "../repositories/owned-body.repo.ts";

export function createBodyController(ctx: AppContext) {
  const service = ctx.services.body;
  const owned = (req: import("http").IncomingMessage) => createOwnedBodyRepo(ctx.db, requestIdentity(req).userId);

  const range: Handler = async (req, res) => send(res, await owned(req).dateRange());

  const list: Handler = async (req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = (await owned(req).countInRange(from, to))?.count ?? 0;
    return send(res, paginated(await owned(req).listPage(from, to, limit, offset), total, limit, offset));
  };

  const count: Handler = async (req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, await owned(req).countInRange(from, to));
  };

  const monthly: Handler = async (req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, wholePage(await owned(req).monthly(from, to)));
  };

  const trash: Handler = async (req, res, url) => {
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = (await owned(req).trashCount())?.count ?? 0;
    return send(res, paginated(await owned(req).trashPage(limit, offset), total, limit, offset));
  };

  const correlation: Handler = async (req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    // HRA-32: an empty correlation is a normal 200 with [] — not a 204. "No
    // overlapping data" is data (an empty set), and a collection endpoint should
    // return the same list shape whether or not it's empty.
    const { rows } = await service.correlation(requestIdentity(req).userId, from, to);
    return send(res, wholePage(rows));
  };

  const deleteRange: Handler = async (req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, await service.softDeleteRange(requestIdentity(req).userId, from, to));
  };

  // POST /api/body-measurements/restore | /api/body-measurements/purge — body { ids: number[] }.
  const restorePurge: Handler = async (req, res, url) => {
    const body = await readJsonBody<{ ids?: unknown }>(req);
    const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
    if (ids.length === 0) throw unprocessable("ids must be a non-empty array of integers.");
    const purge = url.pathname.endsWith("/purge");
    return send(res, purge ? await service.purge(requestIdentity(req).userId, ids) : await service.restore(requestIdentity(req).userId, ids));
  };

  return { range, list, count, monthly, trash, correlation, deleteRange, restorePurge };
}
