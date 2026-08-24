import { useEffect, useState } from "react";
import { subscribeToasts, dismissToast, type ToastItem } from "@/utils/toast";

// Mounted once near the app root (App.tsx) — subscribes to utils/toast.ts's
// module-level stack and renders it. Clicking a toast dismisses it early;
// otherwise it clears itself after utils/toast.ts's own timeout.
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (toasts.length === 0) return null;
  return (
    <div className="hra-toast-stack">
      {toasts.map(item => (
        <div key={item.id} className="hra-toast" data-variant={item.variant} onClick={() => dismissToast(item.id)}>
          {item.message}
        </div>
      ))}
    </div>
  );
}
