import type { ReactNode } from "react";
import { Card } from "./Card";

// ── <ChartCard> — HRA-97 standard chart chrome ───────────────────────────
// A specialization of the Card primitive (HRA-96): same bg/border/radius/
// hover rules, chart-specific content. Every Recharts-based chart in the
// app wraps its <ResponsiveContainer> in this instead of a bare <Card>, so
// the surrounding chrome (and the shared grid/tooltip/legend building
// blocks below) is the same everywhere. Individual charts still choose
// their own series types (Line/Area/Bar) — this only standardizes the
// container and the visual language around it, per the Story's rules.

interface ChartCardProps {
  title?: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
}

export function ChartCard({ title, legend, children }: ChartCardProps) {
  return (
    <Card style={{ padding: "16px 8px 8px" }}>
      {(title || legend) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: "0 8px" }}>
          {title && <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{title}</div>}
          {legend}
        </div>
      )}
      {children}
    </Card>
  );
}

// Horizontal dashed grid only, no vertical lines — the standard config's
// "Horizontal dashed grid only" rule. Pass to <CartesianGrid {...chartGrid}/>.
export const chartGrid = { vertical: false, stroke: "var(--border)", strokeDasharray: "3 3" } as const;

// "No axis lines, ticks xs/secondary" — pass to <XAxis tick={chartTick} tickLine={false} axisLine={false}/>.
export const chartTick = { fill: "var(--text-secondary)", fontSize: 11 } as const;

// Custom dark Tooltip content-style — pass to <Tooltip contentStyle={chartTooltipStyle}/>.
export const chartTooltipStyle = {
  background: "color-mix(in srgb, var(--accent) 4%, var(--bg-card))",
  border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--border-strong))",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
} as const;

// Bars rounded top only, per the standard config.
export const chartBarRadius: [number, number, number, number] = [4, 4, 0, 0];

// Area fills = gradient, color 35%→0. Renders the <linearGradient> def;
// pass `url(#${id})` as the consuming <Area>'s fill.
export function chartGradientDef(id: string, color: string) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

// Clickable pill-chip legend — a generic, controlled toggle-series legend.
// Existing per-chart toggle UIs (BodyTab's checkbox pills, ActivityChartSection's
// MetricRow) already satisfy this rule with their own bespoke layouts and are
// left as-is (AC: preserve existing toggle behavior unmodified); this is for
// charts that don't already have one.
interface ChartLegendItem {
  key: string;
  label: string;
  color: string;
  active: boolean;
}

interface ChartPillLegendProps {
  items: ChartLegendItem[];
  onToggle: (key: string) => void;
}

export function ChartPillLegend({ items, onToggle }: ChartPillLegendProps) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map(item => (
        <button
          key={item.key}
          onClick={() => onToggle(item.key)}
          style={{
            fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${item.active ? item.color : "var(--border-strong)"}`,
            // color-mix, not the `${color}NN` hex-alpha-suffix trick — this
            // component's colors may be `var(--x)` CSS custom properties
            // (e.g. the fixed --data-* tokens), and appending a hex suffix
            // to a var() call produces invalid CSS (see ClassificationCard.tsx).
            background: item.active ? `color-mix(in srgb, ${item.color} 16%, transparent)` : "transparent",
            color: item.active ? item.color : "var(--text-secondary)",
            boxShadow: item.active ? `0 0 10px color-mix(in srgb, ${item.color} 35%, transparent)` : "none",
            transition: "background 0.15s, box-shadow 0.15s, color 0.15s",
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
