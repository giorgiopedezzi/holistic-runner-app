/**
 * repositories/body.repo.ts
 * Data access for Withings body measurements + the training-km/weight correlation.
 * The ONLY layer that runs SQL for this domain (rest-api-standards §11). SQL moved
 * verbatim out of server.ts's `q` object (HRA-29) — behavior is identical.
 */
import type { DatabaseSync } from "node:sqlite";

export function createBodyRepo(db: DatabaseSync) {
  const bodyRange   = db.prepare("SELECT MIN(date_only) AS min_date, MAX(date_only) AS max_date FROM body_measurements WHERE deleted_at IS NULL");
  const bodyList    = db.prepare("SELECT measured_at,date_only,weight_kg,fat_ratio,fat_mass_kg,muscle_mass_kg,hydration_kg,bone_mass_kg,bmi,heart_rate FROM body_measurements WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY measured_at ASC");
  const bodyListPage = db.prepare("SELECT measured_at,date_only,weight_kg,fat_ratio,fat_mass_kg,muscle_mass_kg,hydration_kg,bone_mass_kg,bmi,heart_rate FROM body_measurements WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY measured_at ASC LIMIT ? OFFSET ?");
  const bodyMonthly = db.prepare("SELECT strftime('%Y-%m',date_only) AS month,ROUND(AVG(weight_kg),2) AS avg_weight,ROUND(MIN(weight_kg),2) AS min_weight,ROUND(MAX(weight_kg),2) AS max_weight,ROUND(AVG(fat_ratio),1) AS avg_fat_ratio,ROUND(AVG(muscle_mass_kg),2) AS avg_muscle_mass FROM body_measurements WHERE date_only BETWEEN ? AND ? AND weight_kg IS NOT NULL AND deleted_at IS NULL GROUP BY month ORDER BY month");
  const bodyDeleteRange  = db.prepare("UPDATE body_measurements SET deleted_at = datetime('now') WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL");
  const bodyCountInRange = db.prepare("SELECT COUNT(*) AS count FROM body_measurements WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL");
  const bodyTrash        = db.prepare("SELECT id,measured_at,date_only,weight_kg,deleted_at FROM body_measurements WHERE deleted_at IS NOT NULL AND purged = 0 ORDER BY deleted_at DESC");
  const bodyTrashPage    = db.prepare("SELECT id,measured_at,date_only,weight_kg,deleted_at FROM body_measurements WHERE deleted_at IS NOT NULL AND purged = 0 ORDER BY deleted_at DESC LIMIT ? OFFSET ?");
  const bodyTrashCount   = db.prepare("SELECT COUNT(*) AS count FROM body_measurements WHERE deleted_at IS NOT NULL AND purged = 0");
  const restoreBodyById  = db.prepare("UPDATE body_measurements SET deleted_at = NULL WHERE id = ? AND purged = 0");
  // Keeps measured_at (blocks sync-withings.ts's INSERT OR IGNORE from
  // resurrecting it) + date_only; wipes every actual measurement value.
  const purgeBodyById = db.prepare(`
    UPDATE body_measurements SET
      purged = 1, weight_kg = NULL, fat_ratio = NULL, fat_mass_kg = NULL,
      muscle_mass_kg = NULL, hydration_kg = NULL, bone_mass_kg = NULL,
      bmi = NULL, heart_rate = NULL
    WHERE id = ?
  `);
  const correlation = db.prepare("SELECT a.week,a.km,a.avg_hr,a.runs,ROUND(AVG(b.weight_kg),2) AS avg_weight,ROUND(AVG(b.fat_ratio),1) AS avg_fat_ratio FROM (SELECT strftime('%Y-W%W',date_only) AS week,ROUND(SUM(distance_m)/1000,2) AS km,ROUND(AVG(avg_hr)) AS avg_hr,COUNT(*) AS runs FROM activities WHERE date_only BETWEEN ? AND ? AND sport='running' AND deleted_at IS NULL GROUP BY week) a LEFT JOIN body_measurements b ON strftime('%Y-W%W',b.date_only)=a.week AND b.deleted_at IS NULL GROUP BY a.week ORDER BY a.week");

  return {
    dateRange:    () => bodyRange.get(),
    list:         (from: string, to: string) => bodyList.all(from, to),
    listPage:     (from: string, to: string, limit: number, offset: number) => bodyListPage.all(from, to, limit, offset),
    monthly:      (from: string, to: string) => bodyMonthly.all(from, to),
    countInRange: (from: string, to: string) => bodyCountInRange.get(from, to),
    trash:        () => bodyTrash.all(),
    trashPage:    (limit: number, offset: number) => bodyTrashPage.all(limit, offset),
    trashCount:   () => bodyTrashCount.get(),
    correlation:  (from: string, to: string) => correlation.all(from, to),
    softDeleteRange: (from: string, to: string) => bodyDeleteRange.run(from, to),
    restoreById:  (id: number) => restoreBodyById.run(id),
    purgeById:    (id: number) => purgeBodyById.run(id),
  };
}

export type BodyRepo = ReturnType<typeof createBodyRepo>;
