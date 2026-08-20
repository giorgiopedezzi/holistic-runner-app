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
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../../src/config.ts";
import { createApiHandler } from "../../src/http/router.ts";
import { createActivitiesRepo } from "../../src/repositories/activities.repo.ts";
import { createBodyRepo } from "../../src/repositories/body.repo.ts";
import { createSettingsRepo } from "../../src/repositories/settings.repo.ts";
import { createDateRangesRepo } from "../../src/repositories/date-ranges.repo.ts";
import { createActivityTypesRepo } from "../../src/repositories/activity-types.repo.ts";
import { createPlanTemplatesRepo } from "../../src/repositories/plan-templates.repo.ts";
import { createPlanInstancesRepo } from "../../src/repositories/plan-instances.repo.ts";
import { createActivitiesService } from "../../src/services/activities.service.ts";
import { createBodyService } from "../../src/services/body.service.ts";
import { createClassificationService } from "../../src/services/classification.service.ts";
import { createSyncService } from "../../src/services/sync.service.ts";
import { createDeviceService } from "../../src/services/device.service.ts";
import { createPlanInstancesService } from "../../src/services/plan-instances.service.ts";
import { createTestDb, seedSampleData } from "./db.ts";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));

export interface TestServer {
  baseUrl: string;
  db: DatabaseSync;
  /** GET/POST/etc. helper returning { status, json }. Path starts with /api/... */
  api: (path: string, init?: RequestInit) => Promise<{ status: number; json: unknown; text: string }>;
  seed: () => { activityIds: number[] };
  close: () => Promise<void>;
}

export async function startTestServer(opts: { seed?: boolean } = {}): Promise<TestServer> {
  const { db, cleanup } = createTestDb();
  if (opts.seed) seedSampleData(db);

  const backgroundsDir = fs.mkdtempSync(path.join(os.tmpdir(), "hra-bg-"));

  const activitiesRepo = createActivitiesRepo(db);
  const bodyRepo = createBodyRepo(db);
  const settingsRepo = createSettingsRepo(db);
  const dateRangesRepo = createDateRangesRepo(db);
  const activityTypesRepo = createActivityTypesRepo(db);
  const planTemplatesRepo = createPlanTemplatesRepo(db);
  const planInstancesRepo = createPlanInstancesRepo(db);

  const handler = createApiHandler({
    port: 0,
    scriptsDir: SRC_DIR,
    backgroundsDir,
    config: loadConfig(),
    db,
    repos: {
      activities: activitiesRepo, body: bodyRepo, settings: settingsRepo, dateRanges: dateRangesRepo,
      activityTypes: activityTypesRepo, planTemplates: planTemplatesRepo, planInstances: planInstancesRepo,
    },
    services: {
      activities: createActivitiesService(db, activitiesRepo),
      body: createBodyService(db, bodyRepo),
      classification: createClassificationService(activitiesRepo),
      sync: createSyncService(SRC_DIR),
      device: createDeviceService(SRC_DIR),
      planInstances: createPlanInstancesService(db, planInstancesRepo),
    },
  });

  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr == null || typeof addr === "string") throw new Error("failed to bind test server");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const api: TestServer["api"] = async (p, init) => {
    const res = await fetch(baseUrl + p, init);
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
          cleanup();
          try { fs.rmSync(backgroundsDir, { recursive: true, force: true }); } catch { /* best effort */ }
          resolve();
        });
      }),
  };
}
