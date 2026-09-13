/**
 * useDialogA11y.ts (HRA-339)
 * Minimal shared keyboard/focus behavior for the hand-rolled full-screen
 * report-modal "dialog" divs (none of which use a native <dialog> element or
 * a shared Modal wrapper): Escape closes the dialog, Tab/Shift+Tab stay
 * looped inside whichever dialog currently holds focus, and focus returns to
 * whatever triggered the dialog once it closes. Does not touch backdrop-click
 * behavior — report modals close only via their own × button or Escape,
 * matching the app's existing "no accidental close on backdrop click"
 * convention (see docs/frontend.md's ActivityModal note).
 */
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]", "button:not([disabled])", "textarea:not([disabled])",
  "input:not([disabled])", "select:not([disabled])", "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

// Escape must close only the innermost (topmost) of possibly several
// simultaneously-mounted report-modal layers — PlanReportModal can have a
// WeekReportModal and a WorkoutReportModal both mounted at once (see its own
// drill-down chain). A plain per-instance document listener would fire every
// open layer's onClose at once; this module-level stack (mount order = drill
// order, since a child level only ever opens after its parent already
// mounted) ensures only the most-recently-opened layer's close handler runs.
const escapeStack: Array<() => void> = [];

function handleGlobalEscape(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const top = escapeStack[escapeStack.length - 1];
  top?.();
}

export function useDialogA11y(onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    triggerRef.current = document.activeElement;
    containerRef.current?.focus();

    const closeSelf = () => onCloseRef.current();
    escapeStack.push(closeSelf);
    if (escapeStack.length === 1) document.addEventListener("keydown", handleGlobalEscape);

    function handleTabTrap(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const container = containerRef.current;
      // Only the dialog that currently holds focus traps Tab — this
      // naturally scopes the trap to whichever layer is topmost without
      // needing its own stack, since focus can only ever be inside one
      // layer's subtree at a time.
      if (!container || !container.contains(document.activeElement)) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleTabTrap);

    return () => {
      document.removeEventListener("keydown", handleTabTrap);
      const idx = escapeStack.indexOf(closeSelf);
      if (idx >= 0) escapeStack.splice(idx, 1);
      if (escapeStack.length === 0) document.removeEventListener("keydown", handleGlobalEscape);
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, []);

  return containerRef;
}
