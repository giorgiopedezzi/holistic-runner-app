/**
 * One-time maintenance script (HRA-394): recompute system_classification for
 * every active running activity through the new actual-running classifier
 * (domain/stats-classifier.ts's classifyByStatistics, via the same
 * classification.service.ts operation the POST /classify route uses — never
 * a blind label-similarity rename), and normalize manual_classification so
 * no active running activity is left on the retired vocabulary.
 *
 * Run once per environment after deploying HRA-394:
 *   npm run backfill:actual-classification
 */
import { pathToFileURL } from "node:url";
import { openPostgresDatabase } from "../db/postgres.ts";
import { createActivitiesRepo } from "../repositories/activities.repo.ts";
import { createOwnedActivitiesRepo } from "../repositories/owned-activities.repo.ts";
import { createClassificationService } from "../services/classification.service.ts";
import { ACTUAL_RUNNING_CLASSIFICATIONS } from "../domain/stats-classifier.ts";

const CLASSIFY_SPLIT_METERS = 1000;
// The only legacy manual label with an explicit, safe semantic equivalence
// to a canonical key — every other legacy label (Recovery Run, Long Session,
// Repeats/Intervals, Fartlek, Progressive Run) is cleared instead of
// translated by name similarity, per this Story's explicit instruction.
const LEGACY_TAPASCIATA_LABEL = "Tapasciata / Light Maintenance";

interface Row {
  id: number;
  user_id: string;
  manual_classification: string | null;
}

export type LegacyManualOverrideResolution = "map-to-tapasciata" | "clear" | "keep";

// Pure decision, exported for unit testing without a database — never a
// blind label-similarity translation. The only legacy manual label with an
// explicit, safe semantic equivalence to a canonical key is the exact legacy
// Tapasciata spelling; every other legacy label (Recovery Run, Long Session,
// Repeats/Intervals, Fartlek, Progressive Run) or already-canonical/null
// value is handled without guessing.
export function resolveLegacyManualOverride(manualClassification: string | null): LegacyManualOverrideResolution {
  if (manualClassification === LEGACY_TAPASCIATA_LABEL) return "map-to-tapasciata";
  if (manualClassification == null || (ACTUAL_RUNNING_CLASSIFICATIONS as readonly string[]).includes(manualClassification)) return "keep";
  return "clear";
}

async function main(): Promise<void> {
  const db = openPostgresDatabase();
  try {
    const classification = createClassificationService(db, createActivitiesRepo(db));
    const rows = await db.all<Row>(
      "SELECT id, user_id, manual_classification FROM activities WHERE sport='running' AND deleted_at IS NULL ORDER BY user_id, id",
    );

    let recomputed = 0;
    let overridesMapped = 0;
    let overridesCleared = 0;

    for (const row of rows) {
      await classification.classify(row.user_id, row.id, CLASSIFY_SPLIT_METERS);
      recomputed++;

      const resolution = resolveLegacyManualOverride(row.manual_classification);
      if (resolution === "map-to-tapasciata") {
        await createOwnedActivitiesRepo(db, row.user_id).updateManualClassification({ $id: row.id, $classification: "tapasciata" });
        overridesMapped++;
      } else if (resolution === "clear") {
        await createOwnedActivitiesRepo(db, row.user_id).clearManualClassification(row.id);
        overridesCleared++;
      }
    }

    console.log(
      `Recomputed system_classification for ${recomputed} running activit${recomputed === 1 ? "y" : "ies"}; ` +
      `mapped ${overridesMapped} manual override(s) to tapasciata; cleared ${overridesCleared} obsolete manual override(s).`,
    );
  } finally {
    await db.close();
  }
}

// Explicit entry-point guard — resolveLegacyManualOverride above is imported
// directly by test/jobs/backfill-actual-classification.test.ts, which must
// not trigger a real database connection merely by importing this module.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) void main();
