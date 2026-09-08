import { magnitudeColor } from "@/domain/activity-chart";
import { fmtPauseDuration } from "@/domain/pauses";

interface PauseFlagShapeProps {
  cx?: number;
  cy?: number;
  payload?: {
    pauseDurationSec?: number;
    // HRA-293: set only on mobile, only when this pause sits in a dense
    // cluster (ActivityChartSection's isPhone-gated clustering -- see
    // shared.ts's MOBILE_LABEL_CLUSTER_GAP_FRACTION). Undefined/1 on desktop
    // and for any isolated pause, which is why the size<=1 path below is
    // byte-identical to this component's pre-HRA-293 behavior.
    pauseClusterSize?: number;
    pauseClusterAnchor?: number;
    pauseClusterTotalSec?: number;
  };
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
  const clusterSize = payload.pauseClusterSize ?? 1;
  // Dense mobile clusters (HRA-293): only the cluster's middle member draws
  // a label — an aggregated one, combining every member's duration — so a
  // run of closely-spaced pauses never stacks into overlapping pills. The
  // other members still mark their real position with a plain dot, so a
  // reader can see there were multiple stops without a label pile-up.
  if (clusterSize > 1 && !payload.pauseClusterAnchor) {
    return <circle cx={cx} cy={cy} r={2.5} fill={magnitudeColor(payload.pauseDurationSec, 300)} />;
  }
  const totalSec = clusterSize > 1 ? (payload.pauseClusterTotalSec ?? payload.pauseDurationSec) : payload.pauseDurationSec;
  const color = magnitudeColor(totalSec, 300);
  const text = clusterSize > 1 ? `${clusterSize}× ${fmtPauseDuration(totalSec)}` : fmtPauseDuration(totalSec);
  const w = Math.max(28, text.length * 6 + 10);
  return (
    <g transform={`translate(${cx - w / 2}, ${cy - 7})`}>
      <rect width={w} height={14} rx={7} fill={color} />
      <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fill="#1a1a1a">{text}</text>
    </g>
  );
}
