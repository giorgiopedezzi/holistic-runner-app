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

// Plain UTC-midnight date math on the app's own "YYYY-MM-DD" date strings —
// UTC avoids any local-timezone day-boundary drift when shifting/diffing a
// date string that carries no time component. Moved here from
// OverviewTab.tsx so hooks/useCompareRange.ts can share them too.
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
}
