/**
 * domain/trends.ts  (HRA-70)
 * Pure trend-grouping logic extracted from OverviewTab.tsx — no React, no
 * Recharts. See docs/frontend.md's "Overview tab" section for the behaviour
 * these encode (grouping defaults, ISO week bucketing, the swim
 * pace-per-100m scoping, mean-centered chart domains).
 */
import type { Activity } from "@/types/api";
import { fmtDateChart } from "@/utils/fmt";
import { daysBetween } from "@/utils/date";

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
    // Numeric-only, uk/us day-month order per the Settings tab's date-format
    // preference (fmtDateChart) — was a hardcoded "MM-DD" slice (sortDate.slice(5))
    // regardless of that setting; "month" mode's "YYYY-MM" key has no day
    // component, so there's no ordering ambiguity to fix there.
    const label = mode === "month" ? key : fmtDateChart(sortDate);
    points.push({ key, label, sortDate, totalKm, avgPace, avgHr, count: acts.length });
  }
  points.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  return points;
}

// ── Overview & Trends' overlapped current-vs-compare chart ─────────────────
// One shared x-axis "slot" pairing a current-period TrendPoint with a
// compare-period one — works identically for Single (one point per
// activity), Week, and Month (buildTrendPoints already reduces any mode to
// this same shape, so the pairing logic below never needs to know which
// mode produced its input). Two alignment strategies:
export type AlignMode = "index" | "time";

export interface OverlapPoint {
  slot: number;
  currentLabel: string | null;
  compareLabel: string | null;
  currentKm: number | null;
  currentPace: number | null;
  currentHr: number | null;
  compareKm: number | null;
  comparePace: number | null;
  compareHr: number | null;
}

function emptyOverlapPoint(slot: number): OverlapPoint {
  return {
    slot, currentLabel: null, compareLabel: null,
    currentKm: null, currentPace: null, currentHr: null,
    compareKm: null, comparePace: null, compareHr: null,
  };
}

function fillSide(point: OverlapPoint, p: TrendPoint, side: "current" | "compare"): void {
  if (side === "current") {
    point.currentLabel = p.label; point.currentKm = p.totalKm; point.currentPace = p.avgPace; point.currentHr = p.avgHr;
  } else {
    point.compareLabel = p.label; point.compareKm = p.totalKm; point.comparePace = p.avgPace; point.compareHr = p.avgHr;
  }
}

// "index": positional 1:1 pairing in chronological order — the longer
// side's leftover points each get their own trailing, half-filled slot.
// The only alignment Week/Month use (each bucket is already a period-
// relative slot — "week 2 of the period" — so position IS "distance in
// time" there; the ambiguity "time" mode resolves only arises at
// per-activity granularity, i.e. Single mode).
function buildOverlapByIndex(cur: TrendPoint[], cmp: TrendPoint[]): OverlapPoint[] {
  const len = Math.max(cur.length, cmp.length);
  const points: OverlapPoint[] = [];
  for (let i = 0; i < len; i++) {
    const point = emptyOverlapPoint(i);
    if (cur[i]) fillSide(point, cur[i], "current");
    if (cmp[i]) fillSide(point, cmp[i], "compare");
    points.push(point);
  }
  return points;
}

// "time": a sorted merge of both periods' points by "days since that
// period's own start" (using each point's own `sortDate`) — an EXACT
// day-offset match becomes one shared slot; everything else gets its own
// slot, interleaved in chronological day-offset order (a classic
// sorted-merge, not nearest-neighbor matching). Verified against the spec
// example: current days [0,2,5,9] vs compare days [0,3,8] → 6 slots, only
// the first (day 0) overlapping.
function buildOverlapByTime(cur: TrendPoint[], cmp: TrendPoint[], currentFrom: string, compareFrom: string): OverlapPoint[] {
  const curOffsets = cur.map(p => daysBetween(currentFrom, p.sortDate));
  const cmpOffsets = cmp.map(p => daysBetween(compareFrom, p.sortDate));
  const points: OverlapPoint[] = [];
  let i = 0, j = 0;
  while (i < cur.length || j < cmp.length) {
    const ci = i < cur.length ? curOffsets[i] : null;
    const cj = j < cmp.length ? cmpOffsets[j] : null;
    const point = emptyOverlapPoint(points.length);
    if (ci != null && cj != null && ci === cj) {
      fillSide(point, cur[i], "current"); fillSide(point, cmp[j], "compare"); i++; j++;
    } else if (cj == null || (ci != null && ci < cj)) {
      fillSide(point, cur[i], "current"); i++;
    } else {
      fillSide(point, cmp[j], "compare"); j++;
    }
    points.push(point);
  }
  return points;
}

// Both point arrays are sorted chronologically first (buildTrendPoints
// already sorts, but this makes the function correct regardless of caller
// order too, which matters for "time" mode's merge in particular).
export function buildOverlapPoints(
  currentPoints: TrendPoint[], comparePoints: TrendPoint[],
  currentFrom: string, compareFrom: string,
  mode: AlignMode,
): OverlapPoint[] {
  const cur = [...currentPoints].sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  const cmp = [...comparePoints].sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  return mode === "index" ? buildOverlapByIndex(cur, cmp) : buildOverlapByTime(cur, cmp, currentFrom, compareFrom);
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
