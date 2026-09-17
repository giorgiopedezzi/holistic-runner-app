import { kmToMi, miToKm, paceKmToMi, paceMiToKm, type ResolvedUnitSystem } from "./units";

export type AthleteMetrics = {
  current_easy_pace_sec_per_km: number | null;
  current_race_pace_sec_per_km: number | null;
  current_long_run_target_m: number | null;
};

export type AthleteMetricsForm = {
  easyPace: string;
  racePace: string;
  longRunTarget: string;
};

function trimDecimal(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

export function formatPaceInput(secondsPerKm: number | null, units: ResolvedUnitSystem): string {
  if (secondsPerKm == null) return "";
  const displaySeconds = Math.round(units === "imperial" ? paceKmToMi(secondsPerKm) : secondsPerKm);
  return `${Math.floor(displaySeconds / 60)}:${String(displaySeconds % 60).padStart(2, "0")}`;
}

export function parsePaceInput(value: string, units: ResolvedUnitSystem): number | null | undefined {
  if (value.trim() === "") return null;
  const match = /^(\d+):([0-5]\d)$/.exec(value.trim());
  if (!match) return undefined;
  const displaySeconds = Number(match[1]) * 60 + Number(match[2]);
  if (displaySeconds <= 0) return undefined;
  return Math.round(units === "imperial" ? paceMiToKm(displaySeconds) : displaySeconds);
}

export function formatDistanceInput(meters: number | null, units: ResolvedUnitSystem): string {
  if (meters == null) return "";
  return units === "imperial" ? trimDecimal(kmToMi(meters / 1000), 5) : trimDecimal(meters / 1000, 3);
}

export function parseDistanceInput(value: string, units: ResolvedUnitSystem): number | null | undefined {
  if (value.trim() === "") return null;
  const displayDistance = Number(value);
  if (!Number.isFinite(displayDistance) || displayDistance <= 0) return undefined;
  return Math.round((units === "imperial" ? miToKm(displayDistance) : displayDistance) * 1000);
}

export function formatAthleteMetrics(metrics: AthleteMetrics, units: ResolvedUnitSystem): AthleteMetricsForm {
  return {
    easyPace: formatPaceInput(metrics.current_easy_pace_sec_per_km, units),
    racePace: formatPaceInput(metrics.current_race_pace_sec_per_km, units),
    longRunTarget: formatDistanceInput(metrics.current_long_run_target_m, units),
  };
}

export function parseAthleteMetrics(form: AthleteMetricsForm, units: ResolvedUnitSystem): AthleteMetrics | undefined {
  const easy = parsePaceInput(form.easyPace, units);
  const race = parsePaceInput(form.racePace, units);
  const longRun = parseDistanceInput(form.longRunTarget, units);
  if (easy === undefined || race === undefined || longRun === undefined) return undefined;
  return {
    current_easy_pace_sec_per_km: easy,
    current_race_pace_sec_per_km: race,
    current_long_run_target_m: longRun,
  };
}
