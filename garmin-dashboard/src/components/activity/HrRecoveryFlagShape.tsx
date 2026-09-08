import { magnitudeColor } from "@/domain/activity-chart";
import { HR_RECOVERY_COLOR_CAP } from "./shared";

interface HrRecoveryFlagShapeProps {
  cx?: number;
  cy?: number;
  payload?: {
    hrRecoveryDelta?: number;
    // HRA-293: set only on mobile, only when this flag sits in a dense
    // cluster (ActivityChartSection's isPhone-gated clustering — see
    // shared.ts's MOBILE_LABEL_CLUSTER_GAP_FRACTION). Undefined/1 on desktop
    // and for any isolated flag, which is why the size<=1 path below is
    // byte-identical to this component's pre-HRA-293 behavior.
    hrRecoveryClusterSize?: number;
    hrRecoveryClusterAnchor?: number;
    hrRecoveryClusterAvg?: number;
  };
}

function fmtDelta(delta: number): string {
  return `${delta > 0 ? "−" : delta < 0 ? "+" : "±"}${Math.abs(Math.round(delta))} bpm`;
}

// Same "real prop type instead of props: unknown" fix as PauseFlagShape
// (HRA-75) — see its comment for why the narrower interface still
// satisfies Recharts' shape prop.
export function HrRecoveryFlagShape({ cx, cy, payload }: HrRecoveryFlagShapeProps): React.ReactElement | null {
  if (cx == null || cy == null || payload?.hrRecoveryDelta == null) return null;
  const clusterSize = payload.hrRecoveryClusterSize ?? 1;
  // Dense mobile clusters (HRA-293): mirrors PauseFlagShape's own anchor +
  // dot pattern — see its comment for the rationale.
  if (clusterSize > 1 && !payload.hrRecoveryClusterAnchor) {
    return <circle cx={cx} cy={cy} r={2.5} fill={magnitudeColor(Math.abs(payload.hrRecoveryDelta), HR_RECOVERY_COLOR_CAP)} />;
  }
  const delta = clusterSize > 1 ? (payload.hrRecoveryClusterAvg ?? payload.hrRecoveryDelta) : payload.hrRecoveryDelta;
  const text = clusterSize > 1 ? `${clusterSize}× ${fmtDelta(delta)} avg` : fmtDelta(delta);
  const color = magnitudeColor(Math.abs(delta), HR_RECOVERY_COLOR_CAP);
  const w = Math.max(36, text.length * 6 + 10);
  return (
    <g transform={`translate(${cx - w / 2}, ${cy - 7})`}>
      <rect width={w} height={14} rx={7} fill={color} />
      <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fill="#1a1a1a">{text}</text>
    </g>
  );
}
