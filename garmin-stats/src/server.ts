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
import { createActivitiesRepo } from "./repositories/activities.repo.ts";
import { createBodyRepo } from "./repositories/body.repo.ts";
import { createSettingsRepo } from "./repositories/settings.repo.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const config = loadConfig();
const PORT   = parseInt(getArg("--port") ?? "3001");

const db = openDb();
initSchema(db);

// ── repositories (data-access layer — the only layer that runs SQL) ─────────
const activitiesRepo = createActivitiesRepo(db);
const bodyRepo       = createBodyRepo(db);
const settingsRepo   = createSettingsRepo(db);

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
  const activity = activitiesRepo.byId(id) as unknown as ActivityForClassify | undefined;
  if (!activity) throw new Error(`Activity ${id} not found`);
  const points = activitiesRepo.track(id) as unknown as WorkoutTrackPoint[];
  const summary = summarizeWorkout(activity, points, { splitMeters });
  if (method === "statistical") {
    const result = classifyByStatistics(summary);
    activitiesRepo.updateStatisticalClassification({ $id: id, $classification: result.classification, $explanation: result.explanation });
  } else {
    const result = await classifyWorkout(summary);
    activitiesRepo.updateAiClassification({ $id: id, $classification: result.classification, $explanation: result.explanation });
  }
}

// ── main API server ─────────────────────────────────────────────────────────
// The request handler now lives in http/router.ts; server.ts builds the
// dependency context (deps not yet extracted into repositories/services) and
// wires it to the http server. Behavior is byte-identical to the previous
// inline handler.
const server = http.createServer(createApiHandler({
  port: PORT, db, config, backgroundsDir,
  repos: { activities: activitiesRepo, body: bodyRepo, settings: settingsRepo },
  checkGarminDevice, streamSyncScript, runSyncScript, classifyActivity,
}));

server.listen(PORT, "127.0.0.1", () => {
  console.log("=== Garmin Stats — API Server ===\n");
  console.log(`Listening on http://127.0.0.1:${PORT}/api/`);
  console.log("\nCtrl+C to stop.");
});
