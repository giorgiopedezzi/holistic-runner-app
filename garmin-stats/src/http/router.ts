/**
 * http/router.ts
 * The routes layer: declares path + method and delegates to a controller. No
 * business logic, no data access — just matching + dispatch, plus the shared
 * cross-cutting concerns (CORS preflight, the URL parse, the top-level 404 and the
 * 500 catch). Controllers are built once from the AppContext (HRA-31).
 */
import http from "http";
import { URL } from "url";
import type { AppContext, Handler } from "./context.ts";
import { configureCors, send, sendProblem } from "./respond.ts";
import { ApiProblem, notFound, internal, unauthorized } from "./problem.ts";
import { demoGuarded } from "./demo-guard.ts";
import { authenticateRequest } from "./auth-context.ts";
import { logSecurityEvent } from "./security-log.ts";
import { createAuthController, expectedCsrfToken } from "../controllers/auth.controller.ts";
import { createAccountPrivacyController } from "../controllers/account-privacy.controller.ts";
import { createActivitiesController } from "../controllers/activities.controller.ts";
import { createTrendsController } from "../controllers/trends.controller.ts";
import { createBodyController } from "../controllers/body.controller.ts";
import { createSettingsController } from "../controllers/settings.controller.ts";
import { createSyncController } from "../controllers/sync.controller.ts";
import { createIntegrationsController } from "../controllers/integrations.controller.ts";
import { createDocsController } from "../controllers/docs.controller.ts";
import { createLocalesController } from "../controllers/locales.controller.ts";
import { createDateRangesController } from "../controllers/date-ranges.controller.ts";
import { createActivityTypesController } from "../controllers/activity-types.controller.ts";
import { createPlanTemplatesController } from "../controllers/plan-templates.controller.ts";
import { createFeedbackController } from "../controllers/feedback.controller.ts";
import { createSourceFilesController } from "../controllers/source-files.controller.ts";
import { createReportingController } from "../controllers/reporting.controller.ts";
import { createGuestPublicationController } from "../controllers/guest-publication.controller.ts";

export function createApiHandler(ctx: AppContext): http.RequestListener {
  const activities   = createActivitiesController(ctx);
  const trends       = createTrendsController(ctx);
  const body         = createBodyController(ctx);
  const settings     = createSettingsController(ctx);
  const sync         = createSyncController(ctx);
  const integrations = createIntegrationsController(ctx);
  const docs         = createDocsController(ctx);
  const dateRanges   = createDateRangesController(ctx);
  const activityTypes = createActivityTypesController(ctx);
  const planTemplates = createPlanTemplatesController(ctx);
  const locales      = createLocalesController(ctx);
  const feedback     = createFeedbackController(ctx);
  const sourceFiles  = createSourceFilesController(ctx);
  const reporting    = createReportingController(ctx);
  const auth         = createAuthController(ctx);
  const accountPrivacy = createAccountPrivacyController(ctx);
  const guestPublication = createGuestPublicationController(ctx);
  const { port } = ctx;
  // DEMO_MODE write gate (HRA-220) — one-line marker at each blocked route
  // below; see http/demo-guard.ts for the actual 403 behavior.
  const demo = <T extends Handler>(h: T) => demoGuarded(ctx, h);
  const ownerScopedRoute = (route: string) =>
    route === "/api/v1/range" || route === "/api/v1/summary" || route === "/api/v1/weekly" || route === "/api/v1/monthly" ||
    route === "/api/v1/reports/range" || route.startsWith("/api/v1/activities") || route.startsWith("/api/v1/body-measurements") ||
    route.startsWith("/api/v1/date-ranges") || route.startsWith("/api/v1/settings") || route.startsWith("/api/v1/plan-templates") ||
    route.startsWith("/api/v1/plan-instances") || route === "/api/v1/plan-instance-days" || route.startsWith("/api/v1/account") ||
    // HRA-352: provider connections/credentials and sync/import jobs are
    // owner-scoped — deliberately NOT /api/v1/strava/callback (its owner
    // comes from server-side OAuth state, not the request's own identity —
    // see controllers/integrations.controller.ts's doc comment).
    route === "/api/v1/withings/status" || route === "/api/v1/withings/login-url" || route === "/api/v1/withings/connection" ||
    route === "/api/v1/strava/status" || route === "/api/v1/strava/login-url" || route === "/api/v1/strava/connection" ||
    route.startsWith("/api/v1/sync/");

  return async (req, res) => {
    // Hosted demo — keep it out of search/AI indexing until it's ready to be
    // found. The dashboard has its own robots.txt/meta tag, but this API is
    // reachable on its own port too.
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noai, noimageai");
    // HRA-356 AC8: fixed production security headers on every response. This
    // is a pure JSON/binary API — default-src 'none' is safe everywhere
    // except the self-contained docs HTML page, which overrides CSP itself
    // (docs.controller.ts) to allow its own inline script/style.
    // Strict-Transport-Security is harmless to send over local http; browsers
    // only honor it once a request was actually made over https.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");

    const origin = req.headers.origin;
    const allowedOrigin = origin && ctx.config.auth.allowedOrigins.includes(origin) ? origin : undefined;
    if (ctx.config.auth.enabled && ctx.config.auth.allowedOrigins.length > 0) {
      if (origin && !allowedOrigin) { res.writeHead(403); res.end(); return; }
      configureCors(res, allowedOrigin ? {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, X-RunsFree-CSRF",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        Vary: "Origin",
      } : { Vary: "Origin" });
    }
    if (req.method === "OPTIONS") {
      if (ctx.config.auth.enabled && ctx.config.auth.allowedOrigins.length > 0 && origin && !allowedOrigin) { res.writeHead(403); res.end(); return; }
      res.writeHead(204, {
        ...(ctx.config.auth.enabled && ctx.config.auth.allowedOrigins.length > 0 && allowedOrigin ? {
          "Access-Control-Allow-Origin": allowedOrigin!, "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "Content-Type, X-RunsFree-CSRF",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", Vary: "Origin",
        } : { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" }),
      });
      res.end(); return;
    }

    const url   = new URL(req.url ?? "/", `http://0.0.0.0:${port}`);
    const route = url.pathname;
    const publicProfileMatch = /^\/api\/v1\/public\/profiles\/([^/]+)$/.exec(route);
    const publicCollectionMatch = /^\/api\/v1\/public\/profiles\/([^/]+)\/(activities|plans|reports)$/.exec(route);
    const publicResourceMatch = /^\/api\/v1\/public\/profiles\/([^/]+)\/(activities|plans|reports)\/([^/]+)$/.exec(route);

    try {
      const privateRoute = ownerScopedRoute(route) || route === "/api/v1/auth/session" || route === "/api/v1/auth/logout";
      if (privateRoute) {
        await authenticateRequest(req, ctx);
        if (!["GET", "HEAD"].includes(req.method ?? "")) {
          const sessionPart = (req.headers.cookie ?? "").split(";").map(part => part.trim()).find(part => part.startsWith("__Host-runsfree_session=") || part.startsWith("runsfree_session="));
          const session = sessionPart?.slice(sessionPart.indexOf("=") + 1);
          const csrf = req.headers["x-runsfree-csrf"];
          if (!session || typeof csrf !== "string" || csrf !== expectedCsrfToken(decodeURIComponent(session))) throw unauthorized();
          if (ctx.config.auth.allowedOrigins.length > 0 && origin !== allowedOrigin) throw unauthorized();
        }
      }
      if (req.method === "GET") {
        if (publicProfileMatch) return await guestPublication.profile(req, res, url, publicProfileMatch[1]!);
        if (publicCollectionMatch) return await guestPublication.collection(req, res, url, publicCollectionMatch[1]!, publicCollectionMatch[2] as "activities" | "plans" | "reports");
        if (publicResourceMatch) return await guestPublication.resource(req, res, url, publicResourceMatch[1]!, publicResourceMatch[2] as "activities" | "plans" | "reports", publicResourceMatch[3]!);
        if (route === "/api/v1/auth/login")               return await auth.login(req, res, url);
        if (route === "/api/v1/auth/callback")            return await auth.callback(req, res, url);
        if (route === "/api/v1/auth/session")             return await auth.session(req, res, url);
        if (/^\/api\/v1\/account\/exports\/[0-9a-f-]+$/.test(route)) return await accountPrivacy.downloadExport(req, res, url);
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
        if (route === "/api/v1/activities/races")         return await activities.races(req, res, url);
        if (route === "/api/v1/body-measurements/count")               return await body.count(req, res, url);
        if (route === "/api/v1/body-measurements/trash")               return await body.trash(req, res, url);
        if (route === "/api/v1/summary")                  return await trends.summary(req, res, url);
        if (route === "/api/v1/weekly")                   return await trends.weekly(req, res, url);
        if (route === "/api/v1/monthly")                  return await trends.monthly(req, res, url);
        if (route === "/api/v1/body-measurements")        return await body.list(req, res, url);
        if (route === "/api/v1/body-measurements/monthly")             return await body.monthly(req, res, url);
        if (route === "/api/v1/body-measurements/correlation")         return await body.correlation(req, res, url);
        if (route === "/api/v1/date-ranges")               return await dateRanges.list(req, res, url);
        if (route === "/api/v1/activity-types")            return await activityTypes.list(req, res, url);
        if (route === "/api/v1/plan-templates")             return await planTemplates.list(req, res, url);
        if (/^\/api\/v1\/plan-templates\/\d+$/.test(route))    return await planTemplates.getById(req, res, url);
        if (/^\/api\/v1\/plan-templates\/\d+\/mobile-eligibility$/.test(route)) return await planTemplates.mobileEligibility(req, res, url);
        if (route === "/api/v1/plan-instances")             return await planTemplates.listInstances(req, res, url);
        if (route === "/api/v1/plan-instances/active")      return await planTemplates.activeForDate(req, res, url);
        if (route === "/api/v1/plan-instance-days")         return await planTemplates.daysByDate(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/days\/\d+\/fit$/.test(route)) return await planTemplates.dayFit(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/fit$/.test(route)) return await planTemplates.scopeFit(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/reports\/workouts\/[^/]+$/.test(route)) return await reporting.getWorkoutReport(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/reports\/weeks$/.test(route)) return await reporting.getWeekReport(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/reports\/plan$/.test(route)) return await reporting.getPlanReport(req, res, url);
        if (route === "/api/v1/reports/range")               return await reporting.getRangeReport(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+$/.test(route))    return await planTemplates.instanceById(req, res, url);
        if (/^\/api\/v1\/locales\/[^/]+$/.test(route))     return await locales.get(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/track$/.test(route)) return await activities.track(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/association-candidates$/.test(route)) return await activities.associationCandidates(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/association$/.test(route)) return await activities.getAssociation(req, res, url);
        if (/^\/api\/v1\/activities\/\d+$/.test(route))        return await activities.getById(req, res, url);
      }

      if (req.method === "DELETE") {
        if (route === "/api/v1/activities")               return await demo(activities.deleteRange)(req, res, url);
        if (/^\/api\/v1\/activities\/\d+$/.test(route))        return await demo(activities.deleteById)(req, res, url);
        if (route === "/api/v1/body-measurements")        return await demo(body.deleteRange)(req, res, url);
        if (/^\/api\/v1\/date-ranges\/\d+$/.test(route))  return await demo(dateRanges.remove)(req, res, url);
        if (/^\/api\/v1\/plan-templates\/\d+$/.test(route))   return await demo(planTemplates.remove)(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+$/.test(route))   return await demo(planTemplates.removeInstance)(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/association$/.test(route)) return await demo(activities.clearAssociation)(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/reports\/workouts\/[^/]+\/quality-alignment\/\d+$/.test(route)) return await demo(reporting.removeQualityAlignment)(req, res, url);
        if (route === "/api/v1/withings/connection")      return await demo(integrations.withingsDisconnect)(req, res, url);
        if (route === "/api/v1/strava/connection")        return await demo(integrations.stravaDisconnect)(req, res, url);
      }

      // Settings writes: one sub-resource per Settings card, each replaced in FULL
      // → PUT (idempotent), not PATCH. The Outlier-detection card → /settings/outliers
      // (three values) and the Overview & Trends card → /settings/thresholds (one
      // value) are separate paths — one card = one sub-resource; the four appearance
      // singletons each replace one value. There is deliberately NO write through the
      // parent /settings — a path claiming "all settings" that only touches a subset
      // is dishonest about scope (rest-api §1/§2, HRA-40).
      if (req.method === "PUT") {
        if (route === "/api/v1/account/profile")          return await accountPrivacy.profile(req, res, url);
        if (route === "/api/v1/settings/outliers")        return await settings.updateOutliers(req, res, url);
        if (route === "/api/v1/settings/thresholds")      return await settings.updateThresholds(req, res, url);
        if (route === "/api/v1/settings/theme")           return await settings.updateTheme(req, res, url);
        if (route === "/api/v1/settings/background")      return await settings.updateBackground(req, res, url);
        if (route === "/api/v1/settings/units")           return await settings.updateUnits(req, res, url);
        if (route === "/api/v1/settings/timezone")        return await settings.updateTimezone(req, res, url);
        if (route === "/api/v1/settings/detail-view")     return await settings.updateDetailView(req, res, url);
        if (route === "/api/v1/settings/accent")          return await settings.updateAccent(req, res, url);
        if (route === "/api/v1/settings/date-format")     return await settings.updateDateFormat(req, res, url);
        if (route === "/api/v1/settings/language")        return await settings.updateLanguage(req, res, url);
        if (route === "/api/v1/settings/palette")         return await settings.updatePalette(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/type$/.test(route)) return await demo(activities.setType)(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/association$/.test(route)) return await demo(activities.setAssociation)(req, res, url);
        if (/^\/api\/v1\/date-ranges\/\d+$/.test(route))  return await dateRanges.update(req, res, url);
        if (/^\/api\/v1\/plan-templates\/\d+$/.test(route))   return await planTemplates.update(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/reports\/workouts\/[^/]+\/quality-alignment\/\d+$/.test(route)) return await demo(reporting.setQualityAlignment)(req, res, url);
      }

      if (req.method === "PATCH") {
        if (/^\/api\/v1\/plan-instances\/\d+\/days\/\d+$/.test(route)) return await demo(planTemplates.patchInstanceDay)(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+$/.test(route))   return await demo(planTemplates.patchInstance)(req, res, url);
      }

      if (req.method === "POST") {
        if (route === "/api/v1/auth/logout")               return await auth.logout(req, res, url);
        if (route === "/api/v1/account/sessions/revoke-others") return await accountPrivacy.revokeOthers(req, res, url);
        if (route === "/api/v1/account/exports")          return await accountPrivacy.createExport(req, res, url);
        if (route === "/api/v1/account/deletion-request") return await accountPrivacy.requestDeletion(req, res, url);
        if (route === "/api/v1/sync/garmin")              return await demo(sync.garmin)(req, res, url);
        if (route === "/api/v1/sync/withings")            return await demo(sync.withings)(req, res, url);
        if (route === "/api/v1/sync/strava")              return await demo(sync.strava)(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/classify$/.test(route)) return await demo(activities.classify)(req, res, url);
        if (/^\/api\/v1\/activities\/\d+\/feedback$/.test(route)) return await demo(activities.feedback)(req, res, url);
        if (route === "/api/v1/activities/confirm")       return await demo(activities.confirm)(req, res, url);
        if (route === "/api/v1/activities/restore" || route === "/api/v1/activities/purge") return await demo(activities.restorePurge)(req, res, url);
        if (route === "/api/v1/body-measurements/restore" || route === "/api/v1/body-measurements/purge") return await demo(body.restorePurge)(req, res, url);
        if (route === "/api/v1/settings/background/upload") return await settings.uploadBackground(req, res, url);
        if (route === "/api/v1/date-ranges")               return await dateRanges.create(req, res, url);
        if (route === "/api/v1/plan-templates/generate")    return await planTemplates.generate(req, res, url);
        if (route === "/api/v1/plan-templates/prompt-preview") return await planTemplates.composePromptPreview(req, res, url);
        if (route === "/api/v1/plan-templates/ai-generate")    return await demo(planTemplates.generateDsl)(req, res, url);
        if (route === "/api/v1/plan-templates")             return await planTemplates.create(req, res, url);
        if (/^\/api\/v1\/plan-templates\/\d+\/instantiate$/.test(route)) return await demo(planTemplates.instantiate)(req, res, url);
        if (/^\/api\/v1\/plan-templates\/\d+\/instantiate\/preview$/.test(route)) return await planTemplates.instantiatePreview(req, res, url);
        if (/^\/api\/v1\/plan-templates\/\d+\/approve$/.test(route))     return await demo(planTemplates.approveTemplate)(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/regenerate$/.test(route))  return await demo(planTemplates.regenerateInstance)(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/approve$/.test(route))     return await demo(planTemplates.approveInstance)(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/days\/\d+\/validate$/.test(route)) return await planTemplates.validateInstanceDay(req, res, url);
        if (/^\/api\/v1\/plan-instances\/\d+\/workouts\/swap$/.test(route))      return await demo(planTemplates.swapWorkouts)(req, res, url);
        // HRA-226: deliberately NOT wrapped in demo() — this is the one write
        // route DEMO_MODE must not block, since demo visitors are a primary
        // source of feedback submissions. Do not reflexively wrap this in
        // demo() later.
        if (route === "/api/v1/feedback")                  return await feedback.create(req, res, url);
        if (route === "/api/v1/source-files/extract")      return await sourceFiles.extract(req, res, url);
      }

      if (route.startsWith("/api/v1/public/")) {
        res.setHeader("Cache-Control", "no-store");
        sendProblem(res, notFound("Public resource is unavailable.", { instance: "/api/v1/public" }).problem);
        return;
      }
      sendProblem(res, notFound(`No route matches ${req.method} ${route}.`).problem);
    } catch (e) {
      if (e instanceof ApiProblem) {
        // Attach the request path as `instance` unless the thrower set one.
        const p = e.problem;
        sendProblem(res, p.instance ? p : { ...p, instance: route });
        return;
      }
      // An unexpected error — log a redacted summary server-side, return a
      // generic 500 that never leaks the exception message/stack to the
      // client. logSecurityEvent redacts token/session/code-shaped
      // substrings before the line is written (AC6).
      const publicFailure = route.startsWith("/api/v1/public/");
      logSecurityEvent("api.error.unhandled", publicFailure ? {
        route: "/api/v1/public/[redacted]",
        reason: "public_read_failed",
      } : {
        route,
        reason: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error && e.stack ? e.stack : undefined,
      });
      sendProblem(res, internal().problem);
    }
  };
}
