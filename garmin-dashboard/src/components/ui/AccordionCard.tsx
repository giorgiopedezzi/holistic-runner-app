import type { ReactNode } from "react";

interface AccordionCardProps {
  // Usually a plain string; a ReactNode is accepted too so a caller can pack
  // a compact always-visible summary/icons alongside the label itself
  // (TrainingPlanAccordion.tsx, HRA-118 follow-up) without a second prop.
  title: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

// A single collapsible section: a clickable "card" header (title + ▲/▼
// chevron) with its content in an attached panel below when expanded — the
// same visual language (button.card + a borderRadius split between header
// and panel so they read as one joined block) ActivitiesTab.tsx's row
// accordion and the Overview tab's linked-race row already use (see
// components/activity/ActivityRow.tsx). Callers own the expanded/single-
// expand state — this component is purely presentational, one section.
export function AccordionCard({ title, expanded, onToggle, children }: AccordionCardProps) {
  return (
    <div style={{ marginBottom: 16 }}>
      <button
        className="card hra-text-primary"
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", textAlign: "left", padding: "14px 18px",
          borderRadius: expanded ? "16px 16px 0 0" : "16px",
          fontSize: 15, fontWeight: 600, cursor: "pointer",
        }}
      >
        {title}
        <span className="hra-text-muted" style={{ fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="card hra-card-joined-bottom" style={{ padding: "18px" }}>
          {children}
        </div>
      )}
    </div>
  );
}
