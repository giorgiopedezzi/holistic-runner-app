/**
 * repositories/date-ranges.repo.ts
 * Data access for named date ranges the user saves for later recall (rest-api-standards
 * §11 — the only layer that runs SQL for this domain). Optionally links the race the
 * training block led up to (LEFT JOIN activities) so a list read carries the race's
 * display fields without a second round trip.
 */
import type { DatabaseSync } from "node:sqlite";
import type { DateRangeRow } from "../db.ts";

const SELECT_FIELDS = `
  dr.id, dr.name, dr.from_date, dr.to_date, dr.activity_id, dr.created_at,
  a.date_only AS race_date_only, a.activity_name AS race_activity_name,
  a.distance_m AS race_distance_m, a.activity_type_id AS race_activity_type_id
  FROM date_ranges dr
  LEFT JOIN activities a ON a.id = dr.activity_id
`;

export function createDateRangesRepo(db: DatabaseSync) {
  const listAll    = db.prepare(`SELECT ${SELECT_FIELDS} ORDER BY dr.created_at DESC LIMIT ? OFFSET ?`);
  const countAll    = db.prepare("SELECT COUNT(*) AS count FROM date_ranges");
  const findByName  = db.prepare(`SELECT ${SELECT_FIELDS} WHERE dr.name = ?`);
  const findById    = db.prepare(`SELECT ${SELECT_FIELDS} WHERE dr.id = ?`);
  const insert      = db.prepare("INSERT INTO date_ranges (name, from_date, to_date, activity_id) VALUES ($name, $from_date, $to_date, $activity_id)");
  const update      = db.prepare("UPDATE date_ranges SET name = $name, from_date = $from_date, to_date = $to_date, activity_id = $activity_id WHERE id = $id");
  const deleteById  = db.prepare("DELETE FROM date_ranges WHERE id = ?");

  return {
    listPage: (limit: number, offset: number): DateRangeRow[] => listAll.all(limit, offset) as unknown as DateRangeRow[],
    count:    (): { count: number } => countAll.get() as unknown as { count: number },
    byName:   (name: string): DateRangeRow | undefined => findByName.get(name) as unknown as DateRangeRow | undefined,
    byId:     (id: number): DateRangeRow | undefined => findById.get(id) as unknown as DateRangeRow | undefined,
    create:   (name: string, from: string, to: string, activityId: number | null): DateRangeRow => {
      const info = insert.run({ $name: name, $from_date: from, $to_date: to, $activity_id: activityId });
      return findById.get(Number(info.lastInsertRowid)) as unknown as DateRangeRow;
    },
    update:   (id: number, name: string, from: string, to: string, activityId: number | null): DateRangeRow => {
      update.run({ $id: id, $name: name, $from_date: from, $to_date: to, $activity_id: activityId });
      return findById.get(id) as unknown as DateRangeRow;
    },
    remove:   (id: number) => deleteById.run(id),
  };
}

export type DateRangesRepo = ReturnType<typeof createDateRangesRepo>;
