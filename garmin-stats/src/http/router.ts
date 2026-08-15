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
import { send, sendProblem } from "./respond.ts";
import { ApiProblem, notFound, internal } from "./problem.ts";
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
        if (route === "/api/v1/docs")                     return await docs.ui(req, res, url);
        if (route === "/api/v1/openapi.json")             return await docs.spec(req, res, url);
        if (route === "/api/v1/range")                    return await activities.range(req, res, url);
        if (route === "/api/v1/body-measurements/range")               return await body.range(req, res, url);
        if (route === "/api/v1/garmin/status")            return await integrations.garminStatus(req, res, url);
        if (route === "/api/v1/withings/status")          return await integrations.withingsStatus(req, res, url);
        if (route === "/api/v1/withings/login-url")       return await integrations.withingsLoginUrl(req, res, url);
        if (route === "/api/v1/settings")                 return await settings.get(req, res, url);
        if (route === "/api/v1/settings/background-image") return await settings.backgroundImage(req, res, url);
        if (route === "/api/v1/strava/status")            return await integrations.stravaStatus(req, res, url);
        if (route === "/api/v1/strava/login-url")         return await integrations.stravaLoginUrl(req, res, url);
        if (route === "/api/v1/strava/callback")          return await integrations.stravaCallback(req, res, url);
        if (route === "/api/v1/activities")               return await activities.list(req, res, url);
        if (route === "/api/v1/activities/count")         return await activities.count(req, res, url);
        if (route === "/api/v1/activities/trash")         return await activities.trash(req, res, url);
        if (route === "/api/v1/body-measurements/count")               return await body.count(req, res, url);
        if (route === "/api/v1/body-measurements/trash")               return await body.trash(req, res, url);
        if (route === "/api/v1/summary")                  return await trends.summary(req, res, url);
        if (route === "/api/v1/weekly")                   return await trends.weekly(req, res, url);
        if (route === "/api/v1/monthly")                  return await trends.monthly(req, res, url);
        if (route === "/api/v1/body-measurements")        return await body.list(req, res, url);
        if (route === "/api/v1/body-measurements/monthly")             return await body.monthly(req, res, url);
        if (route === "/api/v1/body-measurements/correlation")         return await body.correlation(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/track$/.test(route)) return await activities.track(req, res, url);
        if (/^\/api\/v1\/activities\/\d+$/.test(route))        return await activities.getById(req, res, url);
      }

      if (req.method === "DELETE") {
        if (route === "/api/v1/activities")               return await activities.deleteRange(req, res, url);
        if (/^\/api\/v1\/activities\/\d+$/.test(route))        return await activities.deleteById(req, res, url);
        if (route === "/api/v1/body-measurements")        return await body.deleteRange(req, res, url);
      }

      // Settings writes: one sub-resource per Settings card, each replaced in FULL
      // → PUT (idempotent), not PATCH. The Outlier-detection card → /settings/outliers
      // (three values) and the Overview & Trends card → /settings/thresholds (one
      // value) are separate paths — one card = one sub-resource; the four appearance
      // singletons each replace one value. There is deliberately NO write through the
      // parent /settings — a path claiming "all settings" that only touches a subset
      // is dishonest about scope (rest-api §1/§2, HRA-40).
      if (req.method === "PUT") {
        if (route === "/api/v1/settings/outliers")        return await settings.updateOutliers(req, res, url);
        if (route === "/api/v1/settings/thresholds")      return await settings.updateThresholds(req, res, url);
        if (route === "/api/v1/settings/theme")           return await settings.updateTheme(req, res, url);
        if (route === "/api/v1/settings/background")      return await settings.updateBackground(req, res, url);
        if (route === "/api/v1/settings/units")           return await settings.updateUnits(req, res, url);
        if (route === "/api/v1/settings/detail-view")     return await settings.updateDetailView(req, res, url);
        if (route === "/api/v1/settings/accent")          return await settings.updateAccent(req, res, url);
      }

      if (req.method === "POST") {
        if (route === "/api/v1/sync/garmin")              return await sync.garmin(req, res, url);
        if (route === "/api/v1/sync/withings")            return await sync.withings(req, res, url);
        if (route === "/api/v1/sync/strava")              return await sync.strava(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/classify$/.test(route)) return await activities.classify(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/feedback$/.test(route)) return await activities.feedback(req, res, url);
        if (route === "/api/v1/activities/confirm")       return await activities.confirm(req, res, url);
        if (route === "/api/v1/activities/restore" || route === "/api/v1/activities/purge") return await activities.restorePurge(req, res, url);
        if (route === "/api/v1/body-measurements/restore" || route === "/api/v1/body-measurements/purge") return await body.restorePurge(req, res, url);
        if (route === "/api/v1/settings/background/upload") return await settings.uploadBackground(req, res, url);
      }

      sendProblem(res, notFound(`No route matches ${req.method} ${route}.`).problem);
    } catch (e) {
      if (e instanceof ApiProblem) {
        // Attach the request path as `instance` unless the thrower set one.
        const p = e.problem;
        sendProblem(res, p.instance ? p : { ...p, instance: route });
        return;
      }
      // An unexpected error — log the real thing server-side, return a generic
      // 500 that never leaks the exception message/stack to the client.
      console.error("Unhandled API error:", e);
      sendProblem(res, internal().problem);
    }
  };
}
