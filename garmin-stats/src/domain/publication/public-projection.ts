import { createHmac } from "node:crypto";

export const PUBLIC_PROJECTION_SCHEMA_VERSION = 1 as const;

export type PublicResourceKind = "profile" | "activity" | "plan" | "report";

export interface ProjectionResourceInput {
  kind: PublicResourceKind;
  /** Private identity used only to resolve its stable random public UUID. */
  sourceId: string;
  /** Source values already produced by the existing owner/domain services. */
  fields: Readonly<Record<string, unknown>>;
}

export interface PublicProjectedResource {
  publicId: string;
  fields: Record<string, PublicJson>;
}

export type PublicJson = null | boolean | number | string | PublicJson[] | { [key: string]: PublicJson };

export interface PublicProjectionSnapshot {
  schemaVersion: typeof PUBLIC_PROJECTION_SCHEMA_VERSION;
  slug: string;
  sourceVersion: string;
  projectedAt: string;
  profile: PublicProjectedResource | null;
  activities: PublicProjectedResource[];
  plans: PublicProjectedResource[];
  reports: PublicProjectedResource[];
}

/**
 * The complete top-level publication allowlist. Adding a field is a security
 * decision and must arrive with redaction tests; unknown fields fail closed by
 * being omitted.
 */
export const PUBLIC_FIELD_ALLOWLIST: Readonly<Record<PublicResourceKind, readonly string[]>> = {
  profile: ["displayName", "bio", "avatarUrl", "locale", "unitSystem"],
  activity: [
    "title", "date", "sport", "durationSec", "movingTimeSec", "distanceM",
    "avgPaceMinKm", "calories", "avgHr", "maxHr", "avgCadence", "ascentM",
    "descentM", "track",
  ],
  plan: ["name", "event", "raceName", "raceDate", "startDate", "weeks", "workouts"],
  report: [
    "kind", "range", "generatedAt", "asOf", "datasets", "comparisons",
    "denominators", "coverage", "evidence", "qualityEvidence",
  ],
};

/** Key fragments that must never survive at any depth in a public snapshot. */
export const PROHIBITED_PUBLIC_KEY_FRAGMENTS = [
  "authorization", "cookie", "credential", "device", "email", "externalidentity",
  "filename", "filepath", "latitude", "location", "longitude", "note", "password",
  "path", "payload", "provider", "secret", "session", "subject", "token",
] as const;

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export function isProhibitedPublicKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (normalized === "publicid") return false;
  if (normalized === "id" || /(?:Id|ID)$/.test(key) || /(?:^|[_-])id$/i.test(key)) return true;
  if (normalized === "lat" || normalized === "lon" || normalized === "lng") return true;
  return PROHIBITED_PUBLIC_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment));
}

function sanitizePublicValue(value: unknown, seen: Set<object>): PublicJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Public projection values must contain only finite numbers");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Public projection values must be JSON-compatible");
  if (seen.has(value)) throw new TypeError("Public projection values must not be cyclic");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => sanitizePublicValue(item, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("Public projection values must contain plain objects only");
    }
    const sanitized: Record<string, PublicJson> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (!isProhibitedPublicKey(key)) sanitized[key] = sanitizePublicValue(nested, seen);
    }
    return sanitized;
  } finally {
    seen.delete(value);
  }
}

export function projectPublicFields(kind: PublicResourceKind, fields: Readonly<Record<string, unknown>>): Record<string, PublicJson> {
  const projected: Record<string, PublicJson> = {};
  for (const key of PUBLIC_FIELD_ALLOWLIST[kind]) {
    if (Object.hasOwn(fields, key)) projected[key] = sanitizePublicValue(fields[key], new Set());
  }
  return projected;
}

/**
 * Hashing prevents private revision coordinates from becoming public metadata.
 * The digest is still deterministic, so retry/idempotency comparisons remain
 * exact without exposing activity, plan, or database versions.
 */
export function hashPublicSourceVersion(privateNamespace: string, sourceVersion: string): string {
  if (!privateNamespace) throw new TypeError("A private source namespace is required");
  if (!sourceVersion) throw new TypeError("A non-empty authoritative source version is required");
  return createHmac("sha256", privateNamespace).update(sourceVersion).digest("hex");
}

export function buildPublicProjectionSnapshot(input: {
  slug: string;
  sourceVersion: string;
  projectedAt: string;
  resources: readonly ProjectionResourceInput[];
  publicIds: ReadonlyMap<string, string>;
}): PublicProjectionSnapshot {
  const grouped: Record<PublicResourceKind, PublicProjectedResource[]> = {
    profile: [], activity: [], plan: [], report: [],
  };
  const seenResources = new Set<string>();
  for (const resource of input.resources) {
    const resourceKey = `${resource.kind}:${resource.sourceId}`;
    if (seenResources.has(resourceKey)) throw new Error(`Duplicate public projection resource: ${resource.kind}`);
    seenResources.add(resourceKey);
    const publicId = input.publicIds.get(resourceKey);
    if (!publicId) throw new Error(`Missing public identifier for ${resource.kind}`);
    grouped[resource.kind].push({ publicId, fields: projectPublicFields(resource.kind, resource.fields) });
  }
  if (grouped.profile.length > 1) throw new Error("A public projection may contain at most one profile");
  return {
    schemaVersion: PUBLIC_PROJECTION_SCHEMA_VERSION,
    slug: input.slug,
    sourceVersion: input.sourceVersion,
    projectedAt: input.projectedAt,
    profile: grouped.profile[0] ?? null,
    activities: grouped.activity,
    plans: grouped.plan,
    reports: grouped.report,
  };
}
