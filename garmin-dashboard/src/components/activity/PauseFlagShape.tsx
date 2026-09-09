import { magnitudeColor } from "@/domain/activity-chart";

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
//
// HRA-303 section 8: a compact marker only, in every state — no permanently
// rendered duration pill. The Story is explicit that permanently-visible
// pause/recovery labels are the defect being fixed ("Do not permanently
// render every pause or recovery value as a pill above the line"), not a
// mobile-only one, so this applies uniformly rather than behind an isPhone
// branch. The actual duration is revealed on hover/tap instead — the main
// chart's own mouse-follow readout already shows it (RunnerReadout, driven
// by ActivityChartSection's onMouseMove), and TrackTooltip shows it for any
// chart using Recharts' native <Tooltip> (which also fires on touch, not
// just mouse). A cluster's anchor member (HRA-293 clustering, still needed
// so overlapping markers aggregate per section 8's own requirement) draws a
// visibly larger dot than a lone marker so a reader can tell there's more
// than one stop there without a text pile-up; every other cluster member
// keeps marking its own real position with the plain small dot.
export function PauseFlagShape({ cx, cy, payload }: PauseFlagShapeProps): React.ReactElement | null {
  if (cx == null || cy == null || payload?.pauseDurationSec == null) return null;
  const clusterSize = payload.pauseClusterSize ?? 1;
  const isAnchor = clusterSize > 1 && !!payload.pauseClusterAnchor;
  const totalSec = isAnchor ? (payload.pauseClusterTotalSec ?? payload.pauseDurationSec) : payload.pauseDurationSec;
  const color = magnitudeColor(totalSec, 300);
  const r = isAnchor ? 4.5 : 2.5;
  return <circle cx={cx} cy={cy} r={r} fill={color} />;
}
