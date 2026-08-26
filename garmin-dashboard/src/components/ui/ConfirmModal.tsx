import type { ReactNode } from "react";
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
}

export function ConfirmModal({ open, title, confirmLabel, cancelLabel, variant = "default", maxWidth = 360, onConfirm, onCancel }: ConfirmModalProps) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={onCancel}>
      <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth, padding: 20 }} onClick={e => e.stopPropagation()}>
        {title}
        <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
          <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={onCancel}>
            {cancelLabel ?? t("common.cancel", "Cancel")}
          </button>
          <button className="hra-btn" data-variant={variant === "default" ? undefined : variant} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
