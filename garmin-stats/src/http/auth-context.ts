/**
 * http/auth-context.ts
 * The authenticated-request context boundary (AC11/AC12): derives request
 * identity solely from a validated session cookie or bearer access token —
 * never from any client-supplied user id. Every failure mode (missing
 * credential, expired/invalid/wrong-issuer/wrong-audience/bad-signature
 * token, revoked session, disabled account) collapses to the same 401
 * (http/problem.ts's unauthorized()) before returning control to a caller.
 *
 * router.ts establishes this strict identity for authenticated routes.
 * Founder-public access is a separate, explicitly selected context;
 * requestIdentity() never manufactures or falls back to the founder.
 */
import type http from "http";
import type { URL } from "url";
import type { JWTVerifyGetKey } from "jose";
import type { AppContext, Handler } from "./context.ts";
import { unauthorized } from "./problem.ts";
import { requireAuthConfig } from "../config.ts";
import { FOUNDER_USER_ID } from "../db/founder.ts";
import { remoteJwks, verifyAccessToken, TokenValidationError, type ValidatedTokenIdentity } from "../domain/identity/token-validation.ts";
import type { UserRole } from "../db.ts";

export interface RequestIdentity { userId: string; role: UserRole; sessionId: string | null }

export type RouteCapability =
  | "PUBLIC_READ"
  | "PUBLIC_COMPUTE"
  | "AUTHENTICATED_READ"
  | "AUTHENTICATED_WRITE"
  | "PUBLIC_FEEDBACK";

export interface AuthenticatedAccessContext {
  kind: "authenticated";
  identity: RequestIdentity;
}

export interface FounderPublicAccessContext {
  kind: "founder-public";
  userId: typeof FOUNDER_USER_ID;
}

export interface PublicFeedbackAccessContext {
  kind: "public-feedback";
}

export type RequestAccessContext = AuthenticatedAccessContext | FounderPublicAccessContext | PublicFeedbackAccessContext;

// Request identity is derived once at the HTTP boundary and kept off the
// client-controlled request object. Controllers must obtain it through this
// accessor before reaching an owner-scoped repository.
const requestIdentities = new WeakMap<http.IncomingMessage, RequestIdentity>();
const requestAccessContexts = new WeakMap<http.IncomingMessage, RequestAccessContext>();

// Matches the ADR's cookie name exactly, so a session issued once this
// Story's session-lifecycle helpers are wired to a real login flow reads
// back under the same name.
const SESSION_COOKIE_NAME = "__Host-runsfree_session";
const LOCAL_SESSION_COOKIE_NAME = "runsfree_session";

function readCookie(req: http.IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    if (part.slice(0, separatorIndex).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separatorIndex + 1).trim());
      } catch {
        throw unauthorized();
      }
    }
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

function hasSuppliedCredential(req: http.IncomingMessage): boolean {
  if (req.headers.authorization !== undefined) return true;
  const cookie = req.headers.cookie;
  if (!cookie) return false;
  return cookie.split(";").some(part => {
    const separatorIndex = part.indexOf("=");
    const name = part.slice(0, separatorIndex === -1 ? undefined : separatorIndex).trim();
    return name === SESSION_COOKIE_NAME || name === LOCAL_SESSION_COOKIE_NAME;
  });
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
  return { userId: resolution.user.id, role: resolution.user.role, sessionId: null };
}

export async function deriveRequestIdentity(req: http.IncomingMessage, ctx: AppContext): Promise<RequestIdentity> {
  // AUTH_ENABLED is the explicit production gate (ADR) — fail closed rather
  // than accept a session/token an incomplete deployment can't fully verify.
  if (!ctx.config.auth.enabled) throw unauthorized();

  // Browsers reject a __Host- cookie without Secure. Local HTTP development
  // therefore uses the same opaque credential under a non-host-prefixed name;
  // production accepts only the host-only, Secure name from the ADR.
  const sessionCookie = readCookie(req, SESSION_COOKIE_NAME) ?? readCookie(req, LOCAL_SESSION_COOKIE_NAME);
  if (sessionCookie) {
    const identity = await ctx.services.identity.validateSessionCookie(sessionCookie, ctx.config.auth.sessionIdleSeconds);
    if (!identity) throw unauthorized();
    return { userId: identity.userId, role: identity.role, sessionId: identity.sessionId };
  }

  const bearerToken = readBearerToken(req);
  if (bearerToken) return identityFromBearerToken(ctx, bearerToken);

  throw unauthorized();
}

export async function authenticateRequest(req: http.IncomingMessage, ctx: AppContext): Promise<RequestIdentity> {
  const identity = await deriveRequestIdentity(req, ctx);
  requestIdentities.set(req, identity);
  requestAccessContexts.set(req, { kind: "authenticated", identity });
  return identity;
}

/**
 * Resolves the access mode selected by an explicitly classified HTTP route.
 * The caller must supply a capability from the reviewed route matrix; this
 * function never infers public safety from the HTTP method.
 *
 * A missing credential may enter founder-public or feedback access. Any
 * supplied session/bearer credential is authenticated first, so malformed,
 * expired, revoked, wrong-issuer, or otherwise invalid credentials fail with
 * 401 instead of silently downgrading to Guest access.
 */
export async function deriveRequestAccessContext(
  req: http.IncomingMessage,
  ctx: AppContext,
  capability: RouteCapability,
): Promise<RequestAccessContext> {
  let access: RequestAccessContext;
  if (hasSuppliedCredential(req) || capability === "AUTHENTICATED_READ" || capability === "AUTHENTICATED_WRITE") {
    access = { kind: "authenticated", identity: await authenticateRequest(req, ctx) };
  } else if (capability === "PUBLIC_READ" || capability === "PUBLIC_COMPUTE") {
    access = { kind: "founder-public", userId: FOUNDER_USER_ID };
  } else {
    access = { kind: "public-feedback" };
  }
  requestAccessContexts.set(req, access);
  return access;
}

export function requestIdentity(req: http.IncomingMessage): RequestIdentity {
  const identity = requestIdentities.get(req);
  if (!identity) throw new Error("Authenticated request identity was not established.");
  return identity;
}

export function requestAccessContext(req: http.IncomingMessage): RequestAccessContext {
  const access = requestAccessContexts.get(req);
  if (!access) throw new Error("Request access context was not established.");
  return access;
}

/**
 * The authoritative owner for an explicitly classified owner-data route.
 * Founder-public access stays separate from authenticated identity: callers
 * can read the fixed founder owner, but requestIdentity() still fails.
 */
export function requestDataOwnerId(req: http.IncomingMessage): string {
  const access = requestAccessContext(req);
  if (access.kind === "authenticated") return access.identity.userId;
  if (access.kind === "founder-public") return access.userId;
  throw new Error("Public feedback has no owner-data context.");
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
