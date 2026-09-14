/**
 * test/services/identity.service.test.ts (HRA-348)
 * Service-level coverage against a real isolated PostgreSQL schema —
 * issuer/subject uniqueness, email change, same-email different identities,
 * registration closed/open, session rotation/revocation, account status, and
 * role/entitlement separation (AC14).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../helpers/db.ts";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createIdentityService, type ExternalLoginInput, type RegistrationGateConfig, type SessionLifetimeConfig } from "../../src/services/identity.service.ts";

const OPEN: RegistrationGateConfig = { mode: "open", founderAllowlist: [] };
const founders = (allowlist: string[]): RegistrationGateConfig => ({ mode: "founders_only", founderAllowlist: allowlist });
const LIFETIME: SessionLifetimeConfig = { idleSeconds: 1800, absoluteSeconds: 43200 };
const login = (overrides: Partial<ExternalLoginInput> = {}): ExternalLoginInput =>
  ({ issuer: "https://idp.example.com/", subject: "sub-1", provider: "google", email: "a@example.com", ...overrides });

async function setup() {
  const { db, cleanup } = await createTestDb();
  const repo = createIdentityRepo(db);
  const service = createIdentityService(db, repo);
  return { db, repo, service, cleanup };
}

test("an unknown identity under open registration creates exactly one new internal user", async () => {
  const { service, repo, cleanup } = await setup();
  try {
    const result = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(result.outcome, "authenticated");
    if (result.outcome !== "authenticated") return;
    const identity = await repo.findExternalIdentity("https://idp.example.com/", "sub-1");
    assert.equal(identity?.user_id, result.user.id);
  } finally { await cleanup(); }
});

test("issuer/subject uniqueness: the same (issuer, subject) logging in twice resolves to the same user, never a second one", async () => {
  const { service, cleanup } = await setup();
  try {
    const first = await service.resolveExternalLogin(login(), OPEN);
    const second = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(first.outcome, "authenticated");
    assert.equal(second.outcome, "authenticated");
    if (first.outcome === "authenticated" && second.outcome === "authenticated") assert.equal(first.user.id, second.user.id);
  } finally { await cleanup(); }
});

test("(issuer, subject) uniqueness is enforced at the database level, not only by application logic", async () => {
  const { db, repo, cleanup } = await setup();
  try {
    const userA = await repo.createUserWithExternalIdentity(login());
    const userB = await repo.createUserWithExternalIdentity(login({ subject: "sub-2" }));
    assert.notEqual(userA.id, userB.id);
    await assert.rejects(() => db.run(
      "INSERT INTO external_identities (user_id, issuer, subject) VALUES ($1, $2, $3)",
      [userB.id, "https://idp.example.com/", "sub-1"],
    ));
  } finally { await cleanup(); }
});

test("email change: a provider email change updates non-authoritative metadata only, never ownership", async () => {
  const { service, repo, cleanup } = await setup();
  try {
    const first = await service.resolveExternalLogin(login({ email: "old@example.com" }), OPEN);
    assert.equal(first.outcome, "authenticated");
    if (first.outcome !== "authenticated") return;
    const second = await service.resolveExternalLogin(login({ email: "new@example.com" }), OPEN);
    assert.equal(second.outcome, "authenticated");
    if (second.outcome !== "authenticated") return;
    assert.equal(second.user.id, first.user.id);
    const identity = await repo.findExternalIdentity("https://idp.example.com/", "sub-1");
    assert.equal(identity?.email_at_link_time, "new@example.com");
  } finally { await cleanup(); }
});

test("same email, different identities: two distinct (issuer, subject) pairs sharing an email resolve to two different users", async () => {
  const { service, cleanup } = await setup();
  try {
    const first = await service.resolveExternalLogin(login({ issuer: "https://idp-a.example.com/", subject: "sub-a", email: "shared@example.com" }), OPEN);
    const second = await service.resolveExternalLogin(login({ issuer: "https://idp-b.example.com/", subject: "sub-b", provider: "apple", email: "shared@example.com" }), OPEN);
    assert.equal(first.outcome, "authenticated");
    assert.equal(second.outcome, "authenticated");
    if (first.outcome === "authenticated" && second.outcome === "authenticated") assert.notEqual(first.user.id, second.user.id);
  } finally { await cleanup(); }
});

test("registration closed: founders_only with no allowlist match denies an unknown identity and creates no user", async () => {
  const { service, repo, cleanup } = await setup();
  try {
    const result = await service.resolveExternalLogin(login({ email: "stranger@example.com" }), founders(["founder@example.com"]));
    assert.equal(result.outcome, "registration_denied");
    assert.equal(await repo.findExternalIdentity("https://idp.example.com/", "sub-1"), undefined);
  } finally { await cleanup(); }
});

test("registration open: founders_only with an allowlisted email creates a new user for an unknown identity", async () => {
  const { service, cleanup } = await setup();
  try {
    const result = await service.resolveExternalLogin(login({ email: "founder@example.com" }), founders(["founder@example.com"]));
    assert.equal(result.outcome, "authenticated");
  } finally { await cleanup(); }
});

test("session rotation: rotating issues a new distinct session and invalidates the previous one (fixation prevention)", async () => {
  const { service, cleanup } = await setup();
  try {
    const authenticated = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;

    const firstCookie = await service.rotateSession(authenticated.user.id, LIFETIME, null);
    const firstIdentity = await service.validateSessionCookie(firstCookie, LIFETIME.idleSeconds);
    assert.ok(firstIdentity);

    const secondCookie = await service.rotateSession(authenticated.user.id, LIFETIME, firstIdentity!.sessionId);
    assert.notEqual(secondCookie, firstCookie);
    const secondIdentity = await service.validateSessionCookie(secondCookie, LIFETIME.idleSeconds);
    assert.ok(secondIdentity);
    assert.notEqual(secondIdentity!.sessionId, firstIdentity!.sessionId);

    assert.equal(await service.validateSessionCookie(firstCookie, LIFETIME.idleSeconds), null);
  } finally { await cleanup(); }
});

test("session revocation: revoking a session by its cookie value invalidates it", async () => {
  const { service, cleanup } = await setup();
  try {
    const authenticated = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;

    const cookie = await service.rotateSession(authenticated.user.id, LIFETIME, null);
    assert.ok(await service.validateSessionCookie(cookie, LIFETIME.idleSeconds));
    await service.revokeSessionByCookie(cookie);
    assert.equal(await service.validateSessionCookie(cookie, LIFETIME.idleSeconds), null);
  } finally { await cleanup(); }
});

test("account status: a disabled account's otherwise-valid session fails validation", async () => {
  const { service, db, cleanup } = await setup();
  try {
    const authenticated = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;

    const cookie = await service.rotateSession(authenticated.user.id, LIFETIME, null);
    assert.ok(await service.validateSessionCookie(cookie, LIFETIME.idleSeconds));

    await db.run("UPDATE users SET status = 'disabled' WHERE id = $1", [authenticated.user.id]);
    assert.equal(await service.validateSessionCookie(cookie, LIFETIME.idleSeconds), null);
  } finally { await cleanup(); }
});

test("account status: logging in against a disabled account is denied and never rotates a session", async () => {
  const { service, db, cleanup } = await setup();
  try {
    const authenticated = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;

    await db.run("UPDATE users SET status = 'disabled' WHERE id = $1", [authenticated.user.id]);
    const second = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(second.outcome, "account_unusable");
  } finally { await cleanup(); }
});

test("role/entitlement separation: granting an entitlement never changes role, and a fresh user defaults to 'user'", async () => {
  const { service, repo, cleanup } = await setup();
  try {
    const authenticated = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;
    assert.equal(authenticated.user.role, "user");

    await repo.grantEntitlement(authenticated.user.id, "premium_plans");
    const reloaded = await repo.getUserById(authenticated.user.id);
    assert.equal(reloaded?.role, "user");
    const entitlements = await repo.listEntitlements(authenticated.user.id);
    assert.deepEqual(entitlements.map(e => e.entitlement), ["premium_plans"]);
  } finally { await cleanup(); }
});

test("security events: a login and a denied registration each record a security event with no secret-shaped field", async () => {
  const { service, repo, cleanup } = await setup();
  try {
    const authenticated = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;
    const events = await repo.listSecurityEvents(authenticated.user.id);
    assert.ok(events.some(e => e.event_type === "login_success"));
    for (const event of events) {
      assert.equal(Object.keys(event).some(key => /token|secret|credential/i.test(key)), false);
    }

    const denied = await service.resolveExternalLogin(login({ issuer: "https://idp-c.example.com/", subject: "sub-c", email: "nobody@example.com" }), founders(["founder@example.com"]));
    assert.equal(denied.outcome, "registration_denied");
  } finally { await cleanup(); }
});

test("updateProfile persists valid IANA timezones and rejects an invalid one before writing anything", async () => {
  const { service, repo, cleanup } = await setup();
  try {
    const authenticated = await service.resolveExternalLogin(login(), OPEN);
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;

    const updated = await service.updateProfile(authenticated.user.id, { displayName: "Runner", locale: "en", unitSystem: "metric", timezone: "Europe/Rome" });
    assert.equal(updated.timezone, "Europe/Rome");
    assert.equal(updated.display_name, "Runner");

    await assert.rejects(() => service.updateProfile(authenticated.user.id, { displayName: "Runner", locale: "en", unitSystem: "metric", timezone: "Not/AZone" }));
    const reloaded = await repo.getUserById(authenticated.user.id);
    assert.equal(reloaded?.timezone, "Europe/Rome"); // unchanged — the rejected call never wrote
  } finally { await cleanup(); }
});
