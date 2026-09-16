import { createHash } from "node:crypto";
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import type { IdentityRepo } from "../repositories/identity.repo.ts";
import type { ProjectionResourceInput } from "../domain/publication/public-projection.ts";
import type { PublicationProjectionInput } from "./publication-lifecycle.service.ts";

// HRA-370: the authenticated publication orchestrator the HRA-359 ADR
// anticipated ("An authenticated publication orchestrator loads founder-owned
// inputs... Existing activity, plan, and reporting domain code computes all
// values") but that no earlier Story built — HRA-360 built only the lifecycle
// commands, never the input gathering they need to do anything.
//
// Deliberately narrow for this Story: profile + a bounded set of the
// founder's own recent activities. Plans/reports are omitted (empty arrays) —
// building their full projected shape needs the plan/reporting engines
// (HRA-113+/HRA-335+), which is out of this Story's narrow API/UI slice; the
// Guest UI already renders an empty plans/reports collection as a legitimate
// "not published" state, so nothing downstream breaks. See the HRA-370 review
// comment for this as a named, explicit deviation.
const RECENT_ACTIVITY_LIMIT = 30;

/**
 * The private revision coordinate is a content hash of the gathered
 * resources themselves, not a table timestamp: `activities` has no
 * `updated_at` column, and an edit (rename, reclassification) doesn't move
 * `activity_date`. Hashing the actual gathered content is exact — identical
 * content always yields the same coordinate (idempotent refresh), and any
 * real change is always detected — without depending on a column this schema
 * doesn't have.
 */
function contentSourceVersion(resources: readonly ProjectionResourceInput[]): string {
  return createHash("sha256").update(JSON.stringify(resources)).digest("hex");
}

export async function gatherFounderProjectionInput(
  userId: string,
  identity: IdentityRepo,
  activities: ActivitiesRepo,
): Promise<PublicationProjectionInput> {
  const resources: ProjectionResourceInput[] = [];

  const user = await identity.getUserById(userId);
  if (user) {
    resources.push({
      kind: "profile",
      sourceId: user.id,
      fields: { displayName: user.display_name, locale: user.locale, unitSystem: user.unit_system },
    });
  }

  const recent = await activities.recentForPublication(userId, RECENT_ACTIVITY_LIMIT) as Array<{
    id: number; activity_name: string | null; date_only: string; sport: string | null;
    duration_sec: number | null; moving_time_sec: number | null; distance_m: number | null;
    avg_pace_minkm: number | null; calories: number | null; avg_hr: number | null; max_hr: number | null;
    avg_cadence: number | null; ascent_m: number | null; descent_m: number | null;
  }>;
  for (const activity of recent) {
    resources.push({
      kind: "activity",
      sourceId: String(activity.id),
      fields: {
        title: activity.activity_name,
        date: activity.date_only,
        sport: activity.sport,
        durationSec: activity.duration_sec,
        movingTimeSec: activity.moving_time_sec,
        distanceM: activity.distance_m,
        avgPaceMinKm: activity.avg_pace_minkm,
        calories: activity.calories,
        avgHr: activity.avg_hr,
        maxHr: activity.max_hr,
        avgCadence: activity.avg_cadence,
        ascentM: activity.ascent_m,
        descentM: activity.descent_m,
      },
    });
  }

  return { sourceVersion: contentSourceVersion(resources), resources };
}
