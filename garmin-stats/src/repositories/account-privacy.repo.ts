import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Queryable } from "../db/query.ts";

export interface AccountExportRow {
  id: string; user_id: string; payload: unknown; download_secret_hash: string;
  expires_at: string; downloaded_at: string | null; created_at: string;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function createAccountPrivacyRepo(db: Queryable) {
  return {
    async createExport(userId: string, payload: unknown): Promise<{ row: AccountExportRow; secret: string }> {
      const id = randomUUID();
      const secret = randomBytes(32).toString("base64url");
      const row = await db.get<AccountExportRow>(
        `INSERT INTO account_exports (id, user_id, payload, download_secret_hash, expires_at)
         VALUES ($1, $2, $3::jsonb, $4, now() + interval '24 hours')
         RETURNING id, user_id, payload, download_secret_hash, expires_at, downloaded_at, created_at`,
        [id, userId, JSON.stringify(payload), hash(secret)],
      );
      if (!row) throw new Error("account-privacy.repo: export insert did not return a row");
      return { row, secret };
    },
    getExport: (id: string, userId: string, secret: string) => db.get<AccountExportRow>(
      `SELECT id, user_id, payload, download_secret_hash, expires_at, downloaded_at, created_at
       FROM account_exports
       WHERE id = $1 AND user_id = $2 AND download_secret_hash = $3 AND expires_at > now()`,
      [id, userId, hash(secret)],
    ),
    markDownloaded: (id: string) => db.run("UPDATE account_exports SET downloaded_at = now() WHERE id = $1", [id]),
    cleanupExpiredExports: () => db.run("DELETE FROM account_exports WHERE expires_at <= now()"),
    getDeletionRequest: (userId: string) => db.get<{ id: string; status: string; requested_at: string }>(
      "SELECT id, status, requested_at FROM account_deletion_requests WHERE user_id = $1", [userId],
    ),
    createDeletionRequest: (id: string, userId: string) => db.get<{ id: string; status: string; requested_at: string }>(
      `INSERT INTO account_deletion_requests (id, user_id) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = account_deletion_requests.updated_at
       RETURNING id, status, requested_at`, [id, userId],
    ),
    withDb: (query: Queryable) => createAccountPrivacyRepo(query),
  };
}
export type AccountPrivacyRepo = ReturnType<typeof createAccountPrivacyRepo>;
