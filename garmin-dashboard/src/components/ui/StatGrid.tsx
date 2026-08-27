import type { ReactNode } from "react";

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="hra-stat-grid">{children}</div>;
}
