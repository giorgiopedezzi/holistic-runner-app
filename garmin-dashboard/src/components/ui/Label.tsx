import type { ReactNode } from "react";

interface LabelProps {
  children: ReactNode;
  className?: string;
}

// Micro-label primitive (HRA-96): uppercase, 11px, tracking-widest, secondary
// text color — the caption that sits above a KPI value on a Stat-style card.
// Extracted from the identical hand-rolled div this replaced in Stat.tsx,
// SpeedPaceStat.tsx, and ActivityChartSection.tsx. The visual itself is the
// `.hra-label` class (index.css) — callers only ever pass `style` for
// structural spacing overrides (margin), never color, so that stays a plain
// passthrough (correction pass, CLAUDE.md's "styles live in index.css").
export function Label({ children, className }: LabelProps) {
  return (
    <div className={["hra-label", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
