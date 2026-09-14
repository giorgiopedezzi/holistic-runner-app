/**
 * http/auth-context.ts
 * The authenticated-request context boundary (AC11/AC12): derives request
 * identity solely from a validated session cookie or bearer access token —
 * never from any client-supplied user id. Every failure mode (missing
 * credential, expired/invalid/wrong-issuer/wrong-audience/bad-signature
 * token, revoked session, disabled account) collapses to the same 401
 * (http/problem.ts's unauthorized()) before returning control to a caller.
 *
 * Not wired into router.ts — AUTH_ENABLED is off by default and this Story
 * introduces no login/callback HTTP route (see the HRA-348 review comment).
 * `requireAuth` exists so a future controller can opt in directly once one
 * does.
 */
import type http from "http";
import type { URL } from "url";
import type { JWTVerifyGetKey } from "jose";
import type { AppContext, Handler } from "./context.ts";
import { unauthorized } from "./problem.ts";
import { requireAuthConfig } from "../config.ts";
import { remoteJwks, verifyAccessToken, TokenValidationError, type ValidatedTokenIdentity } from "../domain/identity/token-validation.ts";
import type { UserRole } from "../db.ts";

export interface RequestIdentity { userId: string; role: UserRole }

// Request identity is derived once at the HTTP boundary and kept off the
// client-controlled request object. Controllers must obtain it through this
// accessor before reaching an owner-scoped repository.
const requestIdentities = new WeakMap<http.IncomingMessage, RequestIdentity>();

// Matches the ADR's cookie name exactly, so a session issued once this
// Story's session-lifecycle helpers are wired to a real login flow reads
// back under the same name.
const SESSION_COOKIE_NAME = "__Host-runsfree_session";

function readCookie(req: http.IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    if (part.slice(0, separatorIndex).trim() === name) return decodeURIComponent(part.slice(separatorIndex + 1).trim());
  }
  return null;
}

function readBearerToken(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

// Discovery-document -> jwks_uri resolution, cached for the process lifetime
// (the discovery document itself essentially never changes, unlike the
// signing keys it points at) — the remote JWKS resolver it builds does its
// own 5-10 min key cache per the ADR (domain/identity/token-validation.ts).
let cachedJwks: { discoveryUrl: string; key: JWTVerifyGetKey } | undefined;

async function resolveJwks(discoveryUrl: string): Promise<JWTVerifyGetKey> {
  if (cachedJwks?.discoveryUrl === discoveryUrl) return cachedJwks.key;
  const response = await fetch(discoveryUrl);
  if (!response.ok) throw new TokenValidationError("discovery document fetch failed");
  const document = (await response.json()) as { jwks_uri?: unknown };
  if (typeof document.jwks_uri !== "string") throw new TokenValidationError("discovery document missing jwks_uri");
  const key = remoteJwks(document.jwks_uri);
  cachedJwks = { discoveryUrl, key };
  return key;
}

async function identityFromBearerToken(ctx: AppContext, token: string): Promise<RequestIdentity> {
  let validated: ValidatedTokenIdentity;
  try {
    const authConfig = requireAuthConfig(ctx.config);
    const key = await resolveJwks(authConfig.discoveryUrl);
    validated = await verifyAccessToken(token, key, { issuer: authConfig.issuerUrl, audience: authConfig.audience });
  } catch {
    throw unauthorized();
  }
  const resolution = await ctx.services.identity.resolveExternalLogin(
    { issuer: validated.issuer, subject: validated.subject, provider: null, email: validated.email },
    { mode: ctx.config.auth.registrationMode, founderAllowlist: ctx.config.auth.founderAllowlist },
  );
  if (resolution.outcome !== "authenticated") throw unauthorized();
  return { userId: resolution.user.id, role: resolution.user.role };
}

export async function deriveRequestIdentity(req: http.IncomingMessage, ctx: AppContext): Promise<RequestIdentity> {
  // AUTH_ENABLED is the explicit production gate (ADR) — fail closed rather
  // than accept a session/token an incomplete deployment can't fully verify.
  if (!ctx.config.auth.enabled) throw unauthorized();

  const sessionCookie = readCookie(req, SESSION_COOKIE_NAME);
  if (sessionCookie) {
    const identity = await ctx.services.identity.validateSessionCookie(sessionCookie, ctx.config.auth.sessionIdleSeconds);
    if (!identity) throw unauthorized();
    return { userId: identity.userId, role: identity.role };
  }

  const bearerToken = readBearerToken(req);
  if (bearerToken) return identityFromBearerToken(ctx, bearerToken);

  throw unauthorized();
}

export async function authenticateRequest(req: http.IncomingMessage, ctx: AppContext): Promise<RequestIdentity> {
  const identity = await deriveRequestIdentity(req, ctx);
  requestIdentities.set(req, identity);
  return identity;
}

export function requestIdentity(req: http.IncomingMessage): RequestIdentity {
  const identity = requestIdentities.get(req);
  if (!identity) throw new Error("Authenticated request identity was not established.");
  return identity;
}

type AuthenticatedHandler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, identity: RequestIdentity) => void | Promise<void>;

// For a future controller to opt into (AC11's "required typed request
// context") — deriveRequestIdentity() throws before `handler` ever runs, so
// `identity` here is never optional/undefined.
export function requireAuth(ctx: AppContext, handler: AuthenticatedHandler): Handler {
  return async (req, res, url) => {
    const identity = await authenticateRequest(req, ctx);
    return handler(req, res, url, identity);
  };
}
