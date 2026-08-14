import { magnitudeColor } from "@/domain/activity-chart";
import { fmtPauseDuration } from "@/domain/pauses";

// Standard Recharts pattern for a custom marker at a data coordinate — much
// more reliable than a ReferenceLine's custom `label` render prop (which,
// in practice, silently failed to render at all here).
export function PauseFlagShape(props: unknown): React.ReactElement | null {
  const p = props as { cx?: number; cy?: number; payload?: { pauseDurationSec?: number } };
  if (p.cx == null || p.cy == null || p.payload?.pauseDurationSec == null) return null;
  const color = magnitudeColor(p.payload.pauseDurationSec, 300);
  const text = fmtPauseDuration(p.payload.pauseDurationSec);
  const w = Math.max(28, text.length * 6 + 10);
  return (
    <g transform={`translate(${p.cx - w / 2}, ${p.cy - 7})`}>
      <rect width={w} height={14} rx={7} fill={color} />
      <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fill="#1a1a1a">{text}</text>
    </g>
  );
}
