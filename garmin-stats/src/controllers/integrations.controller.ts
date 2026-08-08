/**
 * controllers/integrations.controller.ts
 * HTTP boundary for external-integration status/auth: the Garmin device presence
 * check and the Withings/Strava OAuth status, login-URL, and Strava callback.
 * (The Withings callback runs on its own port — see http/withings-callback.ts.)
 */
import { randomUUID } from "crypto";
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { oauthState, oauthCallbackPage } from "../http/oauth.ts";
import { getAuthUrl, getTokenStatus } from "../withings-auth.ts";
import { getAuthUrl as getStravaAuthUrl, exchangeCode as exchangeStravaCode, getTokenStatus as getStravaTokenStatus } from "../strava-auth.ts";

export function createIntegrationsController(ctx: AppContext) {
  const { config, db } = ctx;
  const integrations = ctx.services.integrations;

  const garminStatus: Handler = async (_req, res) => send(res, await integrations.checkGarminDevice());

  const withingsStatus: Handler = async (_req, res) => send(res, await getTokenStatus(config, db));

  const withingsLoginUrl: Handler = (_req, res) => {
    oauthState.withings = randomUUID();
    return send(res, { url: getAuthUrl(config, oauthState.withings) });
  };

  const stravaStatus: Handler = async (_req, res) => send(res, await getStravaTokenStatus(config, db));

  const stravaLoginUrl: Handler = (_req, res) => {
    oauthState.strava = randomUUID();
    return send(res, { url: getStravaAuthUrl(config, oauthState.strava) });
  };

  const stravaCallback: Handler = async (_req, res, url) => {
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state");
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
  };

  return { garminStatus, withingsStatus, withingsLoginUrl, stravaStatus, stravaLoginUrl, stravaCallback };
}
