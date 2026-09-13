/**
 * useReportNav.ts (HRA-339)
 * URL-backed persistence for the report-modal drill-down chain (Plan → Week
 * → Workout, and the cross-plan Range → Plan → Week → Workout variant) plus
 * each level's own Plan-to-date/Full-plan toggle — so refresh, direct-link
 * entry, and closing one drill level back to its parent all survive, instead
 * of resetting to component-local `useState` as before this Story. Follows
 * the same flat-key `useUrlState` convention as `tab`/`activityId`/`from`/
 * `to` — each drill level owns its own named key(s) rather than one combined
 * blob, so independent report flows (Agenda's own workout report, Manage's
 * plan report, Overview's range report) never collide with each other.
 */
import { useUrlState } from "./useUrlState";
import type { ReportRangeMode } from "@/types/api";

export function useReportRangeMode(key: string): [ReportRangeMode, (mode: ReportRangeMode) => void] {
  const [raw, setRaw] = useUrlState(key, "");
  const mode: ReportRangeMode = raw === "full_plan" ? "full_plan" : "plan_to_date";
  // The default is omitted from the URL entirely so a report that was never
  // toggled away from "plan_to_date" doesn't grow the query string.
  const setMode = (next: ReportRangeMode) => setRaw(next === "plan_to_date" ? "" : next);
  return [mode, setMode];
}

export function useReportFlag(key: string): [boolean, (open: boolean) => void] {
  const [raw, setRaw] = useUrlState(key, "");
  return [raw === "1", (open: boolean) => setRaw(open ? "1" : "")];
}

export function useReportNumericSelection(key: string): [number | null, (value: number | null) => void] {
  const [raw, setRaw] = useUrlState(key, "");
  const parsed = raw ? Number(raw) : NaN;
  const value = Number.isFinite(parsed) ? parsed : null;
  return [value, (next: number | null) => setRaw(next != null ? String(next) : "")];
}

export function useReportStringSelection(key: string): [string | null, (value: string | null) => void] {
  const [raw, setRaw] = useUrlState(key, "");
  return [raw || null, (next: string | null) => setRaw(next ?? "")];
}

export interface ReportWeekKey {
  sectionName: string;
  weekNumber: number;
}

export function useReportWeekSelection(key: string): [ReportWeekKey | null, (week: ReportWeekKey | null) => void] {
  const [raw, setRaw] = useUrlState(key, "");
  const week = decodeWeekKey(raw);
  const setWeek = (next: ReportWeekKey | null) => setRaw(next ? encodeWeekKey(next) : "");
  return [week, setWeek];
}

function encodeWeekKey(week: ReportWeekKey): string {
  return `${encodeURIComponent(week.sectionName)}:${week.weekNumber}`;
}

function decodeWeekKey(raw: string): ReportWeekKey | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf(":");
  if (sep < 0) return null;
  const weekNumber = Number(raw.slice(sep + 1));
  if (!Number.isFinite(weekNumber)) return null;
  return { sectionName: decodeURIComponent(raw.slice(0, sep)), weekNumber };
}

export interface ReportWorkoutKey {
  instanceId: number;
  workoutId: string;
}

export function useReportWorkoutSelection(key: string): [ReportWorkoutKey | null, (workout: ReportWorkoutKey | null) => void] {
  const [raw, setRaw] = useUrlState(key, "");
  const workout = decodeWorkoutKey(raw);
  const setWorkout = (next: ReportWorkoutKey | null) => setRaw(next ? encodeWorkoutKey(next) : "");
  return [workout, setWorkout];
}

function encodeWorkoutKey(workout: ReportWorkoutKey): string {
  return `${workout.instanceId}:${encodeURIComponent(workout.workoutId)}`;
}

function decodeWorkoutKey(raw: string): ReportWorkoutKey | null {
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep < 0) return null;
  const instanceId = Number(raw.slice(0, sep));
  if (!Number.isFinite(instanceId)) return null;
  const workoutId = decodeURIComponent(raw.slice(sep + 1));
  return workoutId ? { instanceId, workoutId } : null;
}
