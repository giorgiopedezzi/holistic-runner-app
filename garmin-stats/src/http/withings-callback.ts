/**
 * http/withings-callback.ts
 * The always-on Withings OAuth callback server (port 3002). Kept separate from the
 * main API server because Withings requires an exact redirect URI
 * (http://localhost:3002/callback). Whenever server.ts is running, the dashboard's
 * "Login to Withings" popup can go straight to Withings' login page. Don't run
 * `npm run auth:withings` at the same time — both bind this port. Moved out of
 * server.ts (HRA-31) so server.ts stays wiring-only.
 */
import http from "http";
import { URL } from "url";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.ts";
import { exchangeCode } from "../integrations/withings.ts";
import { oauthState, oauthCallbackPage } from "./oauth.ts";

const WITHINGS_CALLBACK_PORT = 3002;

export function startWithingsCallbackServer(config: Config, db: DatabaseSync): void {
  const server = http.createServer(async (req, res) => {
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

  server.on("error", err => {
    console.error(`⚠ Withings OAuth callback server failed to start on port ${WITHINGS_CALLBACK_PORT}: ${err.message}`);
    console.error("  \"Login to Withings\" won't work until this is resolved (another process on that port? e.g. `npm run auth:withings` running separately).");
  });

  server.listen(WITHINGS_CALLBACK_PORT, "127.0.0.1");
}
