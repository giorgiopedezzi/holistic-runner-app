/**
 * server.ts
 * Local REST API — uses node:sqlite (Node 24 native).
 * Usage: node src/server.ts [-- --port 3001]
 *
 * Wiring only: open the DB, build the repositories + services, start the two HTTP
 * servers (:3001 API via http/router.ts, :3002 Withings OAuth callback), and
 * listen. All request handling lives in controllers/ + http/.
 */
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { loadConfig, getArg } from "./config.ts";
import { openDb, initSchema } from "./db.ts";
import { createApiHandler } from "./http/router.ts";
import { startWithingsCallbackServer } from "./http/withings-callback.ts";
import { createActivitiesRepo } from "./repositories/activities.repo.ts";
import { createBodyRepo } from "./repositories/body.repo.ts";
import { createSettingsRepo } from "./repositories/settings.repo.ts";
import { createDateRangesRepo } from "./repositories/date-ranges.repo.ts";
import { createActivityTypesRepo } from "./repositories/activity-types.repo.ts";
import { createTrainingPlansRepo } from "./repositories/training-plans.repo.ts";
import { createPlannedWorkoutsRepo } from "./repositories/planned-workouts.repo.ts";
import { createActivitiesService } from "./services/activities.service.ts";
import { createBodyService } from "./services/body.service.ts";
import { createClassificationService } from "./services/classification.service.ts";
import { createSyncService } from "./services/sync.service.ts";
import { createDeviceService } from "./services/device.service.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const config = loadConfig();
const PORT   = parseInt(getArg("--port") ?? "3001");

const db = openDb();
initSchema(db);

// Custom-uploaded backgrounds land here (gitignored). Created up front so the
// settings controller can read/write it.
const backgroundsDir = path.resolve(__dirname, "../backgrounds");
if (!fs.existsSync(backgroundsDir)) fs.mkdirSync(backgroundsDir, { recursive: true });

// ── repositories (data-access layer — the only layer that runs SQL) ─────────
const activitiesRepo = createActivitiesRepo(db);
const bodyRepo       = createBodyRepo(db);
const settingsRepo   = createSettingsRepo(db);
const dateRangesRepo = createDateRangesRepo(db);
const activityTypesRepo = createActivityTypesRepo(db);
const trainingPlansRepo = createTrainingPlansRepo(db);
const plannedWorkoutsRepo = createPlannedWorkoutsRepo(db);

// ── services (business logic — no http, no SQL of their own) ─────────────────
const activitiesService     = createActivitiesService(db, activitiesRepo);
const bodyService           = createBodyService(db, bodyRepo);
const classificationService = createClassificationService(activitiesRepo);
const syncService           = createSyncService(__dirname);
const deviceService   = createDeviceService(__dirname);

// ── always-on Withings OAuth callback server (port 3002) ─────────────────────
startWithingsCallbackServer(config, db);

// ── main API server (port 3001) ─────────────────────────────────────────────
const server = http.createServer(createApiHandler({
  port: PORT,
  scriptsDir: __dirname,
  backgroundsDir,
  config,
  db,
  repos: {
    activities: activitiesRepo, body: bodyRepo, settings: settingsRepo, dateRanges: dateRangesRepo,
    activityTypes: activityTypesRepo, trainingPlans: trainingPlansRepo, plannedWorkouts: plannedWorkoutsRepo,
  },
  services: {
    activities: activitiesService, body: bodyService, classification: classificationService,
    sync: syncService, device: deviceService,
  },
}));

server.listen(PORT, "127.0.0.1", () => {
  console.log("=== Garmin Stats — API Server ===\n");
  console.log(`Listening on http://127.0.0.1:${PORT}/api/v1/`);
  console.log("\nCtrl+C to stop.");
});
