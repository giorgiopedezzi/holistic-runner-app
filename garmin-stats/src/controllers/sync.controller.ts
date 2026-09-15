/**
 * controllers/sync.controller.ts
 * HTTP boundary for triggering syncs. Garmin streams NDJSON progress (via the
 * http/stream-sync helper); Withings/Strava are blocking and return a summary from
 * the sync service. Passes through the optional from/to query params as CLI args.
 *
 * HRA-352: every sync is owner-scoped (router.ts requires auth on these
 * routes — AC7) — the authenticated owner's id is passed to the spawned
 * script explicitly as `--user-id` (never a script-side default), a
 * per-owner+provider run lock (services/sync-lock.ts) rejects an overlapping
 * request instead of racing it (AC8), and Withings/Strava additionally
 * revalidate the connection is present before spawning (AC7's "cannot fall
 * back to a global token/default account" — a missing connection fails the
 * request outright rather than letting the child process discover it late).
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { requestIdentity } from "../http/auth-context.ts";
import { unprocessable, conflict } from "../http/problem.ts";
import { streamSyncScript } from "../http/stream-sync.ts";
import { acquireSyncLock, releaseSyncLock, SyncAlreadyRunningError, type SyncProvider } from "../services/sync-lock.ts";
import { getTokenStatus as getWithingsStatus } from "../integrations/withings.ts";
import { getTokenStatus as getStravaStatus } from "../integrations/strava.ts";

export function createSyncController(ctx: AppContext) {
  const service = ctx.services.sync;
  const { scriptsDir, config, db } = ctx;

  const garmin: Handler = async (req, res) => {
    const userId = requestIdentity(req).userId;
    let runId: number;
    try {
      runId = await acquireSyncLock(db, userId, "garmin");
    } catch (e) {
      if (e instanceof SyncAlreadyRunningError) throw conflict(e.message);
      throw e;
    }
    return streamSyncScript(res, "jobs/sync-garmin.ts", scriptsDir, ["--user-id", userId], async outcome => {
      await releaseSyncLock(db, runId, outcome.type === "done"
        ? { status: "succeeded", imported: outcome.imported, skipped: outcome.skipped, errors: outcome.errors }
        : { status: "failed", errorMessage: outcome.message });
    });
  };

  async function runBlockingSync(provider: Extract<SyncProvider, "withings" | "strava">, scriptName: string, url: URL, req: Parameters<Handler>[0]) {
    const userId = requestIdentity(req).userId;
    const status = provider === "withings" ? await getWithingsStatus(config, db, userId) : await getStravaStatus(config, db, userId);
    if (!status.present) throw unprocessable(`No ${provider} connection for this account. Connect it from the dashboard first.`);

    const runId = await acquireSyncLock(db, userId, provider);
    const args = ["--user-id", userId];
    const from = url.searchParams.get("from");
    const to   = url.searchParams.get("to");
    if (from) args.push("--from", from);
    if (to)   args.push("--to", to);
    try {
      const result = await service.runSyncScript(scriptName, args);
      await releaseSyncLock(db, runId, { status: "succeeded", imported: result.imported, skipped: result.skipped, errors: result.errors });
      return result;
    } catch (e) {
      await releaseSyncLock(db, runId, { status: "failed", errorMessage: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  const withings: Handler = async (req, res, url) => {
    try {
      return send(res, await runBlockingSync("withings", "jobs/sync-withings.ts", url, req));
    } catch (e) {
      if (e instanceof SyncAlreadyRunningError) throw conflict(e.message);
      throw e;
    }
  };

  const strava: Handler = async (req, res, url) => {
    try {
      return send(res, await runBlockingSync("strava", "jobs/sync-strava.ts", url, req));
    } catch (e) {
      if (e instanceof SyncAlreadyRunningError) throw conflict(e.message);
      throw e;
    }
  };

  return { garmin, withings, strava };
}
