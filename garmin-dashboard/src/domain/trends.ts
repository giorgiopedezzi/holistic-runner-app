/**
 * domain/trends.ts  (HRA-70)
 * Pure trend-grouping logic extracted from OverviewTab.tsx — no React, no
 * Recharts. See docs/frontend.md's "Overview tab" section for the behaviour
 * these encode (grouping defaults, ISO week bucketing, the swim
 * pace-per-100m scoping, mean-centered chart domains).
 */
import type { Activity } from "@/types/api";

export type GroupMode = "single" | "week" | "month";

export interface TrendPoint {
  key: string;
  label: string;
  sortDate: string;
  totalKm: number;
  avgPace: number | null;
  avgHr: number | null;
  count: number;
}

// Range length decides the default grouping: <=21 days -> single,
// <=120 days -> week, else month.
export function defaultGroupMode(from: string, to: string): GroupMode {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
  if (days <= 21) return "single";
  if (days <= 120) return "week";
  return "month";
}

// Monday of the ISO week containing this date, as YYYY-MM-DD.
export function isoWeekStart(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function buildTrendPoints(activities: Activity[], mode: GroupMode): TrendPoint[] {
  const groups = new Map<string, Activity[]>();
  for (const a of activities) {
    const key = mode === "single" ? String(a.id)
      : mode === "week" ? isoWeekStart(a.date_only)
      : a.date_only.slice(0, 7);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }

  const points: TrendPoint[] = [];
  for (const [key, acts] of groups) {
    const totalKm = acts.reduce((s, a) => s + (a.distance_m ?? 0), 0) / 1000;
    const paces = acts.map(a => a.avg_pace_minkm).filter((v): v is number => v != null);
    const hrs = acts.map(a => a.avg_hr).filter((v): v is number => v != null);
    const avgPace = paces.length ? paces.reduce((s, v) => s + v, 0) / paces.length : null;
    const avgHr = hrs.length ? hrs.reduce((s, v) => s + v, 0) / hrs.length : null;
    const sortDate = acts.reduce((m, a) => (a.date_only < m ? a.date_only : m), acts[0].date_only);
    const label = mode === "month" ? key : mode === "week" ? sortDate.slice(5) : sortDate.slice(5);
    points.push({ key, label, sortDate, totalKm, avgPace, avgHr, count: acts.length });
  }
  points.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  return points;
}

// Mean-centered domain, same "own real scale, aligned at the mean" pattern
// used for multi-metric overlays in ActivityModal.tsx — avoids a dual-axis
// "arbitrary scale alignment" lie while still letting pace and HR (wildly
// different units) share one chart.
export function meanCenteredDomain(vals: number[]): [number, number] {
  if (vals.length === 0) return [0, 1];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const maxDev = Math.max(...vals.map(v => Math.abs(v - mean)), 0.001);
  return [mean - maxDev, mean + maxDev];
}

// Groups activities by sport and orders sports by total distance, descending
// (busiest sport's chart first). Extracted out of OverviewTab.tsx's
// TrendsBySport (HRA-78) specifically so it can be wrapped in useMemo there
// — it's real O(n) work (a Map build plus a sort with a reduce per
// comparison) that was previously recomputed on every render, including
// re-renders triggered by unrelated state (e.g. clicking the Week/Month
// toggle), not just when `activities` itself changed.
export function groupActivitiesBySport(activities: Activity[]): [string, Activity[]][] {
  const bySport = new Map<string, Activity[]>();
  for (const a of activities) {
    const sport = a.sport ?? "other";
    (bySport.get(sport) ?? bySport.set(sport, []).get(sport)!).push(a);
  }
  return [...bySport.entries()].sort((a, b) =>
    b[1].reduce((s, x) => s + (x.distance_m ?? 0), 0) - a[1].reduce((s, x) => s + (x.distance_m ?? 0), 0));
}

// Swimming pace is conventionally per 100m, not per km — a plain unit
// conversion (min/km x 0.1 = min/100m), not a different data source.
// Scoped to OverviewTab's SportTrendChart only (HRA-70 AC) — ActivityModal
// and everywhere else still show swimming pace as /km. Not itemized in the
// Story's Evidence list (it was an inline literal, not a named function) but
// pulled out here because the AC requires pinning its exact conversion.
export function swimPacePer100m(minPerKm: number): number {
  return minPerKm * 0.1;
}
