/**
 * auth-withings.ts
 * One-time OAuth2 authentication with Withings, run standalone from the
 * terminal. Usage: npm run auth:withings
 *
 * The same in-app "Login to Withings" button in the dashboard does this via
 * a popup instead (server.ts owns the callback listener on this same port
 * whenever it's running) — don't run this script at the same time as the
 * app server, since both would try to bind port 3002.
 */

import http from "http";
import { exec } from "child_process";
import { URL } from "url";
import { loadConfig } from "../config.ts";
import { openDb, initSchema } from "../db.ts";
import { getAuthUrl, exchangeCode, loadToken } from "../integrations/withings.ts";

const config = loadConfig();
const CALLBACK_PORT = 3002;
const state          = Math.random().toString(36).slice(2);
const authUrl         = getAuthUrl(config, state);

function openBrowser(url: string): void {
  const cmd = process.platform === "win32"  ? `start "" "${url}"`
            : process.platform === "darwin" ? `open "${url}"`
            : `xdg-open "${url}"`;
  exec(cmd);
}

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) { res.writeHead(404); res.end(); return; }
  const params   = new URL(req.url, `http://localhost:${CALLBACK_PORT}`).searchParams;
  const code     = params.get("code");
  const retState = params.get("state");

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<html><body style="font-family:sans-serif;padding:2rem"><h2>✓ Authenticated!</h2><p>You can close this tab.</p></body></html>`);

  if (!code || retState !== state) { console.error("Auth failed: missing code or state mismatch."); server.close(); return; }
  try {
    const db = openDb();
    initSchema(db);
    await exchangeCode(config, db, code);
    const token = loadToken(db)!;
    console.log("\n✓ Authentication successful! Tokens saved to DB.");
    console.log(`  Scope   : ${token.scope}`);
    console.log(`  Expires : ${new Date(token.expires_at * 1000).toLocaleString()}`);
    console.log("\nYou can now run: npm run sync:withings");
  } catch (e) {
    console.error("Token exchange failed:", e);
  } finally {
    server.close();
  }
});

server.listen(CALLBACK_PORT, "127.0.0.1", () => {
  console.log("=== Garmin Stats — Withings Auth ===\n");
  console.log("Opening browser for Withings login…");
  openBrowser(authUrl);
  console.log(`Waiting for callback on port ${CALLBACK_PORT}…`);
});
