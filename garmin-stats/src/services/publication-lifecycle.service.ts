import { FOUNDER_USER_ID, PUBLISH_PROFILE_ENTITLEMENT } from "../db/founder.ts";
import type { ProjectionResourceInput, PublicProjectionSnapshot } from "../domain/publication/public-projection.ts";
import type { IdentityRepo } from "../repositories/identity.repo.ts";
import type { PublicationState, PublicProjectionRepo } from "../repositories/public-projection.repo.ts";
import type { PublicProjectionService, RefreshPublicProjectionResult } from "./public-projection.service.ts";

export class PublicationForbiddenError extends Error {
  constructor() {
    super("Publication requires the controlled founder entitlement.");
    this.name = "PublicationForbiddenError";
  }
}

export interface PublicationProjectionInput {
  sourceVersion: string;
  resources: readonly ProjectionResourceInput[];
  now?: Date;
}

export interface PublicationLifecycleStatus {
  state: "draft" | "published" | "suspended" | "unconfigured";
  publicUrl: string | null;
  projectedAt: string | null;
  lastError: "projection_refresh_failed" | null;
  canRetry: boolean;
}

export interface PublicationPreview extends PublicationLifecycleStatus {
  snapshot: PublicProjectionSnapshot;
  sourceVersion: string;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicUrl(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`;
}

/**
 * The authenticated publication command boundary. Callers may supply only the
 * current actor's authoritative projection inputs; an owner id is never a
 * request-controlled publication target.
 */
export function createPublicationLifecycleService(
  identity: IdentityRepo,
  projection: PublicProjectionRepo,
  projector: PublicProjectionService,
  slugForUser: (userId: string) => string,
) {
  async function authorize(userId: string): Promise<void> {
    if (userId !== FOUNDER_USER_ID || !(await identity.hasEntitlement(userId, PUBLISH_PROFILE_ENTITLEMENT))) throw new PublicationForbiddenError();
  }

  async function refresh(userId: string, input: PublicationProjectionInput): Promise<RefreshPublicProjectionResult> {
    await authorize(userId);
    return projector.refresh({ sourceUserId: userId, slug: slugForUser(userId), ...input });
  }

  async function status(userId: string): Promise<PublicationLifecycleStatus> {
    await authorize(userId);
    const source = await projection.getStatusForUser(userId);
    if (!source) return { state: "unconfigured", publicUrl: null, projectedAt: null, lastError: null, canRetry: false };
    return {
      state: source.publication_state,
      publicUrl: publicUrl(source.public_slug),
      projectedAt: iso(source.projected_at),
      lastError: source.last_error === "projection_refresh_failed" ? source.last_error : null,
      canRetry: source.last_error === "projection_refresh_failed",
    };
  }

  async function preview(userId: string, input: PublicationProjectionInput): Promise<PublicationPreview> {
    await refresh(userId, input);
    const source = await projection.getStatusForUser(userId);
    if (!source?.payload || !source.source_version_hash) throw new Error("publication-lifecycle.service: refresh did not produce a snapshot");
    return { ...await status(userId), snapshot: source.payload, sourceVersion: source.source_version_hash };
  }

  async function publish(userId: string, input: PublicationProjectionInput): Promise<PublicationLifecycleStatus> {
    const result = await refresh(userId, input);
    await projection.setPublicationState(result.sourceId, "published");
    return status(userId);
  }

  async function suspend(userId: string): Promise<PublicationLifecycleStatus> {
    await authorize(userId);
    const source = await projection.getStatusForUser(userId);
    if (!source) return status(userId);
    await projection.setPublicationState(source.id, "suspended" satisfies PublicationState);
    return status(userId);
  }

  return { refresh, status, preview, publish, suspend };
}

export type PublicationLifecycleService = ReturnType<typeof createPublicationLifecycleService>;
