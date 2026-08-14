// Determinate when total > 0 (fills to current/total); indeterminate
// (animated stripe) when total is 0 — e.g. before a device enumeration
// reports back how many files there are to sync.
interface ProgressBarProps {
  label:    string;
  current?: number;
  total?:   number;
  accent?:  string;
}

export function ProgressBar({ label, current = 0, total = 0, accent = "var(--accent-green)" }: ProgressBarProps) {
  const determinate = total > 0;
  const pct = determinate ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
        <span>{label}</span>
        {determinate && <span>{current} / {total}</span>}
      </div>
      <div style={{ position: "relative", overflow: "hidden", height: 6, borderRadius: 999, background: "var(--border)" }}>
        {determinate ? (
          <div style={{ height: "100%", width: `${pct}%`, background: accent, borderRadius: 999, transition: "width 0.2s ease" }} />
        ) : (
          <div style={{
            position: "absolute", top: 0, bottom: 0, width: "40%", borderRadius: 999,
            background: accent, animation: "progress-indeterminate 1.1s ease-in-out infinite",
          }} />
        )}
      </div>
    </div>
  );
}
