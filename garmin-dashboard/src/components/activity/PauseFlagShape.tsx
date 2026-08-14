import { magnitudeColor } from "@/domain/activity-chart";
import { fmtPauseDuration } from "@/domain/pauses";

interface PauseFlagShapeProps {
  cx?: number;
  cy?: number;
  payload?: { pauseDurationSec?: number };
}

// Standard Recharts pattern for a custom marker at a data coordinate — much
// more reliable than a ReferenceLine's custom `label` render prop (which,
// in practice, silently failed to render at all here). Typed against the
// handful of fields this shape actually reads (HRA-75) rather than
// `props: unknown` — Recharts' real custom-shape prop carries dozens of
// internal fields this component has no use for; structural typing lets
// this narrower interface stand in for it at `shape={PauseFlagShape}`.
export function PauseFlagShape({ cx, cy, payload }: PauseFlagShapeProps): React.ReactElement | null {
  if (cx == null || cy == null || payload?.pauseDurationSec == null) return null;
  const color = magnitudeColor(payload.pauseDurationSec, 300);
  const text = fmtPauseDuration(payload.pauseDurationSec);
  const w = Math.max(28, text.length * 6 + 10);
  return (
    <g transform={`translate(${cx - w / 2}, ${cy - 7})`}>
      <rect width={w} height={14} rx={7} fill={color} />
      <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fill="#1a1a1a">{text}</text>
    </g>
  );
}
