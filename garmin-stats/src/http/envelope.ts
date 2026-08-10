/**
 * http/envelope.ts
 * The consistent list envelope (HRA-38, rest-api-standards §7). Every collection
 * endpoint returns { data, page } so clients see one uniform shape.
 *
 * Offset-based paging (not cursor): the dashboard's Pagination UI is page-number
 * based (jump-to-page, last-page), which maps directly to limit/offset. A single
 * user's activity list is small and low-churn, so offset's instability under
 * concurrent inserts is a non-issue here — documented deviation from the epic's
 * "cursor preferred" note.
 *
 * Aggregate endpoints (summary/weekly/monthly/correlation) are wrapped whole
 * (limit = offset-free full set) purely for shape consistency — there's nothing
 * to page through.
 */
export interface Page {
  limit: number;
  offset: number;
  total: number;
}

export interface Paginated<T> {
  data: T[];
  page: Page;
}

export function paginated<T>(data: T[], total: number, limit: number, offset: number): Paginated<T> {
  return { data, page: { limit, offset, total } };
}

// Wrap an already-complete result set (aggregates) — no real paging applied.
export function wholePage<T>(data: T[]): Paginated<T> {
  return { data, page: { limit: data.length, offset: 0, total: data.length } };
}
