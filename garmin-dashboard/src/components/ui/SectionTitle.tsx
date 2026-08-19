import type { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="hra-text-secondary" style={{
      fontSize:      13,
      fontWeight:    600,
      textTransform: "uppercase",
      letterSpacing: "0.07em",
      margin:        "24px 0 12px",
    }}>
      {children}
    </h3>
  );
}
