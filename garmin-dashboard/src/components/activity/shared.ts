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

// Pink → rose → coral → red → deep red across a fixed 70-190bpm anatomical
// range (dashboard design-system rework, section 7), keyed on the actual bpm
// value (not normalized against this activity's own min/max) so the same HR
// always reads the same color across activities. Deliberately its own red
// family (C92F3D at the top), distinct from --accent-red/system danger — see
// section 8. Drives BOTH the mouse-follow runner icon and the HR line's
// gradient (MetricGradient.tsx samples this same function), which is what
// keeps the runner's color and the line it's standing over in agreement by
// construction rather than by two lists that have to be kept in sync. Pure
// function (no React) so it can be called from an imperative mousemove
// handler without touching component state.
const HR_COLOR_STOPS: [number, [number, number, number]][] = [
  [70,  [214, 137, 158]], // #D6899E — low, muted pink
  [100, [204,  91, 119]], // #CC5B77 — rose
  [130, [193,  58,  88]],  // #C13A58 — strong coral
  [160, [170,  37,  65]],  // #AA2541 — deep red
  [190, [139,  25,  49]],  // #8B1931 — high, deep red
];
export function hrRunnerColor(bpm: number): string {
  return rampColor(HR_COLOR_STOPS, bpm);
}

// Gradient element ids for a chart, and the stroke each series should use:
// the value-mapped gradient for the two that have one (see
// MetricGradient.tsx), the series' own flat token for everything else. Charts
// call metricStroke rather than reaching for METRIC_DEFS[key].color, so
// giving another metric a ramp later is a change here, not at every <Line>.
// `id` is per-chart because each ResponsiveContainer renders its own <svg>.
export function speedGradientId(id: string): string { return `${id}-speed-grad`; }
export function hrGradientId(id: string): string { return `${id}-hr-grad`; }
export function metricStroke(key: MetricKey, id: string): string {
  if (key === "speed") return `url(#${speedGradientId(id)})`;
  if (key === "heart_rate") return `url(#${hrGradientId(id)})`;
  return METRIC_DEFS[key].color;
}

// Speed/Pace's ramp, on a NORMALIZED 0-1 scale rather than absolute units:
// 0 = this activity's slowest, 0.5 = its average, 1 = its fastest. Unlike HR
// there is no anatomical scale to key on — 12 km/h is a jog for one runner
// and a race for another, and one absolute mapping would flatten every easy
// run to a single color. MetricGradient.tsx does the value→position mapping,
// anchoring 0.5 to the activity's own mean.
//
// Distinctive metallic gradient (dashboard design-system rework, sections 4
// & 5) — steel blue (fastest) through oxidized metal (average) to copper
// (slowest). Deliberately no green (reads as "success", not pace) and no red
// (reserved for HR/danger) — see section 4's semantic rule, identical across
// all 4 themes, never derived from --accent.
const SPEED_COLOR_STOPS: [number, [number, number, number]][] = [
  [0,    [151,  75,  52]], // #974B34 — slowest, deep copper
  [0.25, [151, 117,  65]], // #977541 — dark brass
  [0.5,  [ 91, 119, 112]], // #5B7770 — dark oxidized metal
  [0.75, [ 57, 123, 148]], // #397B94 — deep blue steel
  [1,    [ 45, 111, 174]], // #2D6FAE — fastest, deep steel blue
];
export function speedRampColor(t: number): string {
  return rampColor(SPEED_COLOR_STOPS, t);
}

// Linear interpolation across an ascending list of (position, rgb) anchors,
// clamped at both ends.
function rampColor(stops: [number, [number, number, number]][], at: number): string {
  const first = stops[0], last = stops[stops.length - 1];
  if (at <= first[0]) return `rgb(${first[1].join(" ")})`;
  if (at >= last[0]) return `rgb(${last[1].join(" ")})`;
  let i = 1;
  while (i < stops.length - 1 && at >= stops[i][0]) i++;
  const lo = stops[i - 1], hi = stops[i];
  const t = (at - lo[0]) / (hi[0] - lo[0]);
  const c = lo[1].map((v, j) => Math.round(v + (hi[1][j] - v) * t));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}
