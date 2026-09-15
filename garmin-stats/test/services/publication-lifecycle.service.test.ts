import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { FOUNDER_USER_ID, PUBLISH_PROFILE_ENTITLEMENT } from "../../src/db/founder.ts";
import type { ProjectionResourceInput } from "../../src/domain/publication/public-projection.ts";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createPublishedProjectionRepo } from "../../src/repositories/published-projection.repo.ts";
import { createPublicProjectionRepo } from "../../src/repositories/public-projection.repo.ts";
import { createPublicationLifecycleService, PublicationForbiddenError } from "../../src/services/publication-lifecycle.service.ts";
import { createPublicProjectionService } from "../../src/services/public-projection.service.ts";
import { createTestDb } from "../helpers/db.ts";

const slugForUser = (_userId: string) => "founder-journey";

function resources(distanceM = 12_345): ProjectionResourceInput[] {
  return [{ kind: "profile", sourceId: FOUNDER_USER_ID, fields: { displayName: "Founder Runner", email: "private@example.com" } }, {
    kind: "activity", sourceId: "42", fields: { title: "Sunday long run", date: "2026-09-13", sport: "running", distanceM },
  }];
}

test("controlled founder lifecycle previews, publishes, suspends, and retries the guest projection", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const identity = createIdentityRepo(db);
    const projection = createPublicProjectionRepo(db);
    const guest = createPublishedProjectionRepo(db);
    const lifecycle = createPublicationLifecycleService(identity, projection, createPublicProjectionService(db, projection), slugForUser);

    assert.equal(await identity.hasEntitlement(FOUNDER_USER_ID, PUBLISH_PROFILE_ENTITLEMENT), true);
    assert.deepEqual(await lifecycle.status(FOUNDER_USER_ID), {
      state: "unconfigured", publicUrl: null, projectedAt: null, lastError: null, canRetry: false,
    });

    const preview = await lifecycle.preview(FOUNDER_USER_ID, {
      sourceVersion: "revision-1", resources: resources(), now: new Date("2026-09-15T12:30:00.000Z"),
    });
    assert.equal(preview.state, "draft");
    assert.equal(preview.publicUrl, "/p/founder-journey");
    assert.equal(preview.snapshot.profile?.fields.displayName, "Founder Runner");
    assert.equal(preview.snapshot.profile?.fields.email, undefined);
    assert.deepEqual(await guest.getBySlug("founder-journey"), { status: "unavailable" });

    const published = await lifecycle.publish(FOUNDER_USER_ID, {
      sourceVersion: "revision-1", resources: resources(), now: new Date("2026-09-15T12:31:00.000Z"),
    });
    assert.equal(published.state, "published");
    const publicRead = await guest.getBySlug("founder-journey");
    assert.equal(publicRead.status, "available");
    if (publicRead.status !== "available") return;
    assert.deepEqual(publicRead.snapshot, preview.snapshot);

    const invalid = resources();
    invalid[1]!.fields = { ...invalid[1]!.fields, distanceM: 12_345n };
    await assert.rejects(() => lifecycle.refresh(FOUNDER_USER_ID, { sourceVersion: "revision-2", resources: invalid }), /JSON-compatible/);
    assert.deepEqual(await guest.getBySlug("founder-journey"), publicRead);
    assert.deepEqual(await lifecycle.status(FOUNDER_USER_ID), {
      state: "published", publicUrl: "/p/founder-journey", projectedAt: "2026-09-15T12:30:00.000Z", lastError: "projection_refresh_failed", canRetry: true,
    });

    await lifecycle.refresh(FOUNDER_USER_ID, {
      sourceVersion: "revision-2", resources: resources(22_222), now: new Date("2026-09-15T13:00:00.000Z"),
    });
    assert.equal((await lifecycle.status(FOUNDER_USER_ID)).lastError, null);
    const afterRetry = await guest.getBySlug("founder-journey");
    assert.equal(afterRetry.status, "available");
    if (afterRetry.status !== "available") return;
    assert.equal(afterRetry.snapshot.activities[0]?.fields.distanceM, 22_222);

    assert.equal((await lifecycle.suspend(FOUNDER_USER_ID)).state, "suspended");
    assert.deepEqual(await guest.getBySlug("founder-journey"), { status: "unavailable" });
    assert.equal((await projection.getSnapshot((await projection.getStatusForUser(FOUNDER_USER_ID))!.id))?.payload?.activities[0]?.fields.distanceM, 22_222);
  } finally {
    await cleanup();
  }
});

test("ordinary and cross-user publication attempts are rejected before they can create a source", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const identity = createIdentityRepo(db);
    const projection = createPublicProjectionRepo(db);
    const lifecycle = createPublicationLifecycleService(identity, projection, createPublicProjectionService(db, projection), slugForUser);
    const ordinaryUserId = randomUUID();
    await db.run("INSERT INTO users (id) VALUES ($1)", [ordinaryUserId]);
    await db.run("INSERT INTO user_settings (user_id) VALUES ($1)", [ordinaryUserId]);

    assert.equal(await identity.hasEntitlement(ordinaryUserId, PUBLISH_PROFILE_ENTITLEMENT), false);
    await assert.rejects(() => lifecycle.publish(ordinaryUserId, { sourceVersion: "revision-1", resources: resources() }), PublicationForbiddenError);
    await identity.grantEntitlement(ordinaryUserId, PUBLISH_PROFILE_ENTITLEMENT);
    await assert.rejects(() => lifecycle.publish(ordinaryUserId, { sourceVersion: "revision-1", resources: resources() }), PublicationForbiddenError);
    await assert.rejects(() => lifecycle.suspend(ordinaryUserId), PublicationForbiddenError);
    assert.equal(await projection.getStatusForUser(ordinaryUserId), undefined);
  } finally {
    await cleanup();
  }
});
