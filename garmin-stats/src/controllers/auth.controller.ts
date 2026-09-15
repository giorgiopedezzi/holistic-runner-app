import { createHmac } from "node:crypto";
import type { AppContext, Handler } from "../http/context.ts";
import { consumeAuthTransaction, createAuthTransaction } from "../http/auth-transaction.ts";
import { requestIdentity } from "../http/auth-context.ts";
import { send, sendNoContent } from "../http/respond.ts";
import { serviceUnavailable, unauthorized } from "../http/problem.ts";
import { requireWebAuthConfig } from "../config.ts";
import { remoteJwks, TokenValidationError, verifyIdToken } from "../domain/identity/token-validation.ts";
import { logSecurityEvent } from "../http/security-log.ts";

const SESSION_COOKIE = "__Host-runsfree_session";
const LOCAL_SESSION_COOKIE = "runsfree_session";
const PREAUTH_COOKIE = "runsfree_preauth";
const rateWindows = new Map<string, { count: number; resetAt: number }>();

function cookie(req: Parameters<Handler>[0], name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function secureCookie(callbackUrl: string): boolean { return new URL(callbackUrl).protocol === "https:"; }
function sessionCookieName(callbackUrl: string): string { return secureCookie(callbackUrl) ? SESSION_COOKIE : LOCAL_SESSION_COOKIE; }
function cookieAttributes(callbackUrl: string, maxAge: number): string {
  return `Path=/; HttpOnly; SameSite=${secureCookie(callbackUrl) ? "None" : "Lax"}; Max-Age=${maxAge}${secureCookie(callbackUrl) ? "; Secure" : ""}`;
}
function redirect(res: Parameters<Handler>[1], location: string, cookies: string[] = []): void {
  res.writeHead(302, { Location: location, ...(cookies.length ? { "Set-Cookie": cookies } : {}) });
  res.end();
}
function checkRate(req: Parameters<Handler>[0], scope: string): boolean {
  const key = `${scope}:${req.socket.remoteAddress ?? "unknown"}`;
  const now = Date.now(); const entry = rateWindows.get(key);
  if (!entry || entry.resetAt <= now) { rateWindows.set(key, { count: 1, resetAt: now + 60_000 }); return true; }
  entry.count += 1; return entry.count <= 20;
}
function csrfToken(sessionCookie: string): string {
  return createHmac("sha256", "runsfree-session-csrf-v1").update(sessionCookie).digest("base64url");
}
export function expectedCsrfToken(sessionCookie: string): string { return csrfToken(sessionCookie); }

async function discovery(url: string): Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("discovery failed");
  const body = await response.json() as Record<string, unknown>;
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) if (typeof body[key] !== "string") throw new Error("discovery failed");
  return body as { authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
}

export function createAuthController(ctx: AppContext): { login: Handler; callback: Handler; session: Handler; logout: Handler } {
  const callbackFailure = () => `${requireWebAuthConfig(ctx.config).webLogoutUrl}?auth=unavailable`;
  return {
    login: async (req, res) => {
      if (!ctx.config.auth.enabled || !checkRate(req, "login")) {
        logSecurityEvent("auth.login.unavailable", { reason: ctx.config.auth.enabled ? "rate_limited" : "auth_disabled" });
        throw serviceUnavailable("Sign-in is temporarily unavailable.");
      }
      let config; let endpoints;
      try { config = requireWebAuthConfig(ctx.config); endpoints = await discovery(config.discoveryUrl); }
      catch { throw serviceUnavailable("Sign-in is temporarily unavailable."); }
      const transaction = await createAuthTransaction(ctx.db);
      const authorization = new URL(endpoints.authorization_endpoint);
      authorization.searchParams.set("response_type", "code");
      authorization.searchParams.set("client_id", config.webClientId);
      authorization.searchParams.set("redirect_uri", config.webCallbackUrl);
      authorization.searchParams.set("scope", "openid profile email");
      authorization.searchParams.set("state", transaction.state);
      authorization.searchParams.set("nonce", transaction.nonce);
      redirect(res, authorization.toString(), [`${PREAUTH_COOKIE}=${transaction.preauth}; ${cookieAttributes(config.webCallbackUrl, 600)}`]);
    },
    callback: async (req, res, url) => {
      if (!ctx.config.auth.enabled || !checkRate(req, "callback")) return redirect(res, callbackFailure());
      let config;
      try { config = requireWebAuthConfig(ctx.config); } catch { return redirect(res, callbackFailure()); }
      const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
      const transaction = state ? await consumeAuthTransaction(ctx.db, state, cookie(req, PREAUTH_COOKIE) ?? "") : null;
      if (!code || !transaction) {
        // A state param that fails to consume (already used, expired, or a
        // forged/mismatched preauth cookie) is a replay/tamper attempt, not
        // ordinary missing-params noise — log it as its own signal.
        if (state) logSecurityEvent("auth.callback.replay", { state });
        return redirect(res, callbackFailure(), [`${PREAUTH_COOKIE}=; ${cookieAttributes(config.webCallbackUrl, 0)}`]);
      }
      try {
        const endpoints = await discovery(config.discoveryUrl);
        const tokenResponse = await fetch(endpoints.token_endpoint, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.webCallbackUrl, client_id: config.webClientId, client_secret: config.webClientSecret }),
        });
        if (!tokenResponse.ok) throw new Error("code exchange failed");
        const tokens = await tokenResponse.json() as { id_token?: unknown };
        if (typeof tokens.id_token !== "string") throw new Error("missing ID token");
        const identity = await verifyIdToken(tokens.id_token, remoteJwks(endpoints.jwks_uri), { issuer: config.issuerUrl, audience: config.webClientId, nonce: transaction.nonce });
        const resolution = await ctx.services.identity.resolveExternalLogin(
          { issuer: identity.issuer, subject: identity.subject, provider: "auth0", email: identity.email },
          { mode: ctx.config.auth.registrationMode, founderAllowlist: ctx.config.auth.founderAllowlist },
        );
        if (resolution.outcome !== "authenticated") {
          logSecurityEvent("auth.registration.denied", { outcome: resolution.outcome, mode: ctx.config.auth.registrationMode });
          return redirect(res, `${config.webLogoutUrl}?auth=pending`);
        }
        const sessionName = sessionCookieName(config.webCallbackUrl);
        const previous = cookie(req, SESSION_COOKIE) ?? cookie(req, LOCAL_SESSION_COOKIE);
        const session = await ctx.services.identity.rotateSession(resolution.user.id,
          { idleSeconds: ctx.config.auth.sessionIdleSeconds, absoluteSeconds: ctx.config.auth.sessionAbsoluteSeconds }, null);
        if (previous) {
          await ctx.services.identity.revokeSessionByCookie(previous);
          logSecurityEvent("auth.session.revoked", { reason: "rotated_on_login", userId: resolution.user.id });
        }
        redirect(res, config.webLogoutUrl, [
          `${sessionName}=${encodeURIComponent(session)}; ${cookieAttributes(config.webCallbackUrl, ctx.config.auth.sessionAbsoluteSeconds)}`,
          `${PREAUTH_COOKIE}=; ${cookieAttributes(config.webCallbackUrl, 0)}`,
        ]);
      } catch (error) {
        if (!(error instanceof TokenValidationError)) logSecurityEvent("auth.callback.failed", { reason: error instanceof Error ? error.message : String(error) });
        return redirect(res, callbackFailure(), [`${PREAUTH_COOKIE}=; ${cookieAttributes(config.webCallbackUrl, 0)}`]);
      }
    },
    session: async (req, res) => {
      const identity = requestIdentity(req);
      const user = await ctx.repos.identity.getUserById(identity.userId);
      const rawSession = cookie(req, SESSION_COOKIE) ?? cookie(req, LOCAL_SESSION_COOKIE);
      if (!user || !rawSession) throw unauthorized();
      const entitlements = await ctx.repos.identity.listEntitlements(user.id);
      send(res, { user: { id: user.id, display_name: user.display_name, locale: user.locale, unit_system: user.unit_system, timezone: user.timezone, role: user.role }, entitlements: entitlements.map(row => row.entitlement), csrfToken: csrfToken(rawSession) });
    },
    logout: async (req, res) => {
      const config = requireWebAuthConfig(ctx.config);
      const rawSession = cookie(req, SESSION_COOKIE) ?? cookie(req, LOCAL_SESSION_COOKIE);
      if (rawSession) {
        await ctx.services.identity.revokeSessionByCookie(rawSession);
        logSecurityEvent("auth.session.revoked", { reason: "logout" });
      }
      res.setHeader("Set-Cookie", `${sessionCookieName(config.webCallbackUrl)}=; ${cookieAttributes(config.webCallbackUrl, 0)}`);
      sendNoContent(res);
    },
  };
}
