/**
 * http/context.ts
 * The application context passed to every controller — the wired-up dependencies
 * (config, db, repositories, services, and the two resolved directories). Built
 * once in server.ts. Controllers read what they need from it; they never reach for
 * module-level singletons. Also the shared controller Handler signature.
 */
import type http from "http";
import type { URL } from "url";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.ts";
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import type { BodyRepo } from "../repositories/body.repo.ts";
import type { SettingsRepo } from "../repositories/settings.repo.ts";
import type { ActivitiesService } from "../services/activities.service.ts";
import type { BodyService } from "../services/body.service.ts";
import type { ClassificationService } from "../services/classification.service.ts";
import type { SyncService } from "../services/sync.service.ts";
import type { IntegrationsService } from "../services/integrations.service.ts";

export interface AppContext {
  port: number;          // used by the router to build the URL base
  scriptsDir: string;    // where the sync/device scripts live (src/)
  backgroundsDir: string;
  config: Config;
  db: DatabaseSync;
  repos: { activities: ActivitiesRepo; body: BodyRepo; settings: SettingsRepo };
  services: {
    activities: ActivitiesService;
    body: BodyService;
    classification: ClassificationService;
    sync: SyncService;
    integrations: IntegrationsService;
  };
}

// A controller handler: given the request, response, and the already-parsed URL,
// it writes the response. May be sync or async; the router awaits it so a thrown
// error still lands in the top-level 500 handler.
export type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void | Promise<void>;
