/**
 * utils/toast.ts
 * Global, transient success/error notifications for a CTA whose result
 * isn't otherwise obvious from the UI — a save, an approve, a background
 * action (see CLAUDE.md's "every CTA without a direct UI impact must
 * notify" rule). Module-scope pub/sub, not React context — mirroring
 * utils/units.ts's own global-state convention — so any event handler can
 * call notify() directly with no Provider needed in the tree.
 * components/ui/ToastContainer.tsx is the one subscriber that renders the
 * current stack; mount it once, near the app root (App.tsx).
 */

export type ToastVariant = "success" | "error";
export interface ToastItem { id: number; message: string; variant: ToastVariant }

const DURATION_MS = 4000;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(toasts: ToastItem[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

export function notify(message: string, variant: ToastVariant = "success"): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, variant }];
  emit();
  setTimeout(() => dismissToast(id), DURATION_MS);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter(item => item.id !== id);
  emit();
}

export function subscribeToasts(listener: (toasts: ToastItem[]) => void): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => { listeners.delete(listener); };
}
