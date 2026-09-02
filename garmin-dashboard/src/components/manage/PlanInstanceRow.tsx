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
import { useDemoMode } from "@/hooks/useDemoMode";

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
  const demoMode = useDemoMode();

  function rowStatusHint() {
    if (hasDraft) {
      return (
        <span
          title={t("manage.planInstances.unsavedChanges", "Unsaved changes")}
          className="hra-text-warning inline-flex items-center"
        >
          <AlertTriangle size={14} />
        </span>
      );
    }
    return (
      <span className="hra-text-secondary text-meta italic" >
        {t("manage.planInstances.openToEditHint", "Open and edit")}
      </span>
    );
  }

  const title = instance ? (
    <span className="flex items-center gap-2 flex-1 min-w-0">
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{instance.name ?? t("manage.planInstances.untitled", "Untitled race plan")}</span>
      {instance.event && <span className="hra-text-muted text-meta" >{t(`manage.planTemplates.event.${instance.event}`, instance.event)}</span>}
      <span className="hra-text-muted text-meta" >{instance.start_date}</span>
      <Badge
        label={instance.approved_at ? t("manage.planInstances.approved", "Activated") : t("manage.planInstances.notApproved", "Not activated")}
        color={instance.approved_at ? "var(--accent-green)" : "var(--text-muted)"}
      />
      {!expanded && rowStatusHint()}
    </span>
  ) : (
    <span className="flex items-center gap-2 flex-1 min-w-0">
      <span>{newInstanceName || t("manage.planInstances.instantiateTitle", "Create race plan")}</span>
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
    <div className="relative">
      <AccordionCard title={title} expanded={expanded} onToggle={onToggle}>
        {children}
      </AccordionCard>
      <button
        className="hra-card-delete-action hra-btn absolute py-1 px-2 inline-flex items-center" data-variant="danger"
        onClick={() => onDeleteClick?.(instance.id)}
        disabled={demoMode}
        title={demoMode ? t("common.demoModeHint", "Not available for demo") : t("common.delete", "Delete")}
        aria-label={t("common.delete", "Delete")}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
