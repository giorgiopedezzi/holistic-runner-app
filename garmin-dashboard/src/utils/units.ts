/**
 * utils/units.ts
 * Metric/imperial unit-system state + conversions, read by utils/fmt.ts and
 * a handful of components with their own inline unit displays (see
 * CLAUDE.md's unit-toggle notes for the full list).
 *
 * State lives in a module-level variable, not React context — mirroring how
 * the CSS theme works (a global side-channel every component reads at
 * render time), which this app already relies on. It's sufficient here
 * because unit system only ever changes from the Settings tab, and every
 * other tab is conditionally rendered (mounted fresh each time it's
 * switched to — see App.tsx), so a tab always picks up the latest value the
 * next time it's viewed without needing React to propagate a state change
 * into an already-mounted, unrelated tree.
 */

export type ResolvedUnitSystem = "metric" | "imperial";

let current: ResolvedUnitSystem = "metric";

export function setUnitSystem(u: ResolvedUnitSystem): void {
  current = u;
}

export function getUnitSystem(): ResolvedUnitSystem {
  return current;
}

// There is no direct browser API for "the OS's measurement system" (unlike
// prefers-color-scheme for theme) — this is a best-effort heuristic based on
// the browser's locale region, the same approach most web apps use for this
// exact problem. Not perfect (e.g. it can't distinguish a US-region browser
// set by someone who personally prefers metric), but reasonable as a
// starting default that the user can always override explicitly.
const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]); // United States, Liberia, Myanmar

export function detectUnitSystemFromLocale(): ResolvedUnitSystem {
  try {
    const lang = navigator.language;
    let region: string | undefined;
    if (typeof Intl !== "undefined" && "Locale" in Intl) {
      region = new Intl.Locale(lang).maximize().region;
    }
    region ??= lang.split("-")[1]?.toUpperCase();
    return region && IMPERIAL_REGIONS.has(region) ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

// ── Conversions ────────────────────────────────────────────────────────────
const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;
const KG_PER_LB = 0.45359237;

export const kmToMi = (km: number): number => km / KM_PER_MI;
export const mToFt = (m: number): number => m / M_PER_FT;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;
// Minutes-per-km → minutes-per-mile: a pace in min/km takes KM_PER_MI times
// as long to cover a mile, so scale up by the same factor.
export const paceKmToMi = (minPerKm: number): number => minPerKm * KM_PER_MI;
export const kmhToMph = (kmh: number): number => kmh / KM_PER_MI;

export function distanceUnitLabel(): string {
  return getUnitSystem() === "imperial" ? "mi" : "km";
}
export function paceUnitLabel(): string {
  return getUnitSystem() === "imperial" ? "min/mi" : "min/km";
}
export function speedUnitLabel(): string {
  return getUnitSystem() === "imperial" ? "mph" : "km/h";
}
export function weightUnitLabel(): string {
  return getUnitSystem() === "imperial" ? "lb" : "kg";
}
export function elevationUnitLabel(): string {
  return getUnitSystem() === "imperial" ? "ft" : "m";
}
