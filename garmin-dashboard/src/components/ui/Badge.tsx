import type { CSSProperties, ReactNode } from "react";

interface BadgeProps {
  label: string;
  color: string;
  // Optional compact leading glyph (HRA-280) — purely decorative, since
  // `label` already carries the full accessible text; icon SVGs are marked
  // aria-hidden by the caller.
  icon?: ReactNode;
}

export function Badge({ label, color, icon }: BadgeProps) {
  return (
    <span className="hra-badge" style={{ "--badge-color": color } as CSSProperties}>
      {icon}
      {label}
    </span>
  );
}
