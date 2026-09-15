import {
  PUBLIC_PROJECTION_SCHEMA_VERSION,
  type PublicProjectedResource,
  type PublicProjectionSnapshot,
} from "../domain/publication/public-projection.ts";
import type { PublishedProjectionRepo, PublishedProjectionRead } from "../repositories/published-projection.repo.ts";

export interface GuestPublicationResource<T> {
  slug: string;
  projectedAt: string;
  data: T;
}

type GuestCollection = "activities" | "plans" | "reports";

function isProjectedResource(value: unknown): value is PublicProjectedResource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const resource = value as Partial<PublicProjectedResource>;
  return typeof resource.publicId === "string" && resource.fields !== null && typeof resource.fields === "object" && !Array.isArray(resource.fields);
}

function currentSnapshot(read: PublishedProjectionRead): PublicProjectionSnapshot | null {
  if (read.status !== "available") return null;
  const snapshot: unknown = read.snapshot;
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const candidate = snapshot as Partial<PublicProjectionSnapshot>;
  if (
    candidate.schemaVersion !== PUBLIC_PROJECTION_SCHEMA_VERSION ||
    candidate.slug !== read.slug ||
    candidate.sourceVersion !== read.sourceVersion ||
    candidate.projectedAt !== read.projectedAt ||
    (candidate.profile !== null && !isProjectedResource(candidate.profile)) ||
    !Array.isArray(candidate.activities) || !candidate.activities.every(isProjectedResource) ||
    !Array.isArray(candidate.plans) || !candidate.plans.every(isProjectedResource) ||
    !Array.isArray(candidate.reports) || !candidate.reports.every(isProjectedResource)
  ) return null;
  return candidate as PublicProjectionSnapshot;
}

function publicResource(resource: PublicProjectedResource): PublicProjectedResource {
  return { publicId: resource.publicId, fields: resource.fields };
}

/**
 * The anonymous application boundary. It has one dependency: the repository
 * backed by the published-only database view. Private repositories and owner
 * identifiers are deliberately not capabilities of this service.
 */
export function createGuestPublicationService(published: PublishedProjectionRepo) {
  async function read(slug: string): Promise<PublicProjectionSnapshot | null> {
    return currentSnapshot(await published.getBySlug(slug));
  }

  async function profile(slug: string): Promise<GuestPublicationResource<PublicProjectedResource> | null> {
    const snapshot = await read(slug);
    return snapshot?.profile
      ? { slug: snapshot.slug, projectedAt: snapshot.projectedAt, data: publicResource(snapshot.profile) }
      : null;
  }

  async function collection(slug: string, kind: GuestCollection): Promise<GuestPublicationResource<PublicProjectedResource[]> | null> {
    const snapshot = await read(slug);
    return snapshot
      ? { slug: snapshot.slug, projectedAt: snapshot.projectedAt, data: snapshot[kind].map(publicResource) }
      : null;
  }

  async function resource(slug: string, kind: GuestCollection, publicId: string): Promise<GuestPublicationResource<PublicProjectedResource> | null> {
    const result = await collection(slug, kind);
    const found = result?.data.find(item => item.publicId === publicId);
    return result && found ? { slug: result.slug, projectedAt: result.projectedAt, data: found } : null;
  }

  return { profile, collection, resource };
}

export type GuestPublicationService = ReturnType<typeof createGuestPublicationService>;
