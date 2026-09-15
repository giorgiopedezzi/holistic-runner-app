/**
 * domain/identity/token-validation.ts
 * Provider access-token validation (AC11/AC12), per the ADR's "Token
 * validation and tenancy" section. Uses `jose` for JWKS retrieval + JWS
 * verification (a deliberate dependency for this security boundary — see the
 * HRA-348 review comment) rather than hand-rolled crypto.
 *
 * Only the JWT's issuer + subject are ever treated as identity; `email`, if
 * present, is returned separately and must never be used as an identity key
 * (AC2/AC4) — callers may use it only for registration-gate/metadata purposes.
 */
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JSONWebKeySet } from "jose";

// Explicit algorithm allowlist — Auth0-issued tokens use RS256; ES256 is
// included for a future signing-key rotation to an EC key. Never widen this
// to "whatever the token claims" (that would let a forged token pick its own
// verification algorithm).
const ALLOWED_ALGORITHMS = ["RS256", "ES256"];

// Signing keys are cached 5-10 minutes and an unknown `kid` triggers at most
// one refetch per cooldown window, per the ADR's JWKS caching guidance.
const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const JWKS_REFETCH_COOLDOWN_MS = 5 * 60 * 1000;

// Clock skew tolerance for exp/nbf, per the ADR.
const CLOCK_TOLERANCE_SECONDS = 60;

export function remoteJwks(jwksUri: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: JWKS_REFETCH_COOLDOWN_MS,
  });
}

export function localJwks(jwks: JSONWebKeySet): JWTVerifyGetKey {
  return createLocalJWKSet(jwks);
}

export class TokenValidationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TokenValidationError";
  }
}

export interface TokenValidationConfig {
  issuer: string;
  audience: string;
}

export interface ValidatedTokenIdentity {
  issuer: string;
  subject: string;
  email: string | null;
}

// Every failure path (missing/invalid signature, wrong issuer/audience,
// expired, malformed subject) throws the same TokenValidationError — callers
// must reduce this to one uniform 401 (AC12: never reveal which check
// actually failed).
export async function verifyAccessToken(token: string, key: JWTVerifyGetKey, config: TokenValidationConfig): Promise<ValidatedTokenIdentity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ALLOWED_ALGORITHMS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }));
  } catch {
    throw new TokenValidationError("token validation failed");
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw new TokenValidationError("token validation failed");
  const email = typeof payload.email === "string" ? payload.email : null;
  return { issuer: config.issuer, subject: payload.sub, email };
}

// Authorization Code callbacks validate an ID token against the confidential
// web-client id (not the API audience used by bearer access tokens) and bind
// it to the nonce minted with the state transaction.
export async function verifyIdToken(token: string, key: JWTVerifyGetKey, config: TokenValidationConfig & { nonce: string }): Promise<ValidatedTokenIdentity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ALLOWED_ALGORITHMS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }));
  } catch {
    throw new TokenValidationError("token validation failed");
  }
  if (payload.nonce !== config.nonce || typeof payload.sub !== "string" || !payload.sub) {
    throw new TokenValidationError("token validation failed");
  }
  const email = typeof payload.email === "string" ? payload.email : null;
  return { issuer: config.issuer, subject: payload.sub, email };
}
