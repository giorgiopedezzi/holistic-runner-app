import type { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 style={{
      fontSize:      13,
      fontWeight:    600,
      color:         "var(--text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.07em",
      margin:        "24px 0 12px",
    }}>
      {children}
    </h3>
  );
}
