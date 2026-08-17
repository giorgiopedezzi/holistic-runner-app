import type { MetricKey, OptionalMetricKey } from "@/domain/activity-chart";
import { chartGrid, chartTick, chartTooltipStyle } from "@/components/ui";

// ── Shared constants for the activity detail view (HRA-74) ──────────────
// axisStyle/gridStyle/ttStyle now delegate to <ChartCard>'s standard config
// (HRA-97) so this view's grid/tick/tooltip styling matches every other
// chart in the app; the smaller 9-10px per-axis tick sizes used on this
// view's own YAxis elements (speed/optional-metric ticks, set inline in
// ActivityChartSection.tsx) are unaffected — those are deliberately
// smaller/color-coded per metric, not this shared X-axis default.
export const axisStyle = chartTick;
export const gridStyle = chartGrid;
export const ttStyle   = { contentStyle: chartTooltipStyle };

// ── Metric definitions ───────────────────────────────────────────────────
// Colors are the same validated-for-this-dark-surface set used in BodyTab.tsx
// (heart_rate/altitude reuse the exact accents established there; speed/
// cadence use the darker green/orange variants that clear the dark-mode
// lightness band). Power is new; the full 5-color set was re-validated
// together (validate_palette.js) before use.

// Speed's line/UI stays this app's reference green (#15965f — chosen to
// clear the dark-mode lightness band as a stroke/fill), but that same shade
// measures only ~4.15:1 against --bg-card as 9px axis tick TEXT, borderline
// for comfortable legibility. A distinct, lighter green used ONLY for the
// axis tick labels (not the line, not any other UI) fixes that without
// touching the established reference color itself.
export const SPEED_AXIS_TEXT_COLOR = "#20c17b"; // ~6.7:1 vs --bg-card

// speed/heart_rate/altitude_m use the app's fixed semantic data colors
// (HRA-94/97: --data-pace, --data-hr, --data-elev — same hex as before, now
// the token that's never allowed to vary with the user's accent). cadence
// and power have no fixed semantic token in that set (only pace/HR/
// elevation/weight/fat/muscle do) and keep their own literal colors.
export const METRIC_DEFS: Record<MetricKey, { label: string; color: string }> = {
  speed:      { label: "Speed",      color: "var(--data-pace)" },
  heart_rate: { label: "Heart rate", color: "var(--data-hr)" },
  altitude_m: { label: "Altitude",   color: "var(--data-elev)" },
  cadence:    { label: "Cadence",    color: "#d97706" },
  power:      { label: "Power",      color: "#a855f7" },
};
export const OPTIONAL_METRIC_ORDER: OptionalMetricKey[] = ["heart_rate", "altitude_m", "cadence", "power"];

// Compact labels for the runner's mouse-follow readout — "HR", not "Heart
// rate", to keep the single-line pill short. speed's own real label is
// picked separately (speed vs pace, per speedMode); this entry only exists
// so the Record's key set stays complete against MetricKey.
export const METRIC_LABEL_SHORT: Record<MetricKey, string> = {
  speed: "speed", heart_rate: "HR", altitude_m: "Alt", cadence: "Cad", power: "Pwr",
};

// Speed/Pace (the one mandatory metric) is ALONE on the left — every
// optional metric (heart_rate, altitude_m, cadence, power) goes right, no
// exceptions. Earlier versions only isolated Speed from whichever single
// metric was being compared against at the time (first from all optional
// metrics generically, then just from HR once HR moved right) — but leaving
// any other optional metric sharing Speed's side meant toggling *that* one
// on could reintroduce the same "Speed shares a side with a
// dynamically-appearing axis" situation that caused it to go missing
// before. Giving Speed sole, unconditional ownership of the left side
// removes that risk under every toggle combination, not just the default
// one, while still keeping Speed and HR (the two axes visible by default)
// on opposite sides as asked.
export const AXIS_SIDE: Record<MetricKey, "left" | "right"> = {
  speed: "left", heart_rate: "right", altitude_m: "right", cadence: "right", power: "right",
};

// Same yellow gradient/cap-based scheme as pause flags — a drop (recovery)
// and a rise share one gradient keyed on magnitude only (direction shown by
// the +/− in the label, not by color), with the biggest drop rendering
// darkest, same "how much" visual language as pause duration.
export const HR_RECOVERY_COLOR_CAP = 60; // bpm — observed real deltas run ~8-55bpm

// White (resting, ≤70bpm) → #c4706a (135bpm) → pure red (≥190bpm) for the
// mouse-follow runner icon, keyed on the actual bpm value (fixed anatomical
// thresholds, not normalized against this activity's own min/max) so the
// same HR always reads the same color across activities. Pure function (no
// React) so it can be called from an imperative mousemove handler without
// touching component state.
const HR_COLOR_STOPS: [number, [number, number, number]][] = [
  [70, [255, 255, 255]],
  [135, [196, 112, 106]],
  [190, [255, 0, 0]],
];
export function hrRunnerColor(bpm: number): string {
  if (bpm <= HR_COLOR_STOPS[0][0]) return `rgb(${HR_COLOR_STOPS[0][1].join(" ")})`;
  if (bpm >= HR_COLOR_STOPS[2][0]) return `rgb(${HR_COLOR_STOPS[2][1].join(" ")})`;
  const [lo, hi] = bpm < HR_COLOR_STOPS[1][0] ? [HR_COLOR_STOPS[0], HR_COLOR_STOPS[1]] : [HR_COLOR_STOPS[1], HR_COLOR_STOPS[2]];
  const t = (bpm - lo[0]) / (hi[0] - lo[0]);
  const c = lo[1].map((v, i) => Math.round(v + (hi[1][i] - v) * t));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}
