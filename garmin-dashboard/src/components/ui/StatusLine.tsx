import { useTranslation } from "react-i18next";

// "● connected" / "○ not connected" indicator with an optional manual
// recheck button. Used for capability checks (device plugged in, auth token
// valid) that are checked once on mount rather than polled in the
// background — the recheck button covers state changes since then (watch
// plugged in later, token re-authorized elsewhere).
interface StatusLineProps {
  state:      "checking" | "ok" | "warn" | "error";
  message:    string;
  onRecheck?: () => void;
}

export function StatusLine({ state, message, onRecheck }: StatusLineProps) {
  const { t } = useTranslation();
  const checking = state === "checking";
  return (
    <div className="hra-status-line" data-state={state}>
      <span className="hra-status-line-icon" aria-hidden="true">{checking ? "⏳" : "●"}</span>
      <span>{message}</span>
      {onRecheck && (
        <button
          type="button"
          className="hra-status-line-recheck"
          onClick={onRecheck}
          disabled={checking}
          title={t("common.recheck", "Recheck")}
        >
          ⟳
        </button>
      )}
    </div>
  );
}
