import { randomUUID } from "node:crypto";
import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import {
  buildPublicProjectionSnapshot,
  hashPublicSourceVersion,
  type ProjectionResourceInput,
} from "../domain/publication/public-projection.ts";
import type { PublicProjectionRepo } from "../repositories/public-projection.repo.ts";

export interface RefreshPublicProjectionInput {
  sourceUserId: string;
  slug: string;
  /** Private authoritative revision coordinates; only their digest is stored. */
  sourceVersion: string;
  /** Values must come from existing domain services; this service never recalculates them. */
  resources: readonly ProjectionResourceInput[];
  now?: Date;
}

export type RefreshPublicProjectionResult =
  | { status: "unchanged"; sourceId: string; sourceVersion: string }
  | { status: "updated"; sourceId: string; sourceVersion: string; projectedAt: string };

export function createPublicProjectionService(db: PostgresDatabase, projection: PublicProjectionRepo) {
  async function refresh(input: RefreshPublicProjectionInput): Promise<RefreshPublicProjectionResult> {
    const source = await projection.ensureSource(randomUUID(), input.sourceUserId, input.slug);
    if (!source) throw new Error("public-projection.service: source upsert did not return a row");
    if (source.public_slug !== input.slug) throw new Error("A public projection slug is immutable");
    const sourceVersion = hashPublicSourceVersion(source.id, input.sourceVersion);
    const existing = await projection.getSnapshot(source.id);
    if (existing?.payload && existing.source_version_hash === sourceVersion) {
      return { status: "unchanged", sourceId: source.id, sourceVersion };
    }

    const projectedAt = (input.now ?? new Date()).toISOString();
    try {
      await db.transaction(async client => {
        const tx = projection.withDb(clientQueryable(client));
        const publicIds = new Map<string, string>();
        for (const resource of input.resources) {
          const key = `${resource.kind}:${resource.sourceId}`;
          const publicId = await tx.getOrCreatePublicId(source.id, resource.kind, resource.sourceId, randomUUID());
          publicIds.set(key, publicId);
        }
        const snapshot = buildPublicProjectionSnapshot({
          slug: source.public_slug,
          sourceVersion,
          projectedAt,
          resources: input.resources,
          publicIds,
        });
        await tx.saveSnapshot(source.id, sourceVersion, snapshot, projectedAt);
      });
    } catch (error) {
      // Record only a fixed safe label. The previous snapshot is intentionally
      // untouched by the failed transaction and remains the only public value.
      await projection.recordFailure(source.id);
      throw error;
    }
    return { status: "updated", sourceId: source.id, sourceVersion, projectedAt };
  }

  return { refresh };
}

export type PublicProjectionService = ReturnType<typeof createPublicProjectionService>;
