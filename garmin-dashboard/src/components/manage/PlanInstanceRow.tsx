/**
 * PlanInstanceRow.tsx (HRA-171)
 * One row of PlanInstancesSection's list — either the unsaved "new" draft
 * row (`instance === null`) or a persisted instance's row. Both used to be
 * copy-pasted AccordionCard blocks in PlanInstancesSection.tsx's own
 * return(), differing only in title content and whether a Delete button
 * exists; this is that one shared shape. renderRowTitle/rowStatusHint moved
 * in here too since they only ever existed to feed this row's title.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Trash2 } from "lucide-react";
import { AccordionCard, Badge } from "@/components/ui";
import type { PlanInstance } from "@/types/api";

interface Props {
  instance: PlanInstance | null; // null = the "new" draft row
  newInstanceName?: string; // instName — only read when instance is null
  expanded: boolean;
  hasDraft: boolean;
  onToggle: () => void;
  onDeleteClick?: (id: number) => void; // only used for a persisted instance
  children: ReactNode;
}

export function PlanInstanceRow({ instance, newInstanceName, expanded, hasDraft, onToggle, onDeleteClick, children }: Props) {
  const { t } = useTranslation();

  function rowStatusHint() {
    if (hasDraft) {
      return (
        <span
          title={t("manage.planInstances.unsavedChanges", "Unsaved changes")}
          className="hra-text-warning"
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          <AlertTriangle size={14} />
        </span>
      );
    }
    return (
      <span className="hra-text-secondary" style={{ fontSize: 11, fontStyle: "italic" }}>
        {t("manage.planInstances.openToEditHint", "Open to edit")}
      </span>
    );
  }

  const title = instance ? (
    <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{instance.name ?? t("manage.planInstances.untitled", "Untitled instance")}</span>
      {instance.event && <span className="hra-text-muted" style={{ fontSize: 11 }}>{t(`manage.planTemplates.event.${instance.event}`, instance.event)}</span>}
      <span className="hra-text-muted" style={{ fontSize: 11 }}>{instance.start_date}</span>
      <Badge
        label={instance.approved_at ? t("manage.planInstances.approved", "Approved") : t("manage.planInstances.notApproved", "Not approved")}
        color={instance.approved_at ? "var(--accent-green)" : "var(--text-muted)"}
      />
      {!expanded && rowStatusHint()}
    </span>
  ) : (
    <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
      <span>{newInstanceName || t("manage.planInstances.instantiateTitle", "New instance")}</span>
      {!expanded && rowStatusHint()}
    </span>
  );

  if (!instance) {
    return (
      <AccordionCard title={title} expanded={expanded} onToggle={onToggle}>
        {children}
      </AccordionCard>
    );
  }

  return (
    // HRA-141 (same pattern as PlanTemplatesSection/HRA-140's own round-2
    // review fix): Delete is a real DOM SIBLING of the AccordionCard,
    // overlaid on its collapsed header via position:absolute + z-index
    // rather than living inside the header <button> (invalid HTML) or as a
    // separate column beside the card. Works whether the row is expanded or
    // collapsed.
    <div style={{ position: "relative" }}>
      <AccordionCard title={title} expanded={expanded} onToggle={onToggle}>
        {children}
      </AccordionCard>
      <button
        className="hra-btn" data-variant="danger"
        onClick={() => onDeleteClick?.(instance.id)}
        title={t("common.delete", "Delete")}
        aria-label={t("common.delete", "Delete")}
        style={{ position: "absolute", top: 15, right: 46, zIndex: 1, padding: "4px 8px", display: "inline-flex", alignItems: "center" }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
