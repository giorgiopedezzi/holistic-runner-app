import type { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="hra-section-title">
      {children}
    </h3>
  );
}
