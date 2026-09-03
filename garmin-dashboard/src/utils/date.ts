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

// The "All available data" preset's internal `from` value (useDateRange's
// setPreset(9999)) — an implementation detail, never rendered as-is (HRA-256:
// it used to leak as a literal "01/01/2000" date, and used to seed
// useCompareRange's defaultCompareRange into a manufactured multi-decade
// comparison window). Single source of truth so every consumer that needs to
// recognize "All is selected" compares against this constant, not a
// duplicated string literal.
export const ALL_SENTINEL = "2000-01-01";

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
