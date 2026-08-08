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
import { oauthState, oauthCallbackPage } from "./http/oauth.ts";
import { createApiHandler } from "./http/router.ts";
import { createActivitiesRepo } from "./repositories/activities.repo.ts";
import { createBodyRepo } from "./repositories/body.repo.ts";
import { createSettingsRepo } from "./repositories/settings.repo.ts";
import { createActivitiesService } from "./services/activities.service.ts";
import { createBodyService } from "./services/body.service.ts";
import { createClassificationService } from "./services/classification.service.ts";
import { createSyncService } from "./services/sync.service.ts";
import { createIntegrationsService } from "./services/integrations.service.ts";

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

// ── services (business logic — no http, no SQL of their own) ─────────────────
const activitiesService     = createActivitiesService(db, activitiesRepo);
const bodyService           = createBodyService(db, bodyRepo);
const classificationService = createClassificationService(activitiesRepo);
const syncService           = createSyncService(__dirname);
const integrationsService   = createIntegrationsService(__dirname);

// ── Appearance: theme + background image ────────────────────────────────
// Custom-uploaded backgrounds land here (gitignored, not committed). The
// upload handler best-effort deletes the previous custom file on replace —
// failure there (e.g. a transient file lock) is swallowed, not fatal, since
// a stray leftover image costs nothing on a personal local app.
const backgroundsDir = path.resolve(__dirname, "../backgrounds");
if (!fs.existsSync(backgroundsDir)) fs.mkdirSync(backgroundsDir, { recursive: true });

// ── sync (streaming) ─────────────────────────────────────────────────────
// The blocking sync runner moved to services/sync.service.ts; this streaming
// variant stays here because it writes NDJSON straight to the http response.
// Relays sync-garmin.ts's "PROGRESS <phase>
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

// ── main API server ─────────────────────────────────────────────────────────
// The request handler lives in http/router.ts; server.ts builds the dependency
// context (repositories + services + the streaming sync helper) and wires it to
// the http server, alongside the always-on Withings callback server above.
const server = http.createServer(createApiHandler({
  port: PORT, db, config, backgroundsDir,
  repos: { activities: activitiesRepo, body: bodyRepo, settings: settingsRepo },
  services: {
    activities: activitiesService, body: bodyService, classification: classificationService,
    sync: syncService, integrations: integrationsService,
  },
  streamSyncScript,
}));

server.listen(PORT, "127.0.0.1", () => {
  console.log("=== Garmin Stats — API Server ===\n");
  console.log(`Listening on http://127.0.0.1:${PORT}/api/`);
  console.log("\nCtrl+C to stop.");
});
