import { useState } from "react";
import { MoreVertical, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Popover, PopoverTrigger, PopoverContent, ConfirmModal } from "@/components/ui";
import type { Activity } from "@/types/api";
import { useDemoMode } from "@/hooks/useDemoMode";
import { ActivityTypePicker } from "./ActivityTypePicker";

// HRA-291 mobile-width overflow menu: bundles type change, rename (both via
// the unchanged ActivityTypePicker) and delete — the same three actions
// ActivityRow's column 2 / ActivityDetailBody's popup header exposed as
// separate always-visible controls — behind one Popover-triggered menu, so
// they stop competing with the primary result for space on a narrow screen.
// Desktop is untouched: both callers keep rendering the inline
// ActivityTypePicker + plain Delete button for !isPhone, this component only
// mounts at phone width.
//
// Delete moves off the inline "Move to trash? / Yes / Cancel" row (there's no
// room for it inside a menu popover) onto the shared ConfirmModal — the Story
// scope calls for reusing it rather than building a new confirmation flow.
interface ActivityActionsMenuProps {
  activity: Activity;
  onUpdate: (a: Activity) => void;
  onDelete: (id: number) => void;
  // Popup variant closes itself after a successful delete (mirrors the
  // existing onClose?.() in ActivityDetailBody's own handleDelete); the
  // accordion row has nothing to close, so ActivityRow omits this.
  onDeleted?: () => void;
}

export function ActivityActionsMenu({ activity, onUpdate, onDelete, onDeleted }: ActivityActionsMenuProps) {
  const { t } = useTranslation();
  const demoMode = useDemoMode();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    try {
      await api.garmin.deleteOne(activity.id);
      setConfirmOpen(false);
      onDelete(activity.id);
      onDeleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("activity.detail.deleteFailed", "Delete failed"));
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={t("activity.detail.actionsMenu", "Activity actions")}
          className="hra-icon-action hra-nav-hover hra-text-muted bg-transparent border-0 cursor-pointer inline-flex items-center justify-center"
        >
          <MoreVertical size={18} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="end">
          <div className="flex flex-col gap-2 min-w-40">
            <ActivityTypePicker activity={activity} onUpdate={onUpdate} />
            <button
              type="button"
              className="hra-btn flex items-center justify-center gap-1.5"
              data-variant="cta"
              data-tone="red"
              disabled={demoMode}
              title={demoMode ? t("common.demoModeHint", "Not available for demo") : undefined}
              onClick={() => { setOpen(false); setConfirmOpen(true); }}
            >
              <Trash2 size={13} aria-hidden="true" />
              {t("activity.detail.deleteButton", "Remove activity")}
            </button>
            {error && <span className="hra-text-danger text-meta">{error}</span>}
          </div>
        </PopoverContent>
      </Popover>
      <ConfirmModal
        open={confirmOpen}
        title={<span className="hra-text-danger text-label font-semibold">{t("activity.detail.moveToTrash", "Move to trash?")}</span>}
        confirmLabel={t("common.yesDelete", "Yes, delete")}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
