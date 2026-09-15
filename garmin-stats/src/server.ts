/**
 * server.ts
 * Local REST API backed by PostgreSQL.
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
import { loadConfig, getArg, validateAuthConfig } from "./config.ts";
import { openPostgresDatabase } from "./db/postgres.ts";
import { createApiHandler } from "./http/router.ts";
import { startWithingsCallbackServer } from "./http/withings-callback.ts";
import { createActivitiesRepo } from "./repositories/activities.repo.ts";
import { createBodyRepo } from "./repositories/body.repo.ts";
import { createSettingsRepo } from "./repositories/settings.repo.ts";
import { createDateRangesRepo } from "./repositories/date-ranges.repo.ts";
import { createActivityTypesRepo } from "./repositories/activity-types.repo.ts";
import { createPlanTemplatesRepo } from "./repositories/plan-templates.repo.ts";
import { createPlanInstancesRepo } from "./repositories/plan-instances.repo.ts";
import { createFeedbackRepo } from "./repositories/feedback.repo.ts";
import { createWorkoutAssociationsRepo } from "./repositories/workout-associations.repo.ts";
import { createWorkoutSegmentAlignmentsRepo } from "./repositories/workout-segment-alignments.repo.ts";
import { createIdentityRepo } from "./repositories/identity.repo.ts";
import { createAccountPrivacyRepo } from "./repositories/account-privacy.repo.ts";
import { createPublishedProjectionRepo } from "./repositories/published-projection.repo.ts";
import { createActivitiesService } from "./services/activities.service.ts";
import { createBodyService } from "./services/body.service.ts";
import { createClassificationService } from "./services/classification.service.ts";
import { createSyncService } from "./services/sync.service.ts";
import { createDeviceService } from "./services/device.service.ts";
import { createPlanInstancesService } from "./services/plan-instances.service.ts";
import { createWorkoutAssociationsService } from "./services/workout-associations.service.ts";
import { createReportingService } from "./services/reporting.service.ts";
import { createIdentityService } from "./services/identity.service.ts";
import { createAccountPrivacyService } from "./services/account-privacy.service.ts";
import { createGuestPublicationService } from "./services/guest-publication.service.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const config = loadConfig();
const PORT   = parseInt(getArg("--port") ?? "3001");

// HRA-356 AC2: fail closed at boot when AUTH_ENABLED carries a missing,
// placeholder, cross-environment, insecure, or contradictory configuration —
// never only on the first real user's login attempt.
validateAuthConfig(config);

const db = openPostgresDatabase();
// `pg` pools connect lazily. Probe before binding HTTP ports so a startup log
// never claims the local API is usable when DATABASE_URL is invalid.
await db.get<{ ok: number }>("SELECT 1 AS ok");

// Hosted-demo self-heal: periodically reset the DB back to a pristine backup
// copy (see jobs/demo-db-restore.ts). Gated only on the backup path being
// configured — independent of demoMode (a write-guard concern), so this
// works even with DEMO_MODE unset/false. Unset in every other environment.
if (process.env.DEMO_DB_BACKUP_PATH) throw new Error("DEMO_DB_BACKUP_PATH is not supported by the PostgreSQL runtime.");

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
const planTemplatesRepo = createPlanTemplatesRepo(db);
const planInstancesRepo = createPlanInstancesRepo(db);
const feedbackRepo      = createFeedbackRepo(db);
const workoutAssociationsRepo = createWorkoutAssociationsRepo(db);
const workoutSegmentAlignmentsRepo = createWorkoutSegmentAlignmentsRepo(db);
const identityRepo = createIdentityRepo(db);
const accountPrivacyRepo = createAccountPrivacyRepo(db);
const publishedProjectionRepo = createPublishedProjectionRepo(db);

// ── services (business logic — no http, no SQL of their own) ─────────────────
const activitiesService     = createActivitiesService(db, activitiesRepo);
const bodyService           = createBodyService(db, bodyRepo);
const classificationService = createClassificationService(db, activitiesRepo);
const syncService           = createSyncService(__dirname);
const deviceService   = createDeviceService(__dirname);
const planInstancesService  = createPlanInstancesService(db, planInstancesRepo);
const workoutAssociationsService = createWorkoutAssociationsService(db);
const reportingService = createReportingService(db, planInstancesRepo, workoutAssociationsRepo, activitiesRepo, workoutSegmentAlignmentsRepo);
const identityService = createIdentityService(db, identityRepo);
const accountPrivacyService = createAccountPrivacyService(db, accountPrivacyRepo, identityRepo);
const guestPublicationService = createGuestPublicationService(publishedProjectionRepo);

// HRA-354: queued account deletion is deliberately asynchronous so access is
// revoked before physical purge. Failures stay durable and retry on the next
// pass; never turn a failed deletion back into a usable account.
setInterval(() => { void accountPrivacyService.processQueuedDeletions(); void accountPrivacyService.cleanupExpiredExports(); }, 60_000).unref();

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
    activityTypes: activityTypesRepo, planTemplates: planTemplatesRepo, planInstances: planInstancesRepo,
    feedback: feedbackRepo, workoutAssociations: workoutAssociationsRepo,
    workoutSegmentAlignments: workoutSegmentAlignmentsRepo,
    identity: identityRepo, accountPrivacy: accountPrivacyRepo,
  },
  services: {
    activities: activitiesService, body: bodyService, classification: classificationService,
    sync: syncService, device: deviceService, planInstances: planInstancesService,
    workoutAssociations: workoutAssociationsService, reporting: reportingService,
    identity: identityService, accountPrivacy: accountPrivacyService, guestPublication: guestPublicationService,
  },
}));

server.listen(PORT, "0.0.0.0", () => {
  console.log("=== Garmin Stats — API Server ===\n");
  console.log(`Listening on http://0.0.0.0:${PORT}/api/v1/`);
  console.log("\nCtrl+C to stop.");
});
