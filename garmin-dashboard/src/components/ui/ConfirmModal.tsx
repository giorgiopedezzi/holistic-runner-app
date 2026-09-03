import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

// HRA-167: extracted from PlanInstancesSection.tsx's 8 hand-rolled confirm
// dialogs — reuses the existing hra-modal-backdrop / hra-bg-surface / hra-btn
// classes, no new CSS. `title` is a fully-styled ReactNode (not a bare
// string) so a call site with more than one text block (e.g. a heading plus
// a secondary explanation) can reproduce its own markup unchanged; ConfirmModal
// itself imposes no spacing around it.
interface ConfirmModalProps {
  open: boolean;
  title: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "default" | "danger" | "green";
  maxWidth?: number;
  onConfirm: () => void;
  onCancel: () => void;
  // HRA-249: a single-acknowledgement notice (e.g. an activation-conflict
  // warning) has nothing to cancel — there was never a second action to
  // decline. Renders only the one button (confirmLabel), which calls
  // onConfirm; onCancel is still required by the type (backdrop-click still
  // needs somewhere to go) but never rendered as its own button.
  singleAction?: boolean;
}

export function ConfirmModal({ open, title, confirmLabel, cancelLabel, variant = "default", maxWidth = 360, onConfirm, onCancel, singleAction }: ConfirmModalProps) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="hra-modal-backdrop hra-confirm-modal-backdrop" onClick={onCancel}>
      <div
        className="hra-confirm-modal hra-bg-surface hra-border"
        role="dialog"
        aria-modal="true"
        style={{ "--confirm-modal-max-width": `${maxWidth}px` } as CSSProperties}
        onClick={e => e.stopPropagation()}
      >
        {title}
        <div className="hra-confirm-modal-actions">
          {!singleAction && (
            <button type="button" className="hra-confirm-modal-cancel" onClick={onCancel} autoFocus>
              {cancelLabel ?? t("common.cancel", "Cancel")}
            </button>
          )}
          <button type="button" className="hra-btn" data-variant={variant === "default" ? undefined : variant} onClick={onConfirm} autoFocus={singleAction}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
