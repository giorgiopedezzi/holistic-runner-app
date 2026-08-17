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

const STATUS_COLOR: Record<StatusLineProps["state"], string> = {
  checking: "var(--text-muted)",
  ok:       "var(--accent-green)",
  warn:     "var(--text-muted)",
  error:    "var(--accent-red)",
};

export function StatusLine({ state, message, onRecheck }: StatusLineProps) {
  const checking = state === "checking";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12, color: "var(--text-secondary)" }}>
      <span style={{ color: STATUS_COLOR[state], fontSize: 10 }}>{checking ? "⏳" : "●"}</span>
      <span>{message}</span>
      {onRecheck && (
        <button
          className="hra-nav-hover"
          onClick={onRecheck}
          disabled={checking}
          title="Recheck"
          style={{
            background: "none", border: "none", borderRadius: "var(--radius-sm)", color: "var(--text-muted)",
            cursor: checking ? "not-allowed" : "pointer", fontSize: 13, padding: "2px 5px", lineHeight: 1,
          }}
        >
          ⟳
        </button>
      )}
    </div>
  );
}
