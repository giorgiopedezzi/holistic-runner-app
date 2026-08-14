import type { CSSProperties, ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  style?:   CSSProperties;
  className?: string;
}

export function Card({ children, style, className }: CardProps) {
  return (
    <div
      className={className}
      style={{
        background:   "var(--bg-card)",
        border:       "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding:      "16px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
