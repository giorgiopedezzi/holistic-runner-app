/**
 * http/router.ts
 * The main API request handler, extracted verbatim from server.ts (S1 refactor).
 * It still contains the full inline per-method dispatch — repositories, services,
 * and per-resource controllers are pulled out of here in the following stories.
 * server.ts builds the ApiContext (deps that still live there for now) and wires
 * this handler to the http server. Behavior is byte-identical.
 */
import http from "http";
import path from "path";
import fs from "fs";
import { URL } from "url";
import { randomUUID } from "crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Config } from "../config.ts";
import type { SettingsRow } from "../db.ts";
import { send, sendNoContent } from "./respond.ts";
import { dateRange, readBody, readBodyBuffer } from "./request.ts";
import { oauthState, oauthCallbackPage } from "./oauth.ts";
import { getAuthUrl, getTokenStatus } from "../withings-auth.ts";
import { getAuthUrl as getStravaAuthUrl, exchangeCode as exchangeStravaCode, getTokenStatus as getStravaTokenStatus } from "../strava-auth.ts";
import { WORKOUT_CLASSIFICATIONS } from "../ollama-service.ts";

// 'auto' is a valid stored value for theme/units — it means "resolve from the
// OS/browser at render time" (see useAppearance.ts); the backend just persists
// the literal string.
const THEME_NAMES = ["dark", "light", "dark-blue", "light-warm", "auto"];
const UNIT_SYSTEMS = ["metric", "imperial", "auto"];
const DETAIL_VIEWS = ["accordion", "modal"];
// Correction reasons for the thumbs-down flow (also duplicated in the
// dashboard's types/api.ts — no shared package between the two npm projects).
const CORRECTION_REASONS = [
  "Warmup/cooldown skewed data",
  "Perception felt harder than numbers",
  "Traffic/Stops disrupted pace",
  "Other",
];
const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
};

// Dependencies that still live in server.ts for now (moved into repositories /
// services in later stories). Passing them in keeps this handler a pure
// function of its context — no module-level singletons of its own.
export interface ApiContext {
  port: number;
  db: DatabaseSync;
  config: Config;
  q: Record<string, StatementSync>;
  backgroundsDir: string;
  checkGarminDevice: () => Promise<unknown>;
  streamSyncScript: (res: http.ServerResponse, scriptName: string) => void;
  runSyncScript: (scriptName: string, extraArgs?: string[]) => Promise<unknown>;
  classifyActivity: (id: number, splitMeters: number, method: "ai" | "statistical") => Promise<void>;
}

export function createApiHandler(ctx: ApiContext): http.RequestListener {
  const { port, db, config, q, backgroundsDir, checkGarminDevice, streamSyncScript, runSyncScript, classifyActivity } = ctx;

  return async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      });
      res.end(); return;
    }

    const parsed = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const route  = parsed.pathname;
    const p      = parsed.searchParams;

    try {
      // ── GET Garmin ────────────────────────────────────────────────────────
      if (req.method === "GET") {
        if (route === "/api/range")            return send(res, q.range.get());
        if (route === "/api/body/range")       return send(res, q.bodyRange.get());
        if (route === "/api/garmin/status")    return send(res, await checkGarminDevice());
        if (route === "/api/withings/status")  return send(res, await getTokenStatus(config, db));
        if (route === "/api/withings/login-url") {
          oauthState.withings = randomUUID();
          return send(res, { url: getAuthUrl(config, oauthState.withings) });
        }
        if (route === "/api/settings")         return send(res, q.settingsGet.get());
        if (route === "/api/settings/background-image") {
          const row = q.settingsGet.get() as unknown as SettingsRow;
          if (row.background_kind !== "custom" || !row.background_value) return send(res, { error: "No custom background set" }, 404);
          const filePath = path.join(backgroundsDir, row.background_value);
          if (!fs.existsSync(filePath)) return send(res, { error: "Background file missing" }, 404);
          const ext = path.extname(filePath).slice(1).toLowerCase();
          res.writeHead(200, {
            "Content-Type": IMAGE_EXT_MIME[ext] ?? "application/octet-stream",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        if (route === "/api/strava/status")    return send(res, await getStravaTokenStatus(config, db));
        if (route === "/api/strava/login-url") {
          oauthState.strava = randomUUID();
          return send(res, { url: getStravaAuthUrl(config, oauthState.strava) });
        }
        if (route === "/api/strava/callback") {
          const code  = p.get("code");
          const state = p.get("state");
          res.writeHead(200, { "Content-Type": "text/html" });
          if (!code || !state || state !== oauthState.strava) {
            res.end(oauthCallbackPage("✗ Authentication failed", "Missing or mismatched state — close this window and try logging in again from the dashboard.", false));
            return;
          }
          oauthState.strava = null;
          try {
            await exchangeStravaCode(config, db, code);
            res.end(oauthCallbackPage("✓ Authenticated!", "This window will close automatically.", true));
          } catch (e) {
            res.end(oauthCallbackPage("✗ Authentication failed", e instanceof Error ? e.message : String(e), false));
          }
          return;
        }

        const { from, to } = dateRange(p);

        if (route === "/api/activities")       return send(res, q.activities.all(from, to));
        if (route === "/api/activities/count") return send(res, q.countInRange.get(from, to));
        if (route === "/api/activities/trash") return send(res, q.activitiesTrash.all());
        if (route === "/api/body/count")       return send(res, q.bodyCountInRange.get(from, to));
        if (route === "/api/body/trash")       return send(res, q.bodyTrash.all());
        if (route === "/api/summary")          return send(res, q.summary.all(from, to));
        if (route === "/api/weekly")           return send(res, q.weekly.all(from, to));
        if (route === "/api/monthly")          return send(res, q.monthly.all(from, to));
        if (route === "/api/body/list")        return send(res, q.bodyList.all(from, to));
        if (route === "/api/body/monthly")     return send(res, q.bodyMonthly.all(from, to));
        if (route === "/api/body/correlation") {
          const rows = q.correlation.all(from, to) as { avg_weight: number | null }[];
          // Matches the threshold the chart itself needs to be worth showing:
          // more than one week, with at least one of them having a body match.
          const hasData = rows.length > 1 && rows.some(r => r.avg_weight != null);
          if (!hasData) { sendNoContent(res); return; }
          return send(res, rows);
        }

        if (route.startsWith("/api/track/")) {
          const id = parseInt(route.split("/").pop() ?? "");
          if (isNaN(id)) return send(res, { error: "Invalid ID" }, 400);
          return send(res, q.track.all(id));
        }

        if (route.startsWith("/api/activity/")) {
          const id = parseInt(route.split("/").pop() ?? "");
          if (isNaN(id)) return send(res, { error: "Invalid ID" }, 400);
          return send(res, q.activityById.get(id));
        }
      }

      // ── DELETE ────────────────────────────────────────────────────────────
      // Soft delete only — these set deleted_at rather than removing rows, so
      // the item lands in the trash (GET /api/activities/trash, /api/body/trash)
      // and can be restored (POST .../restore) or permanently purged
      // (POST .../purge). Filenames/measured_at survive a purge specifically so
      // a resync can't silently bring a deliberately-deleted item back.
      if (req.method === "DELETE") {
        const { from, to } = dateRange(p);

        // DELETE /api/activities?from=...&to=...
        if (route === "/api/activities") {
          const count = (q.countInRange.get(from, to) as { count: number }).count;
          db.exec("BEGIN");
          try {
            q.deleteActivitiesRange.run(from, to);
            db.exec("COMMIT");
          } catch (e) { db.exec("ROLLBACK"); throw e; }
          return send(res, { deleted: count, from, to });
        }

        // DELETE /api/activity/:id
        if (route.startsWith("/api/activity/")) {
          const id = parseInt(route.split("/").pop() ?? "");
          if (isNaN(id)) return send(res, { error: "Invalid ID" }, 400);
          q.deleteActivityById.run(id);
          return send(res, { deleted: id });
        }

        // DELETE /api/body?from=...&to=...
        if (route === "/api/body") {
          const count = (q.bodyCountInRange.get(from, to) as { count: number }).count;
          db.exec("BEGIN");
          try {
            q.bodyDeleteRange.run(from, to);
            db.exec("COMMIT");
          } catch (e) { db.exec("ROLLBACK"); throw e; }
          return send(res, { deleted: count, from, to });
        }
      }

      // ── PUT ───────────────────────────────────────────────────────────────
      if (req.method === "PUT") {
        if (route === "/api/settings") {
          const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
          const speedDelta = Number(body.outlier_speed_delta_per_sec);
          const cadenceDelta = Number(body.outlier_cadence_delta_per_sec);
          const minSpeedKmh = Number(body.outlier_min_speed_kmh);
          const minTrendGroupSize = Number(body.min_trend_group_size);
          if (!Number.isFinite(speedDelta) || speedDelta <= 0 || !Number.isFinite(cadenceDelta) || cadenceDelta <= 0 || !Number.isFinite(minSpeedKmh) || minSpeedKmh < 0) {
            return send(res, { error: "outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec and outlier_min_speed_kmh must be positive numbers (outlier_min_speed_kmh may be 0)" }, 400);
          }
          if (!Number.isInteger(minTrendGroupSize) || minTrendGroupSize < 2) {
            return send(res, { error: "min_trend_group_size must be an integer of at least 2" }, 400);
          }
          q.settingsUpdate.run({ $outlier_speed_delta_per_sec: speedDelta, $outlier_cadence_delta_per_sec: cadenceDelta, $outlier_min_speed_kmh: minSpeedKmh, $min_trend_group_size: minTrendGroupSize });
          return send(res, q.settingsGet.get());
        }

        if (route === "/api/settings/theme") {
          const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
          if (!body.theme || !THEME_NAMES.includes(body.theme)) {
            return send(res, { error: `theme must be one of: ${THEME_NAMES.join(", ")}` }, 400);
          }
          q.themeUpdate.run({ $theme: body.theme });
          return send(res, q.settingsGet.get());
        }

        // PUT /api/settings/background — selects a bundled preset, or clears
        // back to "none". Uploading a custom image is a separate POST (below)
        // since it carries a binary body, not JSON.
        if (route === "/api/settings/background") {
          const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
          if (body.background_kind !== "none" && body.background_kind !== "bundled") {
            return send(res, { error: "background_kind must be 'none' or 'bundled' (use POST /api/settings/background/upload for custom images)" }, 400);
          }
          if (body.background_kind === "bundled" && !body.background_value) {
            return send(res, { error: "background_value (preset id) is required when background_kind is 'bundled'" }, 400);
          }
          q.backgroundUpdate.run({
            $background_kind: body.background_kind,
            $background_value: body.background_kind === "bundled" ? (body.background_value ?? null) : null,
          });
          return send(res, q.settingsGet.get());
        }

        if (route === "/api/settings/units") {
          const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
          if (!body.unit_system || !UNIT_SYSTEMS.includes(body.unit_system)) {
            return send(res, { error: `unit_system must be one of: ${UNIT_SYSTEMS.join(", ")}` }, 400);
          }
          q.unitsUpdate.run({ $unit_system: body.unit_system });
          return send(res, q.settingsGet.get());
        }

        if (route === "/api/settings/detail-view") {
          const body = JSON.parse((await readBody(req)) || "{}") as Partial<SettingsRow>;
          if (!body.activity_detail_view || !DETAIL_VIEWS.includes(body.activity_detail_view)) {
            return send(res, { error: `activity_detail_view must be one of: ${DETAIL_VIEWS.join(", ")}` }, 400);
          }
          q.detailViewUpdate.run({ $activity_detail_view: body.activity_detail_view });
          return send(res, q.settingsGet.get());
        }
      }

      // ── POST ──────────────────────────────────────────────────────────────
      if (req.method === "POST") {
        if (route === "/api/sync/garmin")   { streamSyncScript(res, "sync-garmin.ts"); return; }
        if (route === "/api/sync/withings") {
          const args: string[] = [];
          const wFrom = p.get("from");
          const wTo   = p.get("to");
          if (wFrom) args.push("--from", wFrom);
          if (wTo)   args.push("--to", wTo);
          return send(res, await runSyncScript("sync-withings.ts", args));
        }
        if (route === "/api/sync/strava") {
          const args: string[] = [];
          const sFrom = p.get("from");
          const sTo   = p.get("to");
          if (sFrom) args.push("--from", sFrom);
          if (sTo)   args.push("--to", sTo);
          return send(res, await runSyncScript("sync-strava.ts", args));
        }

        // POST /api/activity/:id/classify — body { splitMeters?: number, method?: 'ai'|'statistical' }.
        {
          const classifyMatch = route.match(/^\/api\/activity\/(\d+)\/classify$/);
          if (classifyMatch) {
            const id = parseInt(classifyMatch[1]);
            const body = JSON.parse((await readBody(req)) || "{}") as { splitMeters?: unknown; method?: unknown };
            const splitMeters = body.splitMeters != null ? Number(body.splitMeters) : 1000;
            if (!Number.isFinite(splitMeters) || splitMeters <= 0) {
              return send(res, { error: "splitMeters must be a positive number" }, 400);
            }
            const method = body.method ?? "ai";
            if (method !== "ai" && method !== "statistical") {
              return send(res, { error: "method must be 'ai' or 'statistical'" }, 400);
            }
            await classifyActivity(id, splitMeters, method);
            return send(res, q.activityById.get(id));
          }
        }

        // POST /api/activity/:id/feedback — body
        // { feedback: 'approved'|'rejected', source: 'ai'|'statistical', correctionReason?, finalClassification? }.
        {
          const feedbackMatch = route.match(/^\/api\/activity\/(\d+)\/feedback$/);
          if (feedbackMatch) {
            const id = parseInt(feedbackMatch[1]);
            const body = JSON.parse((await readBody(req)) || "{}") as {
              feedback?: unknown; source?: unknown; correctionReason?: unknown; finalClassification?: unknown;
            };
            if (body.feedback !== "approved" && body.feedback !== "rejected") {
              return send(res, { error: "feedback must be 'approved' or 'rejected'" }, 400);
            }
            if (body.source !== "ai" && body.source !== "statistical") {
              return send(res, { error: "source must be 'ai' or 'statistical'" }, 400);
            }
            const current = q.activityById.get(id) as unknown as
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
            q.feedbackUpdate.run({
              $id: id, $user_feedback: body.feedback, $user_correction_reason: correctionReason,
              $final_classification: finalClassification, $classification_method: body.source,
            });
            return send(res, q.activityById.get(id));
          }
        }

        // POST /api/activities/confirm — bulk-equivalent of thumbs-up, no
        // reason needed. Body { ids, method? }.
        if (route === "/api/activities/confirm") {
          const body = JSON.parse((await readBody(req)) || "{}") as { ids?: unknown; method?: unknown };
          const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
          if (ids.length === 0) return send(res, { error: "ids must be a non-empty array of integers" }, 400);
          const method = body.method ?? "ai";
          if (method !== "ai" && method !== "statistical") {
            return send(res, { error: "method must be 'ai' or 'statistical'" }, 400);
          }
          db.exec("BEGIN");
          try {
            for (const id of ids) q.confirmActivityById.run({ $id: id, $source: method });
            db.exec("COMMIT");
          } catch (e) { db.exec("ROLLBACK"); throw e; }
          return send(res, { confirmed: ids.length });
        }

        // Trash actions — body is always {ids: number[]}. Looping single-row
        // prepared statements inside one transaction, rather than building a
        // dynamic "IN (...)" clause, keeps every bound value a real parameter.
        if (route === "/api/activities/restore" || route === "/api/activities/purge") {
          const body = JSON.parse((await readBody(req)) || "{}") as { ids?: unknown };
          const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
          if (ids.length === 0) return send(res, { error: "ids must be a non-empty array of integers" }, 400);
          const purge = route.endsWith("/purge");
          db.exec("BEGIN");
          try {
            for (const id of ids) {
              if (purge) { q.deleteTrackPointsByActivity.run(id); q.purgeActivityById.run(id); }
              else q.restoreActivityById.run(id);
            }
            db.exec("COMMIT");
          } catch (e) { db.exec("ROLLBACK"); throw e; }
          return send(res, { [purge ? "purged" : "restored"]: ids.length });
        }

        if (route === "/api/body/restore" || route === "/api/body/purge") {
          const body = JSON.parse((await readBody(req)) || "{}") as { ids?: unknown };
          const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
          if (ids.length === 0) return send(res, { error: "ids must be a non-empty array of integers" }, 400);
          const purge = route.endsWith("/purge");
          db.exec("BEGIN");
          try {
            for (const id of ids) {
              if (purge) q.purgeBodyById.run(id);
              else q.restoreBodyById.run(id);
            }
            db.exec("COMMIT");
          } catch (e) { db.exec("ROLLBACK"); throw e; }
          return send(res, { [purge ? "purged" : "restored"]: ids.length });
        }

        // POST /api/settings/background/upload?ext=jpg — raw image bytes as
        // the body (Content-Type set to the image's mime type by the caller).
        if (route === "/api/settings/background/upload") {
          const ext = (p.get("ext") ?? "").toLowerCase();
          if (!IMAGE_EXT_MIME[ext]) {
            return send(res, { error: `ext must be one of: ${Object.keys(IMAGE_EXT_MIME).join(", ")}` }, 400);
          }
          const buf = await readBodyBuffer(req);
          if (buf.length === 0) return send(res, { error: "Empty upload" }, 400);
          if (buf.length > 10 * 1024 * 1024) return send(res, { error: "Image too large (max 10MB)" }, 400);

          const prev = q.settingsGet.get() as unknown as SettingsRow;
          const filename = `bg-${Date.now()}.${ext}`;
          fs.writeFileSync(path.join(backgroundsDir, filename), buf);
          if (prev.background_kind === "custom" && prev.background_value) {
            try { fs.unlinkSync(path.join(backgroundsDir, prev.background_value)); } catch { /* already gone, fine */ }
          }
          q.backgroundUpdate.run({ $background_kind: "custom", $background_value: filename });
          return send(res, q.settingsGet.get());
        }
      }

      send(res, { error: "Not found" }, 404);
    } catch (e) {
      send(res, { error: e instanceof Error ? e.message : String(e) }, 500);
    }
  };
}
