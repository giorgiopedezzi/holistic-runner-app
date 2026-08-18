/**
 * repositories/activities.repo.ts
 * Data access for activities + track points + the workout-classifier columns.
 * The ONLY layer that runs SQL for this domain (rest-api-standards §11). SQL moved
 * verbatim out of server.ts's `q` object (HRA-29) — behavior is identical. Exposes
 * intention-revealing methods, not raw prepared statements, to the layers above.
 */
import type { DatabaseSync } from "node:sqlite";

type NamedParams = Record<string, string | number | null>;

export function createActivitiesRepo(db: DatabaseSync) {
  const range        = db.prepare("SELECT MIN(date_only) AS min_date, MAX(date_only) AS max_date FROM activities WHERE deleted_at IS NULL");
  const activities   = db.prepare("SELECT id,filename,activity_date,date_only,sport,duration_sec,moving_time_sec,distance_m,avg_pace_minkm,calories,avg_hr,max_hr,avg_cadence,ascent_m,descent_m,avg_speed_ms,max_speed_ms,source,ai_classification,ai_explanation,statistical_classification,statistical_explanation,user_feedback,user_correction_reason,final_classification,classification_method,activity_type_id,activity_name FROM activities WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY activity_date DESC");
  const activitiesPage = db.prepare("SELECT id,filename,activity_date,date_only,sport,duration_sec,moving_time_sec,distance_m,avg_pace_minkm,calories,avg_hr,max_hr,avg_cadence,ascent_m,descent_m,avg_speed_ms,max_speed_ms,source,ai_classification,ai_explanation,statistical_classification,statistical_explanation,user_feedback,user_correction_reason,final_classification,classification_method,activity_type_id,activity_name FROM activities WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY activity_date DESC LIMIT ? OFFSET ?");
  const activityById = db.prepare("SELECT id,filename,activity_date,date_only,sport,duration_sec,moving_time_sec,distance_m,avg_pace_minkm,calories,avg_hr,max_hr,avg_cadence,ascent_m,descent_m,avg_speed_ms,max_speed_ms,source,ai_classification,ai_explanation,statistical_classification,statistical_explanation,user_feedback,user_correction_reason,final_classification,classification_method,activity_type_id,activity_name FROM activities WHERE id = ? AND deleted_at IS NULL");
  const summary      = db.prepare("SELECT sport,COUNT(*) AS total_activities,ROUND(SUM(distance_m)/1000,2) AS total_km,ROUND(SUM(duration_sec)/3600,2) AS total_hours,SUM(calories) AS total_calories,ROUND(AVG(avg_hr)) AS avg_hr,ROUND(AVG(avg_pace_minkm),2) AS avg_pace,ROUND(SUM(ascent_m)) AS total_ascent FROM activities WHERE date_only BETWEEN ? AND ? AND sport IS NOT NULL AND deleted_at IS NULL GROUP BY sport ORDER BY total_km DESC");
  const weekly       = db.prepare("SELECT strftime('%Y-W%W',date_only) AS week,COUNT(*) AS runs,ROUND(SUM(distance_m)/1000,2) AS km,ROUND(AVG(avg_hr)) AS avg_hr,ROUND(AVG(avg_pace_minkm),2) AS avg_pace FROM activities WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY week ORDER BY week");
  const monthly      = db.prepare("SELECT strftime('%Y-%m',date_only) AS month,COUNT(*) AS runs,ROUND(SUM(distance_m)/1000,2) AS km,ROUND(AVG(avg_hr)) AS avg_hr,ROUND(AVG(avg_pace_minkm),2) AS avg_pace,ROUND(SUM(ascent_m)) AS ascent FROM activities WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL GROUP BY month ORDER BY month");
  const track        = db.prepare("SELECT elapsed_sec,timestamp_unix,distance_m,heart_rate,speed_ms,cadence,altitude_m,temperature,power FROM track_points WHERE activity_id=? ORDER BY COALESCE(elapsed_sec,distance_m) ASC");

  // delete (soft) / trash / restore / purge
  const deleteActivitiesRange = db.prepare("UPDATE activities SET deleted_at = datetime('now') WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL");
  const deleteActivityById    = db.prepare("UPDATE activities SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL");
  const countInRange          = db.prepare("SELECT COUNT(*) AS count FROM activities WHERE date_only BETWEEN ? AND ? AND deleted_at IS NULL");
  const activitiesTrash       = db.prepare("SELECT id,filename,date_only,sport,distance_m,source,deleted_at FROM activities WHERE deleted_at IS NOT NULL AND purged = 0 ORDER BY deleted_at DESC");
  const activitiesTrashPage   = db.prepare("SELECT id,filename,date_only,sport,distance_m,source,deleted_at FROM activities WHERE deleted_at IS NOT NULL AND purged = 0 ORDER BY deleted_at DESC LIMIT ? OFFSET ?");
  const activitiesTrashCount  = db.prepare("SELECT COUNT(*) AS count FROM activities WHERE deleted_at IS NOT NULL AND purged = 0");
  const restoreActivityById   = db.prepare("UPDATE activities SET deleted_at = NULL WHERE id = ? AND purged = 0");
  const deleteTrackPointsByActivity = db.prepare("DELETE FROM track_points WHERE activity_id = ?");
  // Purge (empty the trash): wipes track_points + every heavy/summary column to
  // reclaim space, but deliberately keeps filename (+ date/sport/source) —
  // sync-garmin.ts's dedup check reads filenames unconditionally, so keeping it
  // is what stops a resync from reimporting a deliberately-deleted activity.
  const purgeActivityById = db.prepare(`
    UPDATE activities SET
      purged = 1, distance_m = NULL, avg_pace_minkm = NULL, calories = NULL,
      avg_hr = NULL, max_hr = NULL, avg_cadence = NULL, ascent_m = NULL,
      descent_m = NULL, avg_speed_ms = NULL, max_speed_ms = NULL,
      moving_time_sec = NULL, duration_sec = NULL
    WHERE id = ?
  `);

  // AI workout classifier + feedback. updateAi/updateStatistical each write only
  // their own method's column pair (running one never touches the other's stored
  // result) and both reset the four shared-verdict columns to NULL (a fresh/re-run
  // classification is "pending review" again). confirmById is the bulk thumbs-up:
  // it takes an explicit $source rather than guessing a slot.
  const classifyUpdateAi = db.prepare(`
    UPDATE activities SET
      ai_classification = $classification, ai_explanation = $explanation,
      user_feedback = NULL, user_correction_reason = NULL, final_classification = NULL, classification_method = NULL
    WHERE id = $id
  `);
  const classifyUpdateStatistical = db.prepare(`
    UPDATE activities SET
      statistical_classification = $classification, statistical_explanation = $explanation,
      user_feedback = NULL, user_correction_reason = NULL, final_classification = NULL, classification_method = NULL
    WHERE id = $id
  `);
  const feedbackUpdate = db.prepare(`
    UPDATE activities SET
      user_feedback = $user_feedback, user_correction_reason = $user_correction_reason,
      final_classification = $final_classification, classification_method = $classification_method
    WHERE id = $id
  `);
  const updateActivityType = db.prepare("UPDATE activities SET activity_type_id = $activity_type_id, activity_name = $activity_name WHERE id = $id");
  const confirmActivityById = db.prepare(`
    UPDATE activities SET
      user_feedback = 'approved',
      final_classification = CASE WHEN $source = 'ai' THEN ai_classification ELSE statistical_classification END,
      classification_method = $source,
      user_correction_reason = NULL
    WHERE id = $id
      AND (CASE WHEN $source = 'ai' THEN ai_classification ELSE statistical_classification END) IS NOT NULL
  `);

  return {
    dateRange:    () => range.get(),
    list:         (from: string, to: string) => activities.all(from, to),
    listPage:     (from: string, to: string, limit: number, offset: number) => activitiesPage.all(from, to, limit, offset),
    byId:         (id: number) => activityById.get(id),
    summary:      (from: string, to: string) => summary.all(from, to),
    weekly:       (from: string, to: string) => weekly.all(from, to),
    monthly:      (from: string, to: string) => monthly.all(from, to),
    track:        (id: number) => track.all(id),
    countInRange: (from: string, to: string) => countInRange.get(from, to),
    trash:        () => activitiesTrash.all(),
    trashPage:    (limit: number, offset: number) => activitiesTrashPage.all(limit, offset),
    trashCount:   () => activitiesTrashCount.get(),
    softDeleteRange:  (from: string, to: string) => deleteActivitiesRange.run(from, to),
    softDeleteById:   (id: number) => deleteActivityById.run(id),
    restoreById:      (id: number) => restoreActivityById.run(id),
    deleteTrackPoints:(id: number) => deleteTrackPointsByActivity.run(id),
    purgeById:        (id: number) => purgeActivityById.run(id),
    updateAiClassification:          (p: NamedParams) => classifyUpdateAi.run(p),
    updateStatisticalClassification: (p: NamedParams) => classifyUpdateStatistical.run(p),
    updateFeedback:   (p: NamedParams) => feedbackUpdate.run(p),
    confirmById:      (p: NamedParams) => confirmActivityById.run(p),
    updateType:       (p: NamedParams) => updateActivityType.run(p),
  };
}

export type ActivitiesRepo = ReturnType<typeof createActivitiesRepo>;
