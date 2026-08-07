/**
 * http/oauth.ts
 * Shared OAuth `state` nonces + the tiny callback HTML page. Used by BOTH the
 * always-on Withings callback server (server.ts, port 3002) and the Strava
 * callback handled on the main router (http/router.ts). Kept in one module so
 * the pending state is a single shared reference across both — this preserves
 * the original module-level-variable behavior after the S1 file split.
 */
export const oauthState: { withings: string | null; strava: string | null } = {
  withings: null,
  strava: null,
};

export function oauthCallbackPage(title: string, message: string, autoClose: boolean): string {
  return `<html><body style="font-family:sans-serif;padding:2rem"><h2>${title}</h2><p>${message}</p></body>${autoClose ? "<script>window.close()</script>" : ""}</html>`;
}
