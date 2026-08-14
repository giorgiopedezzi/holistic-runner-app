import { magnitudeColor } from "@/domain/activity-chart";
import { HR_RECOVERY_COLOR_CAP } from "./shared";

interface HrRecoveryFlagShapeProps {
  cx?: number;
  cy?: number;
  payload?: { hrRecoveryDelta?: number };
}

// Same "real prop type instead of props: unknown" fix as PauseFlagShape
// (HRA-75) — see its comment for why the narrower interface still
// satisfies Recharts' shape prop.
export function HrRecoveryFlagShape({ cx, cy, payload }: HrRecoveryFlagShapeProps): React.ReactElement | null {
  if (cx == null || cy == null || payload?.hrRecoveryDelta == null) return null;
  const delta = payload.hrRecoveryDelta;
  const text = `${delta > 0 ? "−" : delta < 0 ? "+" : "±"}${Math.abs(Math.round(delta))} bpm`;
  const color = magnitudeColor(Math.abs(delta), HR_RECOVERY_COLOR_CAP);
  const w = Math.max(36, text.length * 6 + 10);
  return (
    <g transform={`translate(${cx - w / 2}, ${cy - 7})`}>
      <rect width={w} height={14} rx={7} fill={color} />
      <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fill="#1a1a1a">{text}</text>
    </g>
  );
}
