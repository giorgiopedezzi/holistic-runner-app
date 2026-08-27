import type { CSSProperties } from "react";

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
    <div className="hra-progress">
      <div className="hra-progress-label">
        <span>{label}</span>
        {determinate && <span>{current} / {total}</span>}
      </div>
      <div className="hra-progress-track">
        {determinate ? (
          <div className="hra-progress-bar" style={{ "--progress-color": accent, "--progress-width": `${pct}%` } as CSSProperties} />
        ) : (
          <div className="hra-progress-bar" data-indeterminate style={{ "--progress-color": accent } as CSSProperties} />
        )}
      </div>
    </div>
  );
}
