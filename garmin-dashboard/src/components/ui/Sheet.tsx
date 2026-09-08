import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

// HRA-290 — first-of-its-kind bottom-sheet primitive. `@radix-ui/react-dialog`
// (same family as the app's existing Popover/Select/Checkbox) gives the
// accessibility contract this needed for free: a real focus trap while open,
// Escape/outside-pointer-down dismissal, and focus restored to the trigger on
// close — none of which this codebase had a hand-rolled equivalent of to
// build on (unlike ConfirmModal, which never trapped focus). Kept deliberately
// minimal (open/close, backdrop, title, children) so Story 3's "Chart
// options" disclosure can reuse it unchanged.
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;

interface SheetContentProps {
  title: string;
  children: ReactNode;
}

export function SheetContent({ title, children }: SheetContentProps) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="hra-sheet-overlay" />
      <DialogPrimitive.Content className="hra-sheet-content" aria-describedby={undefined}>
        <div className="hra-sheet-header">
          <DialogPrimitive.Title className="text-label hra-text-primary font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="hra-sheet-close" aria-label={t("common.close", "Close")}>
            <X size={18} aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
        <div className="hra-sheet-body">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
