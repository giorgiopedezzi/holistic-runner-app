import { useState } from "react";
import { MoreVertical, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui";
import { useDemoMode } from "@/hooks/useDemoMode";

/**
 * PlanInstanceMobileActionsMenu.tsx (HRA-296)
 * Compact-list overflow action for a mobile race-plan row — mirrors
 * ActivityActionsMenu.tsx's own Popover-triggered menu (same MoreVertical
 * trigger, same "text-labelled destructive button, never a bare icon"
 * shape). Deletion is the only action exposed here: it's the one operation
 * this Story's own list-row scope can support without opening any part of
 * the desktop editor (HRA-294's "no authoring surface on mobile" boundary
 * covers everything else a race plan can do). The actual confirm dialog
 * lives at the section level (PlanInstancesSection's own
 * PlanInstanceConfirmations, already rendered for desktop) — this component
 * only stages it via onRequestDelete, same as the desktop row's own
 * onDeleteClick already does.
 */
interface Props {
  onRequestDelete: () => void;
}

export function PlanInstanceMobileActionsMenu({ onRequestDelete }: Props) {
  const { t } = useTranslation();
  const demoMode = useDemoMode();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("manage.planInstances.mobileActionsMenu", "Race plan actions")}
        className="hra-icon-action hra-nav-hover hra-text-muted bg-transparent border-0 cursor-pointer inline-flex items-center justify-center"
      >
        <MoreVertical size={18} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="flex flex-col gap-2 min-w-40">
          <button
            type="button"
            className="hra-btn flex items-center justify-center gap-1.5"
            data-variant="cta"
            data-tone="red"
            disabled={demoMode}
            title={demoMode ? t("common.demoModeHint", "Not available for demo") : undefined}
            onClick={() => { setOpen(false); onRequestDelete(); }}
          >
            <Trash2 size={13} aria-hidden="true" />
            {t("common.delete", "Delete")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
