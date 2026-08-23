import type { ReactNode } from "react";

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: "grid",
      // auto-fit (not auto-fill) — dashboard design-system rework, "space
      // badges equally": auto-fill creates extra empty tracks to fill the
      // row's width, leaving the real items packed to the left with only
      // the 10px gap between them; auto-fit collapses those empty tracks to
      // 0 so the existing 1fr items themselves stretch to share the full
      // row width evenly instead.
      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
      gap: 10,
    }}>
      {children}
    </div>
  );
}
