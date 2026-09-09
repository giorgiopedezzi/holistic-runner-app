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

// Same "real prop type instead of props: unknown" fix as PauseFlagShape
// (HRA-75) — see its comment for why the narrower interface still
// satisfies Recharts' shape prop.
//
// HRA-303 section 8: a compact marker only, uniformly — see
// PauseFlagShape's own comment for the full rationale (the permanent pill
// is the defect being fixed, not a mobile-only concern; the actual delta is
// revealed on hover/tap instead, via TrackTooltip's own hrRecoveryDelta
// branch now that the standalone Heart rate card is the only place this
// shape renders).
export function HrRecoveryFlagShape({ cx, cy, payload }: HrRecoveryFlagShapeProps): React.ReactElement | null {
  if (cx == null || cy == null || payload?.hrRecoveryDelta == null) return null;
  const clusterSize = payload.hrRecoveryClusterSize ?? 1;
  const isAnchor = clusterSize > 1 && !!payload.hrRecoveryClusterAnchor;
  const delta = isAnchor ? (payload.hrRecoveryClusterAvg ?? payload.hrRecoveryDelta) : payload.hrRecoveryDelta;
  const color = magnitudeColor(Math.abs(delta), HR_RECOVERY_COLOR_CAP);
  const r = isAnchor ? 4.5 : 2.5;
  return <circle cx={cx} cy={cy} r={r} fill={color} />;
}
