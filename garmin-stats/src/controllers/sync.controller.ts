/**
 * controllers/sync.controller.ts
 * HTTP boundary for triggering syncs. Garmin streams NDJSON progress (via the
 * http/stream-sync helper); Withings/Strava are blocking and return a summary from
 * the sync service. Passes through the optional from/to query params as CLI args.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { streamSyncScript } from "../http/stream-sync.ts";

export function createSyncController(ctx: AppContext) {
  const service = ctx.services.sync;
  const { scriptsDir } = ctx;

  const garmin: Handler = (_req, res) => { streamSyncScript(res, "jobs/sync-garmin.ts", scriptsDir); };

  const withings: Handler = async (_req, res, url) => {
    const args: string[] = [];
    const wFrom = url.searchParams.get("from");
    const wTo   = url.searchParams.get("to");
    if (wFrom) args.push("--from", wFrom);
    if (wTo)   args.push("--to", wTo);
    return send(res, await service.runSyncScript("jobs/sync-withings.ts", args));
  };

  const strava: Handler = async (_req, res, url) => {
    const args: string[] = [];
    const sFrom = url.searchParams.get("from");
    const sTo   = url.searchParams.get("to");
    if (sFrom) args.push("--from", sFrom);
    if (sTo)   args.push("--to", sTo);
    return send(res, await service.runSyncScript("jobs/sync-strava.ts", args));
  };

  return { garmin, withings, strava };
}
