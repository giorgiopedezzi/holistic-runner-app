import { randomUUID } from "node:crypto";
import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import type { AccountPrivacyRepo } from "../repositories/account-privacy.repo.ts";
import type { IdentityRepo } from "../repositories/identity.repo.ts";

type ExportRecord = Record<string, unknown>;

export function createAccountPrivacyService(db: PostgresDatabase, account: AccountPrivacyRepo, identity: IdentityRepo) {
  async function requestExport(userId: string): Promise<{ id: string; expiresAt: string; secret: string }> {
    await account.cleanupExpiredExports();
    // The list is intentionally inventory-led rather than an ad-hoc UI list.
    // It includes every current private PostgreSQL aggregate and child, but no
    // provider tokens, opaque sessions, security-event payloads, or raw archives.
    const [user, settings, activities, trackPoints, body, ranges, templates, instances, workouts, days, associations, alignments] = await Promise.all([
      db.get<ExportRecord>("SELECT display_name, locale, unit_system, timezone, created_at, updated_at FROM users WHERE id = $1", [userId]),
      db.get<ExportRecord>("SELECT outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec, outlier_min_speed_kmh, theme, background_kind, background_value, unit_system, timezone, min_trend_group_size, activity_detail_view, accent_color, date_format, language, palette, updated_at FROM user_settings WHERE user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT * FROM activities WHERE user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT tp.* FROM track_points tp JOIN activities a ON a.id = tp.activity_id WHERE a.user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT * FROM body_measurements WHERE user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT * FROM date_ranges WHERE user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT * FROM plan_templates WHERE user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT * FROM plan_instances WHERE user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT * FROM plan_instance_workouts WHERE user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT * FROM plan_instance_days WHERE user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT * FROM workout_associations WHERE user_id = $1", [userId]),
      db.all<ExportRecord>("SELECT wsa.* FROM workout_segment_alignments wsa JOIN workout_associations wa ON wa.id = wsa.association_id WHERE wa.user_id = $1", [userId]),
    ]);
    const payload = {
      manifest: {
        format: "runs-free-personal-data-export", version: 1, generated_at: new Date().toISOString(),
        included: ["profile", "preferences", "activities", "track_points", "body_measurements", "date_ranges", "plan_templates", "plan_instances", "workout_associations"],
        unavailable: ["original_uploaded_fit_files", "previous_generated_exports"],
        excluded: ["sessions", "authentication_credentials", "integration_credentials", "external_identity_metadata", "security_event_payloads", "other_users_data", "common_lookup_data"],
      },
      data: { profile: user, preferences: settings, activities, track_points: trackPoints, body_measurements: body, date_ranges: ranges, plan_templates: templates, plan_instances: instances, plan_instance_workouts: workouts, plan_instance_days: days, workout_associations: associations, workout_segment_alignments: alignments },
    };
    const created = await account.createExport(userId, payload);
    await identity.recordSecurityEvent({ eventType: "personal_data_export_requested", userId, externalIssuer: null, externalSubject: null, detail: "snapshot_created" });
    return { id: created.row.id, expiresAt: created.row.expires_at, secret: created.secret };
  }

  async function requestDeletion(userId: string): Promise<{ id: string; status: string; requestedAt: string }> {
    const result = await db.transaction(async client => {
      const tx = clientQueryable(client);
      const repo = account.withDb(tx);
      const request = await repo.createDeletionRequest(randomUUID(), userId);
      await tx.run("UPDATE users SET status = 'deletion_pending', updated_at = now() WHERE id = $1", [userId]);
      await tx.run("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
      // Removing credentials and pending OAuth states prevents new sync/login
      // writes immediately; imported activities intentionally remain queued for
      // the durable deletion worker rather than being silently removed here.
      await tx.run("DELETE FROM withings_tokens WHERE user_id = $1", [userId]);
      await tx.run("DELETE FROM strava_tokens WHERE user_id = $1", [userId]);
      await tx.run("DELETE FROM oauth_states WHERE user_id = $1", [userId]);
      await identity.withDb(tx).recordSecurityEvent({ eventType: "account_deletion_requested", userId, externalIssuer: null, externalSubject: null, detail: "queued" });
      return request;
    });
    return { id: result!.id, status: result!.status, requestedAt: result!.requested_at };
  }

  // The queue is deliberately processed separately from acceptance: the
  // request can revoke access atomically and return promptly, while this
  // worker can retry a failed physical purge without ever reactivating the
  // account. Deleting the user is the ownership-inventory root operation;
  // PostgreSQL cascades every private aggregate and child while preserving
  // explicit common lookup data.
  async function processQueuedDeletions(limit = 25): Promise<void> {
    const queued = await db.all<{ id: string; user_id: string }>(
      "SELECT id, user_id FROM account_deletion_requests WHERE status IN ('queued', 'failed') ORDER BY requested_at LIMIT $1", [limit],
    );
    for (const item of queued) {
      try {
        await db.transaction(async client => {
          const tx = clientQueryable(client);
          const claimed = await tx.run(
            "UPDATE account_deletion_requests SET status = 'processing', attempts = attempts + 1, last_error = NULL, updated_at = now() WHERE id = $1 AND status IN ('queued', 'failed')",
            [item.id],
          );
          if (!claimed) return;
          await identity.withDb(tx).recordSecurityEvent({ eventType: "account_deleted", userId: item.user_id, externalIssuer: null, externalSubject: null, detail: "completed" });
          await tx.run("DELETE FROM users WHERE id = $1", [item.user_id]);
        });
      } catch {
        // Never retain database/provider details in a queue row. The user is
        // still deletion_pending, so a retry cannot restore normal access.
        await db.run("UPDATE account_deletion_requests SET status = 'failed', last_error = 'deletion worker failed', updated_at = now() WHERE id = $1", [item.id]);
      }
    }
  }

  async function recordExportDownloaded(userId: string, id: string): Promise<void> {
    await account.markDownloaded(id);
    await identity.recordSecurityEvent({ eventType: "personal_data_export_downloaded", userId, externalIssuer: null, externalSubject: null, detail: "downloaded" });
  }

  return { requestExport, requestDeletion, processQueuedDeletions, cleanupExpiredExports: account.cleanupExpiredExports, getExport: account.getExport, recordExportDownloaded };
}
export type AccountPrivacyService = ReturnType<typeof createAccountPrivacyService>;
