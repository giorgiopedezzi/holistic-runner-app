import type { CSSProperties } from "react";

interface BadgeProps { label: string; color: string; }

export function Badge({ label, color }: BadgeProps) {
  return (
    <span className="hra-badge" style={{ "--badge-color": color } as CSSProperties}>
      {label}
    </span>
  );
}
