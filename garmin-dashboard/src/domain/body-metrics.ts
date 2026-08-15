/**
 * domain/body-metrics.ts  (HRA-70)
 * Pure body-metric chart logic extracted from BodyTab.tsx — no React, no
 * Recharts. See docs/frontend.md's "Body metrics chart" section for the
 * behaviour these encode (kg-delta charting, weight-family unit conversion).
 */
import type { BodyMeasurement } from "@/types/api";
import { getUnitSystem, kgToLb, weightUnitLabel } from "@/utils/units";

// Colors are this app's existing accent hues, snapped to the nearest step
// that clears the dataviz skill's categorical validator (lightness band +
// CVD separation) against this chart's dark surface (--bg-card, #1e2330) —
// e.g. the raw --accent-orange/--accent-green are too light for the
// dark-mode band, so fat_ratio/muscle_mass_kg use darker validated variants
// instead of the exact CSS vars. Validated together as one 8-color set so
// each metric's color stays fixed regardless of which chart it appears in
// ("color follows the entity, never its row number").
export type PrimaryKey = "weight_kg" | "fat_mass_kg" | "muscle_mass_kg";
export type OtherKey    = "fat_ratio" | "bone_mass_kg" | "hydration_kg" | "bmi" | "heart_rate";
export type MetricKey   = PrimaryKey | OtherKey;

// Row shape both the raw BodyMeasurement list and the computed delta rows
// satisfy structurally (every MetricKey is a real BodyMeasurement field).
export type MetricRow = { date_only: string } & Partial<Record<MetricKey, number | null>>;

// `unit` here is the metric-system label — WEIGHT_KEYS below overrides it
// with weightUnitLabel() dynamically wherever these defs are actually used,
// since a static "kg" can't reflect a unit system the user can change at
// runtime. Kept as "kg" here anyway so METRIC_DEFS stays a plain, readable
// static table; nothing reads .unit directly for a WEIGHT_KEYS member.
export const METRIC_DEFS: Record<MetricKey, { label: string; color: string; unit: string }> = {
  weight_kg:      { label: "Weight",      color: "var(--data-weight)", unit: "kg" },
  fat_mass_kg:    { label: "Fat mass",    color: "#db2777",            unit: "kg" },
  muscle_mass_kg: { label: "Muscle mass", color: "#15965f",            unit: "kg" },
  fat_ratio:      { label: "Fat %",       color: "#d97706",            unit: "%" },
  bone_mass_kg:   { label: "Bone mass",   color: "#a855f7",            unit: "kg" },
  hydration_kg:   { label: "Hydration",   color: "#0891b2",            unit: "kg" },
  bmi:            { label: "BMI",         color: "#65a30d",            unit: "" },
  heart_rate:     { label: "Heart rate",  color: "var(--accent-red)",  unit: "bpm" },
};

export const WEIGHT_KEYS = new Set<MetricKey>(["weight_kg", "fat_mass_kg", "muscle_mass_kg", "bone_mass_kg", "hydration_kg"]);

export function metricUnit(key: MetricKey): string {
  return WEIGHT_KEYS.has(key) ? weightUnitLabel() : METRIC_DEFS[key].unit;
}

// Converts every weight-family field present in a row to lb when imperial
// is active — used on chart/table data, which format values with their own
// .toFixed(1) rather than going through fmt.ts's self-converting fmtWeight
// (that's still used as-is for the plain Stat cards, which must NOT also be
// pre-converted here or they'd double-convert).
export function convertRow(row: MetricRow): MetricRow {
  if (getUnitSystem() !== "imperial") return row;
  const out: MetricRow = { ...row };
  for (const k of WEIGHT_KEYS) {
    const v = out[k];
    if (v != null) out[k] = kgToLb(v);
  }
  return out;
}

// Delta (kg change from the first reading in range) — not raw values — is
// specifically what makes weight/fat mass/muscle mass comparable on one
// shared axis despite their very different absolute magnitudes (~80kg vs
// ~13kg vs ~65kg): the *changes* are typically much closer in size than the
// absolute values are, and since weight ~= fat mass + muscle mass + water +
// bone, plotting their deltas together directly shows how a weight change
// decomposes into fat vs muscle.
export function computeKgDelta(list: BodyMeasurement[], keys: PrimaryKey[]): MetricRow[] {
  const baseline: Partial<Record<PrimaryKey, number>> = {};
  for (const k of keys) {
    const first = list.find(m => m[k] != null);
    if (first) baseline[k] = first[k] as number;
  }
  return list.map(m => {
    const row: MetricRow = { date_only: m.date_only };
    for (const k of keys) {
      const v = m[k];
      const base = baseline[k];
      row[k] = base != null && v != null ? v - base : null;
    }
    return row;
  });
}
