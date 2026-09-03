import type { ReactNode } from "react";

interface AccordionCardProps {
  // Usually a plain string; a ReactNode is accepted too so a caller can pack
  // a compact always-visible summary/icons alongside the label itself
  // (TrainingPlanAccordion.tsx, HRA-118 follow-up) without a second prop.
  title: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  // Applied to the outer wrapping element (not the trigger/panel individually)
  // — lets a caller flag the whole card as e.g. just-edited (TrainingPlanAccordion's
  // row highlight) without reaching into this component's own markup.
  className?: string;
}

// A single collapsible section: a clickable "card" header (title + ▲/▼
// chevron) with its content in an attached panel below when expanded — the
// same visual language (.card + a borderRadius split between header and
// panel so they read as one joined block) ActivitiesTab.tsx's row accordion
// and the Overview tab's linked-race row already use (see
// components/activity/ActivityRow.tsx). Callers own the expanded/single-
// expand state — this component is purely presentational, one section.
//
// HRA-203: the trigger is a `role="button"` div, not a real `<button>` — a
// real `<button>` was used until this Story, but its `title` prop can now
// itself carry a real, independently-clickable `<button>` (the Section/Week
// "Generate fit" control, TrainingPlanAccordion.tsx's TitleRow), and
// `<button>` cannot legally contain another `<button>` (HTML's interactive-
// content restriction — some browsers reparent/break the nested one out of
// the DOM rather than rendering it in place). Manual `role="button"` +
// `tabIndex`/`onKeyDown` keeps it exactly as keyboard-operable as the
// original `<button>` was.
export function AccordionCard({ title, expanded, onToggle, children, className }: AccordionCardProps) {
  return (
    <div className={["hra-accordion-card", className].filter(Boolean).join(" ")}>
      <div
        role="button"
        tabIndex={0}
        className="card hra-accordion-trigger"
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onToggle();
        }}
        aria-expanded={expanded}
        data-expanded={expanded}
      >
        {title}
        <span className="hra-accordion-chevron" aria-hidden="true">{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div className="card hra-card-joined-bottom hra-accordion-panel">
          {children}
        </div>
      )}
    </div>
  );
}
