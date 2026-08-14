import { magnitudeColor } from "@/domain/activity-chart";
import { HR_RECOVERY_COLOR_CAP } from "./shared";

export function HrRecoveryFlagShape(props: unknown): React.ReactElement | null {
  const p = props as { cx?: number; cy?: number; payload?: { hrRecoveryDelta?: number } };
  if (p.cx == null || p.cy == null || p.payload?.hrRecoveryDelta == null) return null;
  const delta = p.payload.hrRecoveryDelta;
  const text = `${delta > 0 ? "−" : delta < 0 ? "+" : "±"}${Math.abs(Math.round(delta))} bpm`;
  const color = magnitudeColor(Math.abs(delta), HR_RECOVERY_COLOR_CAP);
  const w = Math.max(36, text.length * 6 + 10);
  return (
    <g transform={`translate(${p.cx - w / 2}, ${p.cy - 7})`}>
      <rect width={w} height={14} rx={7} fill={color} />
      <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fill="#1a1a1a">{text}</text>
    </g>
  );
}
