/**
 * http/router.ts
 * The routes layer: declares path + method and delegates to a controller. No
 * business logic, no data access — just matching + dispatch, plus the shared
 * cross-cutting concerns (CORS preflight, the URL parse, the top-level 404 and the
 * 500 catch). Controllers are built once from the AppContext (HRA-31).
 */
import http from "http";
import { URL } from "url";
import type { AppContext } from "./context.ts";
import { send } from "./respond.ts";
import { createActivitiesController } from "../controllers/activities.controller.ts";
import { createTrendsController } from "../controllers/trends.controller.ts";
import { createBodyController } from "../controllers/body.controller.ts";
import { createSettingsController } from "../controllers/settings.controller.ts";
import { createSyncController } from "../controllers/sync.controller.ts";
import { createIntegrationsController } from "../controllers/integrations.controller.ts";
import { createDocsController } from "../controllers/docs.controller.ts";

export function createApiHandler(ctx: AppContext): http.RequestListener {
  const activities   = createActivitiesController(ctx);
  const trends       = createTrendsController(ctx);
  const body         = createBodyController(ctx);
  const settings     = createSettingsController(ctx);
  const sync         = createSyncController(ctx);
  const integrations = createIntegrationsController(ctx);
  const docs         = createDocsController(ctx);
  const { port } = ctx;

  return async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      });
      res.end(); return;
    }

    const url   = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const route = url.pathname;

    try {
      if (req.method === "GET") {
        if (route === "/api/docs")                     return await docs.ui(req, res, url);
        if (route === "/api/openapi.json")             return await docs.spec(req, res, url);
        if (route === "/api/range")                    return await activities.range(req, res, url);
        if (route === "/api/body/range")               return await body.range(req, res, url);
        if (route === "/api/garmin/status")            return await integrations.garminStatus(req, res, url);
        if (route === "/api/withings/status")          return await integrations.withingsStatus(req, res, url);
        if (route === "/api/withings/login-url")       return await integrations.withingsLoginUrl(req, res, url);
        if (route === "/api/settings")                 return await settings.get(req, res, url);
        if (route === "/api/settings/background-image") return await settings.backgroundImage(req, res, url);
        if (route === "/api/strava/status")            return await integrations.stravaStatus(req, res, url);
        if (route === "/api/strava/login-url")         return await integrations.stravaLoginUrl(req, res, url);
        if (route === "/api/strava/callback")          return await integrations.stravaCallback(req, res, url);
        if (route === "/api/activities")               return await activities.list(req, res, url);
        if (route === "/api/activities/count")         return await activities.count(req, res, url);
        if (route === "/api/activities/trash")         return await activities.trash(req, res, url);
        if (route === "/api/body/count")               return await body.count(req, res, url);
        if (route === "/api/body/trash")               return await body.trash(req, res, url);
        if (route === "/api/summary")                  return await trends.summary(req, res, url);
        if (route === "/api/weekly")                   return await trends.weekly(req, res, url);
        if (route === "/api/monthly")                  return await trends.monthly(req, res, url);
        if (route === "/api/body/list")                return await body.list(req, res, url);
        if (route === "/api/body/monthly")             return await body.monthly(req, res, url);
        if (route === "/api/body/correlation")         return await body.correlation(req, res, url);
        if (/^\/api\/activities\/\d+\/track$/.test(route)) return await activities.track(req, res, url);
        if (/^\/api\/activities\/\d+$/.test(route))        return await activities.getById(req, res, url);
      }

      if (req.method === "DELETE") {
        if (route === "/api/activities")               return await activities.deleteRange(req, res, url);
        if (/^\/api\/activities\/\d+$/.test(route))        return await activities.deleteById(req, res, url);
        if (route === "/api/body")                     return await body.deleteRange(req, res, url);
      }

      if (req.method === "PUT") {
        if (route === "/api/settings")                 return await settings.updateOutliers(req, res, url);
        if (route === "/api/settings/theme")           return await settings.updateTheme(req, res, url);
        if (route === "/api/settings/background")       return await settings.updateBackground(req, res, url);
        if (route === "/api/settings/units")           return await settings.updateUnits(req, res, url);
        if (route === "/api/settings/detail-view")     return await settings.updateDetailView(req, res, url);
      }

      if (req.method === "POST") {
        if (route === "/api/sync/garmin")              return await sync.garmin(req, res, url);
        if (route === "/api/sync/withings")            return await sync.withings(req, res, url);
        if (route === "/api/sync/strava")              return await sync.strava(req, res, url);
        if (/^\/api\/activities\/\d+\/classify$/.test(route)) return await activities.classify(req, res, url);
        if (/^\/api\/activities\/\d+\/feedback$/.test(route)) return await activities.feedback(req, res, url);
        if (route === "/api/activities/confirm")       return await activities.confirm(req, res, url);
        if (route === "/api/activities/restore" || route === "/api/activities/purge") return await activities.restorePurge(req, res, url);
        if (route === "/api/body/restore" || route === "/api/body/purge")             return await body.restorePurge(req, res, url);
        if (route === "/api/settings/background/upload") return await settings.uploadBackground(req, res, url);
      }

      send(res, { error: "Not found" }, 404);
    } catch (e) {
      send(res, { error: e instanceof Error ? e.message : String(e) }, 500);
    }
  };
}
