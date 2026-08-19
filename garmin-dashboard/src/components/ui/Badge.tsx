import type { CSSProperties } from "react";

interface BadgeProps { label: string; color: string; }

export function Badge({ label, color }: BadgeProps) {
  return (
    <span className="hra-dyn-bg hra-dyn-color" style={{
      display:       "inline-block",
      fontSize:      11,
      fontWeight:    600,
      padding:       "2px 9px",
      borderRadius:  20,
      "--dyn-bg":    `${color}22`,
      "--dyn-color": color,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    } as CSSProperties}>
      {label}
    </span>
  );
}
