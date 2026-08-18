/**
 * repositories/date-ranges.repo.ts
 * Data access for named date ranges the user saves for later recall (rest-api-standards
 * §11 — the only layer that runs SQL for this domain).
 */
import type { DatabaseSync } from "node:sqlite";
import type { DateRangeRow } from "../db.ts";

export function createDateRangesRepo(db: DatabaseSync) {
  const listAll      = db.prepare("SELECT id, name, from_date, to_date, created_at FROM date_ranges ORDER BY created_at DESC LIMIT ? OFFSET ?");
  const countAll     = db.prepare("SELECT COUNT(*) AS count FROM date_ranges");
  const findByName   = db.prepare("SELECT id, name, from_date, to_date, created_at FROM date_ranges WHERE name = ?");
  const insert       = db.prepare("INSERT INTO date_ranges (name, from_date, to_date) VALUES ($name, $from_date, $to_date)");
  const findById     = db.prepare("SELECT id, name, from_date, to_date, created_at FROM date_ranges WHERE id = ?");
  const deleteById   = db.prepare("DELETE FROM date_ranges WHERE id = ?");

  return {
    listPage: (limit: number, offset: number): DateRangeRow[] => listAll.all(limit, offset) as unknown as DateRangeRow[],
    count:    (): { count: number } => countAll.get() as unknown as { count: number },
    byName:   (name: string): DateRangeRow | undefined => findByName.get(name) as unknown as DateRangeRow | undefined,
    byId:     (id: number): DateRangeRow | undefined => findById.get(id) as unknown as DateRangeRow | undefined,
    create:   (name: string, from: string, to: string): DateRangeRow => {
      const info = insert.run({ $name: name, $from_date: from, $to_date: to });
      return findById.get(Number(info.lastInsertRowid)) as unknown as DateRangeRow;
    },
    remove:   (id: number) => deleteById.run(id),
  };
}

export type DateRangesRepo = ReturnType<typeof createDateRangesRepo>;
