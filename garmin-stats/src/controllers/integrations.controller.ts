/**
 * controllers/integrations.controller.ts
 * HTTP boundary for external-integration status/auth: the Garmin device presence
 * check and the Withings/Strava OAuth status, login-URL, callback, and disconnect.
 * (The Withings callback runs on its own port — see http/withings-callback.ts.)
 *
 * HRA-352: status/login-url/disconnect are owner-scoped (router.ts requires
 * auth on these routes — AC3) — every handler here reads the owner from
 * requestIdentity(req), never a client-supplied id. The Strava callback stays
 * unauthenticated by design (AC4): it derives its owner strictly from the
 * oauth_states row the login-url call minted, the same server-side-state
 * contract the Withings callback (http/withings-callback.ts) already follows.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { requestIdentity } from "../http/auth-context.ts";
import { createOauthState, consumeOauthState, oauthCallbackPage } from "../http/oauth.ts";
import { requireWithingsConfig, requireStravaConfig } from "../config.ts";
import { getAuthUrl, getTokenStatus, disconnect as disconnectWithings } from "../integrations/withings.ts";
import { getAuthUrl as getStravaAuthUrl, exchangeCode as exchangeStravaCode, getTokenStatus as getStravaTokenStatus, disconnect as disconnectStrava } from "../integrations/strava.ts";
import { ProviderAccountConflictError } from "../integrations/provider-account-conflict.ts";

export function createIntegrationsController(ctx: AppContext) {
  const { config, db } = ctx;
  const device = ctx.services.device;

  const garminStatus: Handler = async (_req, res) => send(res, await device.checkGarminDevice());

  const withingsStatus: Handler = async (req, res) => send(res, await getTokenStatus(config, db, requestIdentity(req).userId));

  const withingsLoginUrl: Handler = async (req, res) => {
    const { redirect_uri } = requireWithingsConfig(config);
    const state = await createOauthState(db, requestIdentity(req).userId, "withings", redirect_uri);
    return send(res, { url: getAuthUrl(config, state) });
  };

  const withingsDisconnect: Handler = async (req, res) => send(res, { disconnected: await disconnectWithings(db, requestIdentity(req).userId) });

  const stravaStatus: Handler = async (req, res) => send(res, await getStravaTokenStatus(config, db, requestIdentity(req).userId));

  const stravaLoginUrl: Handler = async (req, res) => {
    const { redirect_uri } = requireStravaConfig(config);
    const state = await createOauthState(db, requestIdentity(req).userId, "strava", redirect_uri);
    return send(res, { url: getStravaAuthUrl(config, state) });
  };

  const stravaDisconnect: Handler = async (req, res) => send(res, { disconnected: await disconnectStrava(config, db, requestIdentity(req).userId) });

  // Deliberately not behind requireAuth — see the module doc comment. The
  // state token itself names the owner (AC4); requiring a live session here
  // as well would fail closed for a browser that lost its cookie mid-flow
  // for no isolation benefit, since the state row is already the binding
  // authority.
  const stravaCallback: Handler = async (_req, res, url) => {
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    res.writeHead(200, { "Content-Type": "text/html" });
    if (!code || !state) {
      res.end(oauthCallbackPage("✗ Authentication failed", "Missing code or state — close this window and try logging in again from the dashboard.", false));
      return;
    }
    const consumed = await consumeOauthState(db, state, "strava");
    if (!consumed) {
      res.end(oauthCallbackPage("✗ Authentication failed", "This login link is invalid, expired, or already used — close this window and try logging in again from the dashboard.", false));
      return;
    }
    try {
      await exchangeStravaCode(config, db, consumed.userId, code);
      res.end(oauthCallbackPage("✓ Authenticated!", "This window will close automatically.", true));
    } catch (e) {
      const message = e instanceof ProviderAccountConflictError ? e.message : (e instanceof Error ? e.message : String(e));
      res.end(oauthCallbackPage("✗ Authentication failed", message, false));
    }
  };

  return { garminStatus, withingsStatus, withingsLoginUrl, withingsDisconnect, stravaStatus, stravaLoginUrl, stravaDisconnect, stravaCallback };
}
