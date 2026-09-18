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

      if (row.manual_classification === LEGACY_TAPASCIATA_LABEL) {
        await createOwnedActivitiesRepo(db, row.user_id).updateManualClassification({ $id: row.id, $classification: "tapasciata" });
        overridesMapped++;
      } else if (
        row.manual_classification != null &&
        !(ACTUAL_RUNNING_CLASSIFICATIONS as readonly string[]).includes(row.manual_classification)
      ) {
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

void main();
