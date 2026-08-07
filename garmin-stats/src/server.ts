/**
 * server.ts
 * Local REST API — uses node:sqlite (Node 24 native).
 * Usage: node src/server.ts [-- --port 3001]
 */

import http from "http";
import path from "path";
import fs from "fs";
import { URL, fileURLToPath } from "url";
import { spawn } from "child_process";
import readline from "readline";
import { randomUUID } from "crypto";
import { loadConfig, getArg } from "./config.ts";
import { openDb, initSchema, type SettingsRow } from "./db.ts";
import { DatabaseSync } from "node:sqlite";
import { getAuthUrl, exchangeCode, getTokenStatus } from "./withings-auth.ts";
import { getAuthUrl as getStravaAuthUrl, exchangeCode as exchangeStravaCode, getTokenStatus as getStravaTokenStatus } from "./strava-auth.ts";
import { summarizeWorkout, type WorkoutTrackPoint } from "./workout-metrics.ts";
import { classifyWorkout, WORKOUT_CLASSIFICATIONS } from "./ollama-service.ts";
import { classifyByStatistics } from "./stats-classifier.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const config = loadConfig();
const PORT   = parseInt(getArg("--port") ?? "3001");

const db = openDb();
initSchema(db);

// ── query helpers ─────────────────────────────────────────────────────────
interface DateRange { from: string; to: string; }

function dateRange(params: URLSearchParams): DateRange {
  const today = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return { from: params.get("from") ?? ago30, to: params.get("to") ?? today };
}

const q = {
  range:       db.prepare("SELECT MIN(date_only) AS min_date, MAX(date_only) AS max_date FROM activities WHERE deleted_at IS NULL"),
  activities:  db.prepare("SELECT id,filename,activity_date,date_only,sport,duration_sec,moving_time_sec,distance_m,avg_pace_minkm,calories,avg_hr,max_hr,avg_cadence,ascent_m,descent_m,avg_speed_ms,max_speed_ms,source,ai_classification,ai_explanation,statistical_classification,statistical_explanation,user_feedback,user_correction_reason,final_classification,classification_method FROM activities WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY activity_date DESC"),
  activityById:db.prepare("SELECT id,filename,activity_date,date_only,sport,duration_sec,moving_time_sec,distance_m,avg_pace_minkm,calories,avg_hr,max_hr,avg_cadence,ascent_m,descent_m,avg_speed_ms,max_speed_ms,source,ai_classification,ai_explanation,statistical_classification,statistical_explanation,user_feedback,user_correction_reason,final_classification,classification_method FROM activities WHERE id = ? AND deleted_at IS NULL"),
  summary:     db.prepare("SELECT sport,COUNT(*) AS total_activities,ROUND(SUM(distance_m)/1000,2) AS total_km,ROUND(SUM(duration_sec)/3600,2) AS total_hours,SUM(calories) AS total_calories,ROUND(AVG(avg_hr)) AS avg_hr,ROUND(AVG(avg_pace_minkm),2) AS avg_pace,ROUND(SUM(ascent_m)) AS total_ascent FROM activities WHERE date_only BETWEEN ? AND ? AND sport IS NOT NULL AND deleted_at IS NULL GROUP BY sport ORDER BY total_km DESC"),
  weekly:      db.prepare("SELECT strftime('%Y-W%W',date_only) AS week,COUNT(*) AS runs,ROUND(SUM(distance_m)/1000,2) AS km,ROUND(AVG(avg_hr)) AS avg_hr,ROUND(AVG(avg_pace_minkm),2) AS avg_pace FROM activities WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY week ORDER BY week"),
  monthly:     db.prepare("SELECT strftime('%Y-%m',date_only) AS month,COUNT(*) AS runs,ROUND(SUM(distance_m)/1000,2) AS km,ROUND(AVG(avg_hr)) AS avg_hr,ROUND(AVG(avg_pace_minkm),2) AS avg_pace,ROUND(SUM(ascent_m)) AS ascent FROM activities WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY month ORDER BY month"),
  track:       db.prepare("SELECT elapsed_sec,timestamp_unix,distance_m,heart_rate,speed_ms,cadence,altitude_m,temperature,power FROM track_points WHERE activity_id=? ORDER BY COALESCE(elapsed_sec,distance_m) ASC"),

  // delete (soft) / trash / restore / purge
  deleteActivitiesRange: db.prepare("UPDATE activities SET deleted_at = datetime('now') WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL"),
  deleteActivityById:    db.prepare("UPDATE activities SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL"),
  countInRange:          db.prepare("SELECT COUNT(*) AS count FROM activities WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL"),
  activitiesTrash:       db.prepare("SELECT id,filename,date_only,sport,distance_m,source,deleted_at FROM activities WHERE deleted_at IS NOT NULL AND purged = 0 ORDER BY deleted_at DESC"),
  restoreActivityById:   db.prepare("UPDATE activities SET deleted_at = NULL WHERE id = ? AND purged = 0"),
  deleteTrackPointsByActivity: db.prepare("DELETE FROM track_points WHERE activity_id = ?"),
  // Purge (empty the trash): wipes track_points + every heavy/summary column
  // to actually reclaim space, but deliberately keeps filename (+ date/sport/
  // source, negligible size) — sync-garmin.ts's dedup check reads filenames
  // unconditionally, so keeping it is what stops a resync from reimporting
  // this activity. Never shown in the trash list again (purged=1) and can't
  // be restored.
  purgeActivityById: db.prepare(`
    UPDATE activities SET
      purged = 1, distance_m = NULL, avg_pace_minkm = NULL, calories = NULL,
      avg_hr = NULL, max_hr = NULL, avg_cadence = NULL, ascent_m = NULL,
      descent_m = NULL, avg_speed_ms = NULL, max_speed_ms = NULL,
      moving_time_sec = NULL, duration_sec = NULL
    WHERE id = ?
  `),

  // AI workout classifier + feedback. classifyUpdateAi/classifyUpdateStatistical
  // each write only their own method's pair of columns — running one never
  // touches the other's stored result, so both can be computed independently
  // and compared. Either always resets the four shared-verdict columns to
  // NULL — a fresh classification (first time or a reclassify, either
  // method) is always "pending review" again, old feedback doesn't carry
  // over. confirmActivityById is the bulk-equivalent of a thumbs-up with no
  // reason — it takes an explicit $source (the bulk UI's AI/Statistical
  // switch, same as bulk classify uses) rather than guessing/preferring one
  // slot, since a row can have both populated (classified with one method,
  // then reclassified with the other) and only the caller knows which one
  // the switch was on when "Confirm selected" was clicked.
  classifyUpdateAi: db.prepare(`
    UPDATE activities SET
      ai_classification = $classification, ai_explanation = $explanation,
      user_feedback = NULL, user_correction_reason = NULL, final_classification = NULL, classification_method = NULL
    WHERE id = $id
  `),
  classifyUpdateStatistical: db.prepare(`
    UPDATE activities SET
      statistical_classification = $classification, statistical_explanation = $explanation,
      user_feedback = NULL, user_correction_reason = NULL, final_classification = NULL, classification_method = NULL
    WHERE id = $id
  `),
  feedbackUpdate: db.prepare(`
    UPDATE activities SET
      user_feedback = $user_feedback, user_correction_reason = $user_correction_reason,
      final_classification = $final_classification, classification_method = $classification_method
    WHERE id = $id
  `),
  confirmActivityById: db.prepare(`
    UPDATE activities SET
      user_feedback = 'approved',
      final_classification = CASE WHEN $source = 'ai' THEN ai_classification ELSE statistical_classification END,
      classification_method = $source,
      user_correction_reason = NULL
    WHERE id = $id
      AND (CASE WHEN $source = 'ai' THEN ai_classification ELSE statistical_classification END) IS NOT NULL
  `),

  // withings
  bodyRange:   db.prepare("SELECT MIN(date_only) AS min_date, MAX(date_only) AS max_date FROM body_measurements WHERE deleted_at IS NULL"),
  bodyList:    db.prepare("SELECT measured_at,date_only,weight_kg,fat_ratio,fat_mass_kg,muscle_mass_kg,hydration_kg,bone_mass_kg,bmi,heart_rate FROM body_measurements WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY measured_at ASC"),
  bodyMonthly: db.prepare("SELECT strftime('%Y-%m',date_only) AS month,ROUND(AVG(weight_kg),2) AS avg_weight,ROUND(MIN(weight_kg),2) AS min_weight,ROUND(MAX(weight_kg),2) AS max_weight,ROUND(AVG(fat_ratio),1) AS avg_fat_ratio,ROUND(AVG(muscle_mass_kg),2) AS avg_muscle_mass FROM body_measurements WHERE date_only BETWEEN ? AND ? AND weight_kg IS NOT NULL AND deleted_at IS NULL GROUP BY month ORDER BY month"),
  bodyDeleteRange: db.prepare("UPDATE body_measurements SET deleted_at = datetime('now') WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL"),
  bodyCountInRange: db.prepare("SELECT COUNT(*) AS count FROM body_measurements WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL"),
  bodyTrash:        db.prepare("SELECT id,measured_at,date_only,weight_kg,deleted_at FROM body_measurements WHERE deleted_at IS NOT NULL AND purged = 0 ORDER BY deleted_at DESC"),
  restoreBodyById:  db.prepare("UPDATE body_measurements SET deleted_at = NULL WHERE id = ? AND purged = 0"),
  // Keeps measured_at (blocks sync-withings.ts's INSERT OR IGNORE from
  // resurrecting it) + date_only; wipes every actual measurement value.
  purgeBodyById: db.prepare(`
    UPDATE body_measurements SET
      purged = 1, weight_kg = NULL, fat_ratio = NULL, fat_mass_kg = NULL,
      muscle_mass_kg = NULL, hydration_kg = NULL, bone_mass_kg = NULL,
      bmi = NULL, heart_rate = NULL
    WHERE id = ?
  `),
  correlation: db.prepare("SELECT a.week,a.km,a.avg_hr,a.runs,ROUND(AVG(b.weight_kg),2) AS avg_weight,ROUND(AVG(b.fat_ratio),1) AS avg_fat_ratio FROM (SELECT strftime('%Y-W%W',date_only) AS week,ROUND(SUM(distance_m)/1000,2) AS km,ROUND(AVG(avg_hr)) AS avg_hr,COUNT(*) AS runs FROM activities WHERE date_only BETWEEN ? AND ? AND sport='running' AND deleted_at IS NULL GROUP BY week) a LEFT JOIN body_measurements b ON strftime('%Y-W%W',b.date_only)=a.week AND b.deleted_at IS NULL GROUP BY a.week ORDER BY a.week"),

  // settings
  settingsGet:    db.prepare("SELECT outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec, outlier_min_speed_kmh, theme, background_kind, background_value, unit_system, min_trend_group_size, activity_detail_view FROM settings WHERE id = 1"),
  settingsUpdate: db.prepare("UPDATE settings SET outlier_speed_delta_per_sec = $outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec = $outlier_cadence_delta_per_sec, outlier_min_speed_kmh = $outlier_min_speed_kmh, min_trend_group_size = $min_trend_group_size, updated_at = datetime('now') WHERE id = 1"),
  themeUpdate:      db.prepare("UPDATE settings SET theme = $theme, updated_at = datetime('now') WHERE id = 1"),
  backgroundUpdate: db.prepare("UPDATE settings SET background_kind = $background_kind, background_value = $background_value, updated_at = datetime('now') WHERE id = 1"),
  unitsUpdate:      db.prepare("UPDATE settings SET unit_system = $unit_system, updated_at = datetime('now') WHERE id = 1"),
  detailViewUpdate: db.prepare("UPDATE settings SET activity_detail_view = $activity_detail_view, updated_at = datetime('now') WHERE id = 1"),
};

// ── HTTP helpers ──────────────────────────────────────────────────────────
function send(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  res.end(body);
}

function sendNoContent(res: http.ServerResponse): void {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  res.end();
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => resolve(body));
  });
}

// For raw binary uploads (the background-image upload) — collecting Buffer
// chunks instead of concatenating as a string avoids corrupting binary data.
function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── Appearance: theme + background image ────────────────────────────────
// Custom-uploaded backgrounds land here (gitignored, not committed). The
// upload handler best-effort deletes the previous custom file on replace —
// failure there (e.g. a transient file lock) is swallowed, not fatal, since
// a stray leftover image costs nothing on a personal local app.
const backgroundsDir = path.resolve(__dirname, "../backgrounds");
if (!fs.existsSync(backgroundsDir)) fs.mkdirSync(backgroundsDir, { recursive: true });

// 'auto' is a valid stored value for both — it means "not explicitly chosen,
// resolve from the OS/browser at render time" (see useAppearance.ts on the
// frontend for the actual resolution; the backend just needs to accept and
// persist the literal string, never resolves it itself).
const THEME_NAMES = ["dark", "light", "dark-blue", "light-warm", "auto"];
const UNIT_SYSTEMS = ["metric", "imperial", "auto"];
const DETAIL_VIEWS = ["accordion", "modal"];
// Correction reasons for the thumbs-down flow — mirrors WORKOUT_CLASSIFICATIONS'
// pattern (also duplicated in garmin-dashboard's types/api.ts, no shared
// package between the two npm projects). "Other" is always allowed freeform
// on the classification side, but the reason itself is still one of these
// four fixed options, not freeform text.
const CORRECTION_REASONS = [
  "Warmup/cooldown skewed data",
  "Perception felt harder than numbers",
  "Traffic/Stops disrupted pace",
  "Other",
];
const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
};

// ── sync scripts ─────────────────────────────────────────────────────────
interface SyncResult { imported: number; skipped: number; errors: number }

function runSyncScript(scriptName: string, extraArgs: string[] = []): Promise<SyncResult> {
  const scriptPath = path.join(__dirname, scriptName);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, scriptPath, ...extraArgs], {
      cwd: process.cwd(),
    });

    let stdout = "";
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stdout += chunk);
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) {
        reject(new Error(`${scriptName} exited with code ${code}: ${stdout.slice(-1000)}`));
        return;
      }
      const imported = parseInt(stdout.match(/Imported\s*:\s*(\d+)/)?.[1] ?? "0");
      const skipped  = parseInt(stdout.match(/Skipped\s*:\s*(\d+)/)?.[1]  ?? "0");
      const errors   = parseInt(stdout.match(/Errors\s*:\s*(\d+)/)?.[1]   ?? "0");
      resolve({ imported, skipped, errors });
    });
  });
}

// Same spawn as runSyncScript, but relays sync-garmin.ts's "PROGRESS <phase>
// <current> <total> [<label>]" stdout lines to the client live as NDJSON
// instead of waiting for the whole run to finish, so the dashboard can show
// a real progress bar for the download and import phases.
const PROGRESS_LINE = /^PROGRESS (\w+) (\d+) (\d+)(?: (.*))?$/;

function streamSyncScript(res: http.ServerResponse, scriptName: string): void {
  const scriptPath = path.join(__dirname, scriptName);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Cache-Control": "no-cache",
  });

  const send = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`);

  const child = spawn(process.execPath, [...process.execArgv, scriptPath], {
    cwd: process.cwd(),
  });

  let logTail = "";
  let stderrBuf = "";

  readline.createInterface({ input: child.stdout }).on("line", line => {
    logTail += `${line}\n`;
    const m = line.match(PROGRESS_LINE);
    if (m) send({ type: "progress", phase: m[1], current: Number(m[2]), total: Number(m[3]), label: m[4] });
  });
  child.stderr.on("data", chunk => stderrBuf += chunk);

  child.on("error", err => {
    send({ type: "error", message: err.message });
    res.end();
  });

  child.on("close", code => {
    if (code !== 0) {
      send({ type: "error", message: `${scriptName} exited with code ${code}: ${(stderrBuf || logTail).slice(-1000)}` });
      res.end();
      return;
    }
    const imported = parseInt(logTail.match(/Imported\s*:\s*(\d+)/)?.[1] ?? "0");
    const skipped  = parseInt(logTail.match(/Skipped\s*:\s*(\d+)/)?.[1]  ?? "0");
    const errors   = parseInt(logTail.match(/Errors\s*:\s*(\d+)/)?.[1]   ?? "0");
    send({ type: "done", imported, skipped, errors });
    res.end();
  });
}

// ── Garmin device check ──────────────────────────────────────────────────
// Cheap presence check for the "Sync from device" button: walks the same MTP
// shell path the sync bridge uses but never copies anything, so it's fast.
// Same non-inherited, timed-out spawn pattern as the sync scripts — this COM
// automation can hang without a real console attached.
interface DeviceStatus { connected: boolean; reason?: string; name?: string; }

function checkGarminDevice(): Promise<DeviceStatus> {
  const scriptPath = path.join(__dirname, "check-garmin-device.ps1");
  return new Promise(resolve => {
    // No -DeviceName: auto-detect by protocol (MTP vs filesystem) instead of
    // requiring an exact name match, which is what actually connects/plugs
    // in — Windows' reported device name isn't always what's in config.json.
    const child = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    child.stdout.on("data", chunk => out += chunk);

    const timer = setTimeout(() => {
      child.kill();
      resolve({ connected: false, reason: "timeout" });
    }, 15_000);

    child.on("error", () => { clearTimeout(timer); resolve({ connected: false, reason: "powershell_error" }); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim().split("\n").pop() ?? "{}") as DeviceStatus);
      } catch {
        resolve({ connected: false, reason: "parse_error" });
      }
    });
  });
}

// ── Withings OAuth callback ─────────────────────────────────────────────
// Always-on (whenever server.ts is running) so the dashboard's "Login to
// Withings" button can open a real popup straight at Withings' login page —
// no per-attempt spawn/browser-open dance. Don't run `npm run auth:withings`
// at the same time as the app server: both bind this same port.
const WITHINGS_CALLBACK_PORT = 3002;
let pendingWithingsState: string | null = null;

// Strava's OAuth callback lives on the main router below (not a second
// permanent port) — Strava only validates the redirect's *domain* against
// what's registered in its API app settings ("localhost"), not an exact
// URL, so there's no need for a fixed separate port the way Withings
// requires matching http://localhost:3002/callback exactly.
let pendingStravaState: string | null = null;

function oauthCallbackPage(title: string, message: string, autoClose: boolean): string {
  return `<html><body style="font-family:sans-serif;padding:2rem"><h2>${title}</h2><p>${message}</p></body>${autoClose ? "<script>window.close()</script>" : ""}</html>`;
}

const withingsCallbackServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${WITHINGS_CALLBACK_PORT}`);
  if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }

  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  res.writeHead(200, { "Content-Type": "text/html" });

  if (!code || !state || state !== pendingWithingsState) {
    res.end(oauthCallbackPage("✗ Authentication failed", "Missing or mismatched state — close this window and try logging in again from the dashboard.", false));
    return;
  }
  pendingWithingsState = null;

  try {
    await exchangeCode(config, db, code);
    res.end(oauthCallbackPage("✓ Authenticated!", "This window will close automatically.", true));
  } catch (e) {
    res.end(oauthCallbackPage("✗ Authentication failed", e instanceof Error ? e.message : String(e), false));
  }
});

withingsCallbackServer.on("error", err => {
  console.error(`⚠ Withings OAuth callback server failed to start on port ${WITHINGS_CALLBACK_PORT}: ${err.message}`);
  console.error("  \"Login to Withings\" won't work until this is resolved (another process on that port? e.g. `npm run auth:withings` running separately).");
});

withingsCallbackServer.listen(WITHINGS_CALLBACK_PORT, "127.0.0.1");

// ── Workout classifier ────────────────────────────────────────────────────
// Shared by the single-activity classify route (and looped by the frontend
// for bulk — see ManageTab.tsx's note on why there's no bulk route). Never
// called from a sync script — classification is strictly on-demand, so a
// slow/down Ollama can never block or slow down a sync (see
// ollama-service.ts's header comment). Two independent methods: 'ai'
// (ollama-service.ts, a local LLM) and 'statistical' (stats-classifier.ts,
// deterministic rules over the same summary numbers, no LLM/network call —
// instant, and works even if Ollama isn't running).
interface ActivityForClassify {
  sport: string | null;
  distance_m: number | null;
  duration_sec: number | null;
  avg_hr: number | null;
}

type ClassificationMethod = "ai" | "statistical";

async function classifyActivity(id: number, splitMeters: number, method: ClassificationMethod): Promise<void> {
  const activity = q.activityById.get(id) as unknown as ActivityForClassify | undefined;
  if (!activity) throw new Error(`Activity ${id} not found`);
  const points = q.track.all(id) as unknown as WorkoutTrackPoint[];
  const summary = summarizeWorkout(activity, points, { splitMeters });
  if (method === "statistical") {
    const result = classifyByStatistics(summary);
    q.classifyUpdateStatistical.run({ $id: id, $classification: result.classification, $explanation: result.explanation });
  } else {
    const result = await classifyWorkout(summary);
    q.classifyUpdateAi.run({ $id: id, $classification: result.classification, $explanation: result.explanation });
  }
}

// ── router ────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    });
    res.end(); return;
  }

  const parsed = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
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
        pendingWithingsState = randomUUID();
        return send(res, { url: getAuthUrl(config, pendingWithingsState) });
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
        pendingStravaState = randomUUID();
        return send(res, { url: getStravaAuthUrl(config, pendingStravaState) });
      }
      if (route === "/api/strava/callback") {
        const code  = p.get("code");
        const state = p.get("state");
        res.writeHead(200, { "Content-Type": "text/html" });
        if (!code || !state || state !== pendingStravaState) {
          res.end(oauthCallbackPage("✗ Authentication failed", "Missing or mismatched state — close this window and try logging in again from the dashboard.", false));
          return;
        }
        pendingStravaState = null;
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
      // Works identically for a first classification or a reclassify (see
      // classifyActivity / classifyUpdateAi / classifyUpdateStatistical
      // above — either resets the shared verdict to pending). method
      // defaults to 'ai' (unchanged behavior for existing callers), though
      // the detail view's two separate buttons always pass it explicitly
      // now. A single Ollama failure here surfaces as a clean 500 via the
      // router's own catch block (ollama-service.ts already throws a
      // readable "Ollama not reachable..." message, not a raw stack trace) —
      // 'statistical' never touches the network, so it can't fail this way.
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

      // No bulk /api/activities/classify route — the Data & Sync bulk
      // classify UI loops POST /api/activity/:id/classify sequentially from
      // the frontend instead (see ManageTab.tsx's ClassifySection), since it
      // needs real per-item "Classifying N/M…" progress; a single
      // request/response bulk endpoint can't report progress mid-flight
      // without NDJSON streaming (like streamSyncScript), which is more
      // machinery than this needs. /api/activities/confirm below stays a
      // real bulk endpoint since it's fast/DB-only with nothing to show
      // progress for.

      // POST /api/activity/:id/feedback — body
      // { feedback: 'approved'|'rejected', source: 'ai'|'statistical', correctionReason?, finalClassification? }.
      // source identifies which of the two independently-stored results
      // (ai_classification or statistical_classification) this feedback is
      // about — there's exactly one shared verdict per activity (see db.ts),
      // so thumbs-up on either card makes *that* card's result the
      // activity's confirmed classification. 'approved' sets
      // final_classification = the current value of that source's
      // classification column (400 if it's not classified yet); 'rejected'
      // requires both a known correctionReason and a known
      // finalClassification (the user's corrected pick, independent of
      // either card's actual result). classification_method records which
      // card the feedback was given from either way.
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
      // reason needed. Body { ids, method? } — method is 'ai'|'statistical'
      // (defaults to 'ai'), identifying which slot to confirm from, same as
      // classify's method field. Fast, DB-only (no Ollama call), so unlike
      // bulk classify above this follows the trash restore/purge shape
      // exactly: looped single-row updates inside one transaction.
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
      // Deliberately not multipart/form-data: this app has zero runtime
      // dependencies beyond typescript/@types/node, and a raw-body upload
      // needs no parser at all — the frontend just does
      // `fetch(url, { method: "POST", body: file })`.
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
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("=== Garmin Stats — API Server ===\n");
  console.log(`Listening on http://127.0.0.1:${PORT}/api/`);
  console.log("\nCtrl+C to stop.");
});
