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
import { loadConfig, getArg } from "./config.ts";
import { openDb, initSchema } from "./db.ts";
import { exchangeCode } from "./withings-auth.ts";
import { summarizeWorkout, type WorkoutTrackPoint } from "./workout-metrics.ts";
import { classifyWorkout } from "./ollama-service.ts";
import { classifyByStatistics } from "./stats-classifier.ts";
import { oauthState, oauthCallbackPage } from "./http/oauth.ts";
import { createApiHandler } from "./http/router.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const config = loadConfig();
const PORT   = parseInt(getArg("--port") ?? "3001");

const db = openDb();
initSchema(db);

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

// ── Appearance: theme + background image ────────────────────────────────
// Custom-uploaded backgrounds land here (gitignored, not committed). The
// upload handler best-effort deletes the previous custom file on replace —
// failure there (e.g. a transient file lock) is swallowed, not fatal, since
// a stray leftover image costs nothing on a personal local app.
const backgroundsDir = path.resolve(__dirname, "../backgrounds");
if (!fs.existsSync(backgroundsDir)) fs.mkdirSync(backgroundsDir, { recursive: true });

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

const withingsCallbackServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${WITHINGS_CALLBACK_PORT}`);
  if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }

  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  res.writeHead(200, { "Content-Type": "text/html" });

  if (!code || !state || state !== oauthState.withings) {
    res.end(oauthCallbackPage("✗ Authentication failed", "Missing or mismatched state — close this window and try logging in again from the dashboard.", false));
    return;
  }
  oauthState.withings = null;

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

// ── main API server ─────────────────────────────────────────────────────────
// The request handler now lives in http/router.ts; server.ts builds the
// dependency context (deps not yet extracted into repositories/services) and
// wires it to the http server. Behavior is byte-identical to the previous
// inline handler.
const server = http.createServer(createApiHandler({
  port: PORT, db, config, q, backgroundsDir,
  checkGarminDevice, streamSyncScript, runSyncScript, classifyActivity,
}));

server.listen(PORT, "127.0.0.1", () => {
  console.log("=== Garmin Stats — API Server ===\n");
  console.log(`Listening on http://127.0.0.1:${PORT}/api/`);
  console.log("\nCtrl+C to stop.");
});
