import type { DateRangeRow } from "../db.ts";
import type { Queryable } from "../db/query.ts";

const FIELDS = "dr.id, dr.name, dr.from_date, dr.to_date, dr.activity_id, dr.created_at, a.date_only AS race_date_only, a.activity_name AS race_activity_name, a.distance_m AS race_distance_m, a.activity_type_id AS race_activity_type_id FROM date_ranges dr LEFT JOIN activities a ON a.id = dr.activity_id AND a.user_id = dr.user_id";

export function createOwnedDateRangesRepo(db: Queryable, userId: string) {
  return {
    listPage: (limit: number, offset: number) => db.all<DateRangeRow>(`SELECT ${FIELDS} WHERE dr.user_id=$1 ORDER BY dr.created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]),
    count: () => db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM date_ranges WHERE user_id=$1", [userId]),
    byName: (name: string) => db.get<DateRangeRow>(`SELECT ${FIELDS} WHERE dr.user_id=$1 AND dr.name=$2`, [userId, name]),
    byId: (id: number) => db.get<DateRangeRow>(`SELECT ${FIELDS} WHERE dr.user_id=$1 AND dr.id=$2`, [userId, id]),
    create: (name: string, from: string, to: string, activityId: number | null) => db.get<DateRangeRow>(`INSERT INTO date_ranges (user_id,name,from_date,to_date,activity_id) SELECT $1,$2,$3,$4,$5 WHERE $5 IS NULL OR EXISTS (SELECT 1 FROM activities WHERE id=$5 AND user_id=$1) RETURNING id,name,from_date,to_date,activity_id,created_at`, [userId,name,from,to,activityId]),
    update: (id: number, name: string, from: string, to: string, activityId: number | null) => db.get<DateRangeRow>(`UPDATE date_ranges SET name=$3,from_date=$4,to_date=$5,activity_id=$6 WHERE user_id=$1 AND id=$2 AND ($6 IS NULL OR EXISTS (SELECT 1 FROM activities WHERE id=$6 AND user_id=$1)) RETURNING id,name,from_date,to_date,activity_id,created_at`, [userId,id,name,from,to,activityId]),
    remove: (id: number) => db.run("DELETE FROM date_ranges WHERE user_id=$1 AND id=$2", [userId,id]),
  };
}

export type OwnedDateRangesRepo = ReturnType<typeof createOwnedDateRangesRepo>;
