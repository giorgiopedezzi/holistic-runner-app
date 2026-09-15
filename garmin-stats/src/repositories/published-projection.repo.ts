import type { Queryable } from "../db/query.ts";
import type { PublicProjectionSnapshot } from "../domain/publication/public-projection.ts";

interface PublishedProjectionRow {
  public_slug: string;
  source_version: string;
  payload: PublicProjectionSnapshot;
  projected_at: Date | string;
}

export type PublishedProjectionRead =
  | { status: "available"; slug: string; sourceVersion: string; projectedAt: string; snapshot: PublicProjectionSnapshot }
  | { status: "unavailable" };

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * The entire anonymous persistence capability: one parameterized read from a
 * database view that contains no owner or private-source columns.
 */
export function createPublishedProjectionRepo(db: Queryable) {
  return {
    async getBySlug(slug: string): Promise<PublishedProjectionRead> {
      const row = await db.get<PublishedProjectionRow>(
        `SELECT public_slug, source_version, payload, projected_at
         FROM published_public_projections WHERE public_slug = $1`,
        [slug],
      );
      return row
        ? { status: "available", slug: row.public_slug, sourceVersion: row.source_version, projectedAt: iso(row.projected_at), snapshot: row.payload }
        : { status: "unavailable" };
    },
  };
}

export type PublishedProjectionRepo = ReturnType<typeof createPublishedProjectionRepo>;
