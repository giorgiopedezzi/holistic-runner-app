import type http from "http";
import { isProhibitedPublicKey } from "../domain/publication/public-projection.ts";
import { requestAccessContext } from "./auth-context.ts";

// Existing UI routes use these internal identifiers to address founder-owned
// activities and plans. They are safe only because the HTTP boundary fixes the
// owner to FOUNDER_USER_ID and every repository lookup retains that owner
// predicate. All other identity-shaped keys remain fail-closed.
const APPROVED_INTERNAL_IDS = new Set([
  "id",
  "activity_id",
  "activity_type_id",
  "day_id",
  "instance_id",
  "template_id",
  "target_activity_id",
  "workout_id",
]);

function sanitize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => sanitize(item, seen));
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) throw new TypeError("Founder-public responses must not contain cycles.");

  seen.add(value);
  try {
    const safe: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      // `source` identifies Garmin/Strava provider provenance on activity rows;
      // it is not part of the reviewed public sporting contract. Compound
      // domain fields such as report.actualSource remain intact.
      if (key === "source") continue;
      if (!APPROVED_INTERNAL_IDS.has(key) && isProhibitedPublicKey(key)) continue;
      safe[key] = sanitize(nested, seen);
    }
    return safe;
  } finally {
    seen.delete(value);
  }
}

/** Preserve authenticated response contracts; redact only founder-public data. */
export function founderPublicResponse(req: http.IncomingMessage, value: unknown): unknown {
  return requestAccessContext(req).kind === "founder-public" ? sanitize(value, new Set()) : value;
}
