import type { Queryable } from "../db/query.ts";
import type { FitActivity, FitTrackPoint } from "../domain/fit-parser.ts";

type NamedParams = Record<string, string | number | null>;

const FIELDS = "id,filename,activity_date,date_only,sport,duration_sec,moving_time_sec,distance_m,avg_pace_minkm,calories,avg_hr,max_hr,avg_cadence,ascent_m,descent_m,avg_speed_ms,max_speed_ms,source,ai_classification,ai_explanation,statistical_classification,statistical_explanation,user_feedback,user_correction_reason,final_classification,classification_method,activity_type_id,activity_name";

// Private activity access is deliberately exposed only through this factory.
// The owner is an explicit, required input and is present in every WHERE
// clause, including track-point access through its owning activity.
export function createOwnedActivitiesRepo(db: Queryable, userId: string) {
  return {
    insertGarminActivity: (activity: FitActivity) => db.get<{ id: number }>(`INSERT INTO activities
      (user_id,filename,activity_date,date_only,sport,duration_sec,distance_m,avg_pace_minkm,calories,avg_hr,max_hr,avg_cadence,ascent_m,descent_m,avg_speed_ms,max_speed_ms,source,moving_time_sec)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'garmin',$17)
      ON CONFLICT (user_id,filename) DO NOTHING RETURNING id`,
      [userId, activity.filename, activity.activity_date, activity.date_only, activity.sport, activity.duration_sec, activity.distance_m,
        activity.avg_pace_minkm, activity.calories, activity.avg_hr, activity.max_hr, activity.avg_cadence, activity.ascent_m,
        activity.descent_m, activity.avg_speed_ms, activity.max_speed_ms, activity.moving_time_sec]),
    insertTrackPoint: (activityId: number, point: FitTrackPoint) => db.run(`INSERT INTO track_points
      (activity_id,elapsed_sec,timestamp_unix,distance_m,heart_rate,speed_ms,cadence,altitude_m,temperature,power,lat,lon,stamina)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [activityId, point.elapsed_sec, point.timestamp_unix, point.distance_m, point.heart_rate, point.speed_ms, point.cadence,
        point.altitude_m, point.temperature, point.power, point.lat, point.lon, point.stamina]),
    dateRange: () => db.get("SELECT MIN(date_only) AS min_date, MAX(date_only) AS max_date FROM activities WHERE user_id=$1 AND deleted_at IS NULL", [userId]),
    list: (from: string, to: string) => db.all(`SELECT ${FIELDS} FROM activities WHERE user_id=$1 AND date_only BETWEEN $2 AND $3 AND deleted_at IS NULL ORDER BY activity_date DESC`, [userId, from, to]),
    listPage: (from: string, to: string, limit: number, offset: number) => db.all(`SELECT ${FIELDS} FROM activities WHERE user_id=$1 AND date_only BETWEEN $2 AND $3 AND deleted_at IS NULL ORDER BY activity_date DESC LIMIT $4 OFFSET $5`, [userId, from, to, limit, offset]),
    byId: (id: number) => db.get(`SELECT ${FIELDS} FROM activities WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL`, [userId, id]),
    // ::float8 on every ROUND(...)::numeric — Postgres's numeric type comes
    // back from `pg` as a JS string (precision-preserving default), not a
    // number; the frontend's totals math (OverviewTab.tsx) assumes real
    // numbers (HRA-358). ::numeric is still needed internally for ROUND's
    // 2-arg form; ::float8 on the outside converts the result back to a
    // native double before it leaves the query.
    summary: (from: string, to: string) => db.all("SELECT sport,COUNT(*)::int AS total_activities,ROUND((SUM(distance_m)/1000)::numeric,2)::float8 AS total_km,ROUND((SUM(duration_sec)/3600)::numeric,2)::float8 AS total_hours,SUM(calories)::int AS total_calories,ROUND(AVG(avg_hr))::int AS avg_hr,ROUND(AVG(avg_pace_minkm)::numeric,2)::float8 AS avg_pace,ROUND(SUM(ascent_m)) AS total_ascent FROM activities WHERE user_id=$1 AND date_only BETWEEN $2 AND $3 AND sport IS NOT NULL AND deleted_at IS NULL GROUP BY sport ORDER BY total_km DESC", [userId, from, to]),
    weekly: (from: string, to: string) => db.all("SELECT to_char(to_date(date_only, 'YYYY-MM-DD'), 'IYYY-\"W\"IW') AS week,COUNT(*)::int AS runs,ROUND((SUM(distance_m)/1000)::numeric,2)::float8 AS km,ROUND(AVG(avg_hr))::int AS avg_hr,ROUND(AVG(avg_pace_minkm)::numeric,2)::float8 AS avg_pace FROM activities WHERE user_id=$1 AND date_only BETWEEN $2 AND $3 AND deleted_at IS NULL GROUP BY week ORDER BY week", [userId, from, to]),
    monthly: (from: string, to: string) => db.all("SELECT substring(date_only, 1, 7) AS month,COUNT(*)::int AS runs,ROUND((SUM(distance_m)/1000)::numeric,2)::float8 AS km,ROUND(AVG(avg_hr))::int AS avg_hr,ROUND(AVG(avg_pace_minkm)::numeric,2)::float8 AS avg_pace,ROUND(SUM(ascent_m)) AS ascent FROM activities WHERE user_id=$1 AND date_only BETWEEN $2 AND $3 AND deleted_at IS NULL GROUP BY month ORDER BY month", [userId, from, to]),
    track: (id: number) => db.all("SELECT p.elapsed_sec,p.timestamp_unix,p.distance_m,p.heart_rate,p.speed_ms,p.cadence,p.altitude_m,p.temperature,p.power,p.stamina FROM track_points p JOIN activities a ON a.id=p.activity_id WHERE a.user_id=$1 AND p.activity_id=$2 AND a.deleted_at IS NULL ORDER BY COALESCE(p.elapsed_sec,p.distance_m) ASC", [userId, id]),
    countInRange: (from: string, to: string) => db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM activities WHERE user_id=$1 AND date_only BETWEEN $2 AND $3 AND deleted_at IS NULL", [userId, from, to]),
    trash: () => db.all("SELECT id,filename,date_only,sport,distance_m,source,deleted_at FROM activities WHERE user_id=$1 AND deleted_at IS NOT NULL AND purged=false ORDER BY deleted_at DESC", [userId]),
    trashPage: (limit: number, offset: number) => db.all("SELECT id,filename,date_only,sport,distance_m,source,deleted_at FROM activities WHERE user_id=$1 AND deleted_at IS NOT NULL AND purged=false ORDER BY deleted_at DESC LIMIT $2 OFFSET $3", [userId, limit, offset]),
    trashCount: () => db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM activities WHERE user_id=$1 AND deleted_at IS NOT NULL AND purged=false", [userId]),
    softDeleteRange: (from: string, to: string) => db.run("UPDATE activities SET deleted_at=to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') WHERE user_id=$1 AND date_only BETWEEN $2 AND $3 AND deleted_at IS NULL", [userId, from, to]),
    softDeleteById: (id: number) => db.run("UPDATE activities SET deleted_at=to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL", [userId, id]),
    restoreById: (id: number) => db.run("UPDATE activities SET deleted_at=NULL WHERE user_id=$1 AND id=$2 AND purged=false", [userId, id]),
    deleteTrackPoints: (id: number) => db.run("DELETE FROM track_points p USING activities a WHERE p.activity_id=a.id AND a.user_id=$1 AND p.activity_id=$2", [userId, id]),
    purgeById: (id: number) => db.run("UPDATE activities SET purged=true,distance_m=NULL,avg_pace_minkm=NULL,calories=NULL,avg_hr=NULL,max_hr=NULL,avg_cadence=NULL,ascent_m=NULL,descent_m=NULL,avg_speed_ms=NULL,max_speed_ms=NULL,moving_time_sec=NULL,duration_sec=NULL WHERE user_id=$1 AND id=$2", [userId, id]),
    updateAiClassification: (p: NamedParams) => db.run("UPDATE activities SET ai_classification=$1,ai_explanation=$2,user_feedback=NULL,user_correction_reason=NULL,final_classification=NULL,classification_method=NULL WHERE user_id=$3 AND id=$4", [p.$classification, p.$explanation, userId, p.$id]),
    updateStatisticalClassification: (p: NamedParams) => db.run("UPDATE activities SET statistical_classification=$1,statistical_explanation=$2,user_feedback=NULL,user_correction_reason=NULL,final_classification=NULL,classification_method=NULL WHERE user_id=$3 AND id=$4", [p.$classification, p.$explanation, userId, p.$id]),
    updateFeedback: (p: NamedParams) => db.run("UPDATE activities SET user_feedback=$1,user_correction_reason=$2,final_classification=$3,classification_method=$4 WHERE user_id=$5 AND id=$6", [p.$user_feedback,p.$user_correction_reason,p.$final_classification,p.$classification_method,userId,p.$id]),
    confirmById: (p: NamedParams) => db.run("UPDATE activities SET user_feedback='approved',final_classification=CASE WHEN $1='ai' THEN ai_classification ELSE statistical_classification END,classification_method=$1,user_correction_reason=NULL WHERE user_id=$2 AND id=$3 AND (CASE WHEN $1='ai' THEN ai_classification ELSE statistical_classification END) IS NOT NULL", [p.$source,userId,p.$id]),
    updateType: (p: NamedParams) => db.run("UPDATE activities SET activity_type_id=$1,activity_name=$2 WHERE user_id=$3 AND id=$4", [p.$activity_type_id,p.$activity_name,userId,p.$id]),
    races: (limit: number, offset: number) => db.all("SELECT id,date_only,activity_type_id,activity_name,distance_m FROM activities WHERE user_id=$1 AND activity_type_id!=1 AND deleted_at IS NULL ORDER BY date_only DESC LIMIT $2 OFFSET $3", [userId,limit,offset]),
    racesCount: () => db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM activities WHERE user_id=$1 AND activity_type_id!=1 AND deleted_at IS NULL", [userId]),
    runningActivitiesForAssociation: () => db.all<{ id: number; activity_date: string }>("SELECT id,activity_date FROM activities WHERE user_id=$1 AND sport='running' AND deleted_at IS NULL", [userId]),
  };
}

export type OwnedActivitiesRepo = ReturnType<typeof createOwnedActivitiesRepo>;
