import type { Queryable } from "../db/query.ts";
import type { DateRangeRow } from "../db.ts";
const FIELDS = `dr.id, dr.name, dr.from_date, dr.to_date, dr.activity_id, dr.created_at, a.date_only AS race_date_only, a.activity_name AS race_activity_name, a.distance_m AS race_distance_m, a.activity_type_id AS race_activity_type_id FROM date_ranges dr LEFT JOIN activities a ON a.id = dr.activity_id`;
export function createDateRangesRepo(db: Queryable) { return {
  listPage: (limit: number, offset: number) => db.all<DateRangeRow>(`SELECT ${FIELDS} ORDER BY dr.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
  count: () => db.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM date_ranges"),
  byName: (name: string) => db.get<DateRangeRow>(`SELECT ${FIELDS} WHERE dr.name = $1`, [name]),
  byId: (id: number) => db.get<DateRangeRow>(`SELECT ${FIELDS} WHERE dr.id = $1`, [id]),
  create: (name: string, from: string, to: string, activityId: number | null) => db.get<DateRangeRow>(`INSERT INTO date_ranges (user_id, name, from_date, to_date, activity_id) VALUES ((SELECT id FROM users ORDER BY created_at LIMIT 1), $1, $2, $3, $4) RETURNING id, name, from_date, to_date, activity_id, created_at`, [name, from, to, activityId]),
  update: (id: number, name: string, from: string, to: string, activityId: number | null) => db.get<DateRangeRow>(`UPDATE date_ranges SET name = $2, from_date = $3, to_date = $4, activity_id = $5 WHERE id = $1 RETURNING id, name, from_date, to_date, activity_id, created_at`, [id, name, from, to, activityId]),
  remove: (id: number) => db.run("DELETE FROM date_ranges WHERE id = $1", [id]),
}; }
export type DateRangesRepo = ReturnType<typeof createDateRangesRepo>;
