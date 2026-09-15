import type { Queryable } from "../db/query.ts";
import type { PublicProjectionSnapshot, PublicResourceKind } from "../domain/publication/public-projection.ts";

export type PublicationState = "draft" | "published" | "suspended";

export interface PublicProjectionSourceRow {
  id: string;
  source_user_id: string;
  public_slug: string;
  publication_state: PublicationState;
}

interface SnapshotRow {
  source_version_hash: string | null;
  payload: PublicProjectionSnapshot | null;
  projected_at: Date | string | null;
  last_error: string | null;
}

export interface PublicProjectionStatusRow extends PublicProjectionSourceRow, SnapshotRow {}

export function createPublicProjectionRepo(db: Queryable) {
  return {
    ensureSource: (id: string, sourceUserId: string, slug: string) => db.get<PublicProjectionSourceRow>(
      `INSERT INTO public_projection_sources (id, source_user_id, public_slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_user_id) DO UPDATE
       SET updated_at = public_projection_sources.updated_at
       RETURNING id, source_user_id, public_slug, publication_state`,
      [id, sourceUserId, slug],
    ),
    getSnapshot: (sourceId: string) => db.get<SnapshotRow>(
      `SELECT source_version_hash, payload, projected_at, last_error
       FROM public_projection_snapshots WHERE source_id = $1`,
      [sourceId],
    ),
    getStatusForUser: (sourceUserId: string) => db.get<PublicProjectionStatusRow>(
      `SELECT source.id, source.source_user_id, source.public_slug, source.publication_state,
              snapshot.source_version_hash, snapshot.payload, snapshot.projected_at, snapshot.last_error
       FROM public_projection_sources source
       LEFT JOIN public_projection_snapshots snapshot ON snapshot.source_id = source.id
       WHERE source.source_user_id = $1`,
      [sourceUserId],
    ),
    getOrCreatePublicId: async (sourceId: string, kind: PublicResourceKind, sourceResourceId: string, publicId: string) => {
      const row = await db.get<{ public_id: string }>(
        `INSERT INTO public_projection_identifiers (source_id, resource_kind, source_resource_id, public_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_id, resource_kind, source_resource_id) DO UPDATE
         SET source_resource_id = EXCLUDED.source_resource_id
         RETURNING public_id::text`,
        [sourceId, kind, sourceResourceId, publicId],
      );
      if (!row) throw new Error("public-projection.repo: identifier upsert did not return a row");
      return row.public_id;
    },
    saveSnapshot: (sourceId: string, sourceVersion: string, payload: PublicProjectionSnapshot, projectedAt: string) => db.run(
      `INSERT INTO public_projection_snapshots
         (source_id, source_version_hash, payload, projected_at, last_attempted_at, last_error)
       VALUES ($1, $2, $3::jsonb, $4, $4, NULL)
       ON CONFLICT (source_id) DO UPDATE SET
         source_version_hash = EXCLUDED.source_version_hash,
         payload = EXCLUDED.payload,
         projected_at = EXCLUDED.projected_at,
         last_attempted_at = EXCLUDED.last_attempted_at,
         last_error = NULL`,
      [sourceId, sourceVersion, JSON.stringify(payload), projectedAt],
    ),
    recordFailure: (sourceId: string) => db.run(
      `INSERT INTO public_projection_snapshots (source_id, last_attempted_at, last_error)
       VALUES ($1, now(), 'projection_refresh_failed')
       ON CONFLICT (source_id) DO UPDATE SET
         last_attempted_at = EXCLUDED.last_attempted_at,
         last_error = EXCLUDED.last_error`,
      [sourceId],
    ),
    setPublicationState: (sourceId: string, state: PublicationState) => db.run(
      "UPDATE public_projection_sources SET publication_state = $2, updated_at = now() WHERE id = $1",
      [sourceId, state],
    ),
    withDb: (query: Queryable) => createPublicProjectionRepo(query),
  };
}

export type PublicProjectionRepo = ReturnType<typeof createPublicProjectionRepo>;
