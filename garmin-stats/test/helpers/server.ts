/**
 * test/helpers/server.ts  (HRA-61)
 * Spins up the real API pipeline (http/router → controllers → services →
 * repositories) over a fresh in-memory DB, on an ephemeral port, so integration
 * tests can hit it with fetch() exactly like the dashboard does.
 *
 * Same wiring as src/server.ts, minus the Withings callback server and the
 * process-global config/port. scriptsDir points at the real src/ so the sync/
 * device services resolve job paths correctly — but tests never call the
 * sync/classify routes (they spawn / hit Ollama), so no external I/O occurs.
 */
import http from "node:http";
import { createHmac } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PostgresDatabase } from "../../src/db/postgres.ts";
import { loadConfig } from "../../src/config.ts";
import { createApiHandler } from "../../src/http/router.ts";
import { createActivitiesRepo } from "../../src/repositories/activities.repo.ts";
import { createBodyRepo } from "../../src/repositories/body.repo.ts";
import { createSettingsRepo } from "../../src/repositories/settings.repo.ts";
import { createDateRangesRepo } from "../../src/repositories/date-ranges.repo.ts";
import { createActivityTypesRepo } from "../../src/repositories/activity-types.repo.ts";
import { createPlanTemplatesRepo } from "../../src/repositories/plan-templates.repo.ts";
import { createPlanInstancesRepo } from "../../src/repositories/plan-instances.repo.ts";
import { createFeedbackRepo } from "../../src/repositories/feedback.repo.ts";
import { createWorkoutAssociationsRepo } from "../../src/repositories/workout-associations.repo.ts";
import { createWorkoutSegmentAlignmentsRepo } from "../../src/repositories/workout-segment-alignments.repo.ts";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createAccountPrivacyRepo } from "../../src/repositories/account-privacy.repo.ts";
import { createPublishedProjectionRepo } from "../../src/repositories/published-projection.repo.ts";
import { createPublicProjectionRepo } from "../../src/repositories/public-projection.repo.ts";
import { createActivitiesService } from "../../src/services/activities.service.ts";
import { createBodyService } from "../../src/services/body.service.ts";
import { createClassificationService } from "../../src/services/classification.service.ts";
import { createSyncService } from "../../src/services/sync.service.ts";
import { createDeviceService } from "../../src/services/device.service.ts";
import { createPlanInstancesService } from "../../src/services/plan-instances.service.ts";
import { createWorkoutAssociationsService } from "../../src/services/workout-associations.service.ts";
import { createReportingService } from "../../src/services/reporting.service.ts";
import { createIdentityService } from "../../src/services/identity.service.ts";
import { createAccountPrivacyService } from "../../src/services/account-privacy.service.ts";
import { createGuestPublicationService } from "../../src/services/guest-publication.service.ts";
import { createPublicProjectionService } from "../../src/services/public-projection.service.ts";
import { createPublicationLifecycleService } from "../../src/services/publication-lifecycle.service.ts";
import { createFitImportService } from "../../src/services/fit-import.service.ts";
import { FOUNDER_PUBLIC_SLUG } from "../../src/db/founder.ts";
import { FOUNDER_USER_ID } from "../../src/db/founder.ts";
import { createTestDb, seedSampleData } from "./db.ts";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));

export interface TestServer {
  baseUrl: string;
  db: PostgresDatabase;
  /** GET/POST/etc. helper returning { status, json }. Path starts with /api/... */
  api: (path: string, init?: RequestInit) => Promise<{ status: number; json: unknown; text: string }>;
  seed: () => Promise<{ activityIds: number[] }>;
  close: () => Promise<void>;
}

export async function startTestServer(opts: { seed?: boolean; demoMode?: boolean } = {}): Promise<TestServer> {
  const { db, cleanup } = await createTestDb();
  const runtimeDb = db;
  if (opts.seed) await seedSampleData(db);

  const backgroundsDir = fs.mkdtempSync(path.join(os.tmpdir(), "hra-bg-"));

  const activitiesRepo = createActivitiesRepo(runtimeDb);
  const bodyRepo = createBodyRepo(runtimeDb);
  const settingsRepo = createSettingsRepo(runtimeDb);
  const dateRangesRepo = createDateRangesRepo(runtimeDb);
  const activityTypesRepo = createActivityTypesRepo(runtimeDb);
  const planTemplatesRepo = createPlanTemplatesRepo(runtimeDb);
  const planInstancesRepo = createPlanInstancesRepo(runtimeDb);
  const feedbackRepo = createFeedbackRepo(runtimeDb);
  const workoutAssociationsRepo = createWorkoutAssociationsRepo(runtimeDb);
  const workoutSegmentAlignmentsRepo = createWorkoutSegmentAlignmentsRepo(runtimeDb);
  const identityRepo = createIdentityRepo(runtimeDb);
  const accountPrivacyRepo = createAccountPrivacyRepo(runtimeDb);
  const publishedProjectionRepo = createPublishedProjectionRepo(runtimeDb);
  const publicProjectionRepo = createPublicProjectionRepo(runtimeDb);
  const identityService = createIdentityService(runtimeDb, identityRepo);
  const accountPrivacyService = createAccountPrivacyService(runtimeDb, accountPrivacyRepo, identityRepo);
  const founderSession = await identityService.rotateSession(FOUNDER_USER_ID, { idleSeconds: 1800, absoluteSeconds: 43200 }, null);

  const handler = createApiHandler({
    port: 0,
    scriptsDir: SRC_DIR,
    backgroundsDir,
    // demoMode override (HRA-220) — opts.demoMode lets a test flip DEMO_MODE
    // without an env var, since loadConfig() reads process.env at call time.
    config: { ...loadConfig(), demoMode: opts.demoMode ?? loadConfig().demoMode, auth: { ...loadConfig().auth, enabled: true, allowedOrigins: ["http://test.invalid"] } },
    db: runtimeDb,
    repos: {
      activities: activitiesRepo, body: bodyRepo, settings: settingsRepo, dateRanges: dateRangesRepo,
      activityTypes: activityTypesRepo, planTemplates: planTemplatesRepo, planInstances: planInstancesRepo,
      feedback: feedbackRepo, workoutAssociations: workoutAssociationsRepo,
      workoutSegmentAlignments: workoutSegmentAlignmentsRepo,
      identity: identityRepo, accountPrivacy: accountPrivacyRepo,
    },
    services: {
      activities: createActivitiesService(runtimeDb, activitiesRepo),
      body: createBodyService(runtimeDb, bodyRepo),
      classification: createClassificationService(runtimeDb, activitiesRepo),
      sync: createSyncService(SRC_DIR),
      device: createDeviceService(SRC_DIR),
      planInstances: createPlanInstancesService(runtimeDb, planInstancesRepo),
      workoutAssociations: createWorkoutAssociationsService(runtimeDb),
      reporting: createReportingService(runtimeDb, planInstancesRepo, workoutAssociationsRepo, activitiesRepo, workoutSegmentAlignmentsRepo),
      identity: identityService, accountPrivacy: accountPrivacyService,
      guestPublication: createGuestPublicationService(publishedProjectionRepo),
      publicationLifecycle: createPublicationLifecycleService(
        identityRepo, publicProjectionRepo, createPublicProjectionService(runtimeDb, publicProjectionRepo), () => FOUNDER_PUBLIC_SLUG,
      ),
      fitImport: createFitImportService(runtimeDb),
    },
  });

  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const addr = server.address();
  if (addr == null || typeof addr === "string") throw new Error("failed to bind test server");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const api: TestServer["api"] = async (p, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("cookie")) headers.set("cookie", `__Host-runsfree_session=${founderSession}`);
    headers.set("origin", "http://test.invalid");
    if (!["GET", "HEAD"].includes((init?.method ?? "GET").toUpperCase())) {
      const session = /(?:__Host-runsfree_session|runsfree_session)=([^;]+)/.exec(headers.get("cookie") ?? "")?.[1] ?? founderSession;
      headers.set("x-runsfree-csrf", createHmac("sha256", "runsfree-session-csrf-v1").update(decodeURIComponent(session)).digest("base64url"));
    }
    const res = await fetch(baseUrl + p, { ...init, headers });
    const text = await res.text();
    let json: unknown = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON body */ }
    return { status: res.status, json, text };
  };

  return {
    baseUrl,
    db,
    api,
    seed: () => seedSampleData(db),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          void cleanup().then(() => {
            try { fs.rmSync(backgroundsDir, { recursive: true, force: true }); } catch { /* best effort */ }
            resolve();
          });
        });
      }),
  };
}
