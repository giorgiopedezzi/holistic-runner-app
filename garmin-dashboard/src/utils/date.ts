/**
 * utils/date.ts
 * Small date helpers shared across the app. `isoToday` / `isoAgo` return a
 * YYYY-MM-DD string (local ISO date slice) — the format every date input and
 * range query in this app uses. Single home for these, imported by
 * hooks/useDateRange.ts and components/ManageTab.tsx (HRA-68 dedup).
 */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
