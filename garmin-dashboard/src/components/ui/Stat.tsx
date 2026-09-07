import type { CSSProperties, ReactNode } from "react";
import { Card } from "./Card";
import { Label } from "./Label";

interface StatProps {
  label:  string;
  value:  string | number;
  sub?:   string;
  accent?: string;
  tooltip?: string;
  // Optional leading icon (lucide-react component instance, sized by the
  // caller) shown next to the label — added for the graph-first reorg
  // (HRA dashboard reorg) so Stat can serve as the one shared "metric card"
  // shape across Key metrics, Additional details, and a chart's own header
  // KPIs, instead of a bespoke card per section.
  icon?: ReactNode;
  // Always-visible comparison line ("+12% vs previous period"), distinct
  // from `tooltip` (hover-only, pre-existing). `deltaPositive` picks the
  // arrow/color (undefined = neutral, per the "no comparison without data"
  // rule elsewhere on this tab — callers simply omit deltaText when there's
  // nothing to compare against).
  deltaText?: string;
  deltaPositive?: boolean;
  // "card" (default) is the bordered mini-card grid shape (StatGrid, Card
  // chrome). "row" is the container-budget alternative (.claude/rules/frontend.md,
  // HRA-276) for a plain read-only fact on phone widths — no card chrome, a
  // typographic label/value row instead (HRA-279).
  layout?: "card" | "row";
}

// Splits a formatted "68.36 km" into a value/unit pair so the unit can render
// as a smaller inline span — purely presentational (the number itself is
// untouched, still whatever fmt.ts already computed), fixes the unit token
// wrapping onto its own line inside a narrow StatGrid column. Falls through
// unchanged for anything that isn't "<digits> <unit-word>" (plain counts,
// already-split values like the hero ring's "4.0 h").
export function splitUnit(value: string | number): { main: string; unit?: string } {
  if (typeof value !== "string") return { main: String(value) };
  const m = value.match(/^(.*\d)\s+([a-zA-Zµ%/]+)$/);
  if (!m) return { main: value };
  return { main: m[1], unit: m[2] };
}

export function Stat({ label, value, sub, accent, tooltip, icon, deltaText, deltaPositive, layout = "card" }: StatProps) {
  const { main, unit } = splitUnit(value);
  const kpiStyle = accent ? ({ "--kpi-color": accent } as CSSProperties) : undefined;
  const deltaClass = deltaPositive == null ? "hra-stat-delta" : deltaPositive ? "hra-stat-delta hra-stat-delta-up" : "hra-stat-delta hra-stat-delta-down";
  const deltaContent = deltaText && <>{deltaPositive != null && (deltaPositive ? "↗ " : "↘ ")}{deltaText}</>;

  if (layout === "row") {
    // Container-budget row (HRA-279): label left, value/unit + delta right,
    // no card chrome — the value/delta group never wraps mid-number so a
    // narrow phone width can't split "4.6" from "kg" or the delta arrow.
    return (
      <div className="hra-fact-row hra-fact-row-stat">
        <span className="hra-fact-row-stat-label">
          {icon && <span className="hra-stat-icon" aria-hidden="true">{icon}</span>}
          {label}
        </span>
        <span className="hra-fact-row-stat-values">
          <span className="hra-kpi-value hra-kpi-value--sm" style={kpiStyle}>
            {main}
            {unit && <span className="hra-kpi-unit hra-kpi-unit--sm"> {unit}</span>}
          </span>
          {deltaContent && <span className={deltaClass}>{deltaContent}</span>}
        </span>
      </div>
    );
  }

  return (
    <Card className="hra-lift" tooltip={tooltip}>
      <Label className="hra-stat-label">
        {icon && <span className="hra-stat-icon" aria-hidden="true">{icon}</span>}
        {label}
      </Label>
      {/* `accent` is a caller-supplied var() token (e.g. "var(--accent-green)"),
          threaded through as a --kpi-color custom-property hook rather than a
          style={{color}} — the actual color rule lives in .hra-kpi-value
          (index.css), see CLAUDE.md's "styles live in index.css". */}
      <div className="hra-kpi-value" style={kpiStyle}>
        {main}
        {unit && <span className="hra-kpi-unit"> {unit}</span>}
      </div>
      {sub && <div className="hra-kpi-sub">{sub}</div>}
      {deltaContent && <div className={deltaClass}>{deltaContent}</div>}
    </Card>
  );
}
