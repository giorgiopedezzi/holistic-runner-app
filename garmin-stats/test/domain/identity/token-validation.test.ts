/**
 * test/domain/identity/token-validation.test.ts (HRA-348 AC11/AC12)
 * verifyAccessToken against a local JWKS (no network) — covers the exact
 * uniform-401 failure modes the ADR names: expired, wrong issuer, wrong
 * audience, invalid signature, and a malformed subject claim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import { TokenValidationError, localJwks, verifyAccessToken } from "../../../src/domain/identity/token-validation.ts";

const ISSUER = "https://runsfree.eu.auth0.com/";
const AUDIENCE = "https://api.runsfree.example.com";
const KID = "test-signing-key-1";

async function trustedKeyPair() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };
  const jwks: JSONWebKeySet = { keys: [publicJwk as JSONWebKeySet["keys"][number]] };
  return { privateKey, jwks };
}

async function sign(privateKey: Parameters<SignJWT["sign"]>[0], claims: Record<string, unknown>, kid = KID) {
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).sign(privateKey);
}

test("verifyAccessToken accepts a validly signed token matching issuer + audience, and returns issuer/subject/email", async () => {
  const { privateKey, jwks } = await trustedKeyPair();
  const token = await sign(privateKey, { iss: ISSUER, aud: AUDIENCE, sub: "auth0|abc123", email: "runner@example.com", exp: Math.floor(Date.now() / 1000) + 300 });
  const identity = await verifyAccessToken(token, localJwks(jwks), { issuer: ISSUER, audience: AUDIENCE });
  assert.deepEqual(identity, { issuer: ISSUER, subject: "auth0|abc123", email: "runner@example.com" });
});

test("verifyAccessToken returns email: null when the token carries no email claim", async () => {
  const { privateKey, jwks } = await trustedKeyPair();
  const token = await sign(privateKey, { iss: ISSUER, aud: AUDIENCE, sub: "auth0|no-email", exp: Math.floor(Date.now() / 1000) + 300 });
  const identity = await verifyAccessToken(token, localJwks(jwks), { issuer: ISSUER, audience: AUDIENCE });
  assert.equal(identity.email, null);
});

test("verifyAccessToken rejects an expired token", async () => {
  const { privateKey, jwks } = await trustedKeyPair();
  const token = await sign(privateKey, { iss: ISSUER, aud: AUDIENCE, sub: "auth0|abc123", exp: Math.floor(Date.now() / 1000) - 600 });
  await assert.rejects(() => verifyAccessToken(token, localJwks(jwks), { issuer: ISSUER, audience: AUDIENCE }), TokenValidationError);
});

test("verifyAccessToken rejects a token from an unexpected issuer", async () => {
  const { privateKey, jwks } = await trustedKeyPair();
  const token = await sign(privateKey, { iss: "https://attacker.example.com/", aud: AUDIENCE, sub: "auth0|abc123", exp: Math.floor(Date.now() / 1000) + 300 });
  await assert.rejects(() => verifyAccessToken(token, localJwks(jwks), { issuer: ISSUER, audience: AUDIENCE }), TokenValidationError);
});

test("verifyAccessToken rejects a token for an unexpected audience", async () => {
  const { privateKey, jwks } = await trustedKeyPair();
  const token = await sign(privateKey, { iss: ISSUER, aud: "https://some-other-api.example.com", sub: "auth0|abc123", exp: Math.floor(Date.now() / 1000) + 300 });
  await assert.rejects(() => verifyAccessToken(token, localJwks(jwks), { issuer: ISSUER, audience: AUDIENCE }), TokenValidationError);
});

test("verifyAccessToken rejects a token signed by a key not in the trusted JWKS (invalid signature)", async () => {
  const { jwks } = await trustedKeyPair();
  const attacker = await generateKeyPair("RS256"); // a different key, same kid — signature won't match the trusted public key
  const token = await sign(attacker.privateKey, { iss: ISSUER, aud: AUDIENCE, sub: "auth0|abc123", exp: Math.floor(Date.now() / 1000) + 300 });
  await assert.rejects(() => verifyAccessToken(token, localJwks(jwks), { issuer: ISSUER, audience: AUDIENCE }), TokenValidationError);
});

test("verifyAccessToken rejects a token with no `kid` matching the trusted JWKS", async () => {
  const { jwks } = await trustedKeyPair();
  const other = await generateKeyPair("RS256");
  const token = await sign(other.privateKey, { iss: ISSUER, aud: AUDIENCE, sub: "auth0|abc123", exp: Math.floor(Date.now() / 1000) + 300 }, "unknown-kid");
  await assert.rejects(() => verifyAccessToken(token, localJwks(jwks), { issuer: ISSUER, audience: AUDIENCE }), TokenValidationError);
});

test("verifyAccessToken rejects a token with no subject claim", async () => {
  const { privateKey, jwks } = await trustedKeyPair();
  const token = await sign(privateKey, { iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300 });
  await assert.rejects(() => verifyAccessToken(token, localJwks(jwks), { issuer: ISSUER, audience: AUDIENCE }), TokenValidationError);
});

test("verifyAccessToken rejects an HS256-signed token even with a correct-looking payload (algorithm not in the allowlist)", async () => {
  const secret = new TextEncoder().encode("shared-secret-not-actually-trusted");
  const token = await new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: "auth0|abc123", exp: Math.floor(Date.now() / 1000) + 300 })
    .setProtectedHeader({ alg: "HS256" })
    .sign(secret);
  const { jwks } = await trustedKeyPair();
  await assert.rejects(() => verifyAccessToken(token, localJwks(jwks), { issuer: ISSUER, audience: AUDIENCE }), TokenValidationError);
});
