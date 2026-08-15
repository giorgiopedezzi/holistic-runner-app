import type { CSSProperties, ReactNode } from "react";

interface LabelProps {
  children: ReactNode;
  style?: CSSProperties;
}

// Micro-label primitive (HRA-96): uppercase, 11px, tracking-widest, secondary
// text color — the caption that sits above a KPI value on a Stat-style card.
// Extracted from the identical hand-rolled div this replaced in Stat.tsx,
// SpeedPaceStat.tsx, and ActivityChartSection.tsx.
export function Label({ children, style }: LabelProps) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
