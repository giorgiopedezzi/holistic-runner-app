import { PRESETS, type DateRangeState } from "@/hooks/useDateRange";

type Props = DateRangeState;

export function DateRangeBar({ from, to, setFrom, setTo, setPreset }: Props) {
  function isActive(days: number) {
    const target = days >= 9999 ? "2000-01-01"
      : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return from === target;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {PRESETS.map(p => (
        <button
          key={p.label}
          onClick={() => setPreset(p.days)}
          style={{
            background:   isActive(p.days) ? "var(--bg-card)" : "none",
            border:       "1px solid",
            borderColor:  isActive(p.days) ? "var(--border-strong)" : "var(--border)",
            borderRadius: "var(--radius-sm)",
            padding:      "4px 12px",
            fontSize:     13,
            color:        isActive(p.days) ? "var(--text-primary)" : "var(--text-secondary)",
            fontWeight:   isActive(p.days) ? 600 : 400,
            transition:   "all 0.15s",
          }}
        >
          {p.label}
        </button>
      ))}

      <span style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 4px" }}>or</span>

      <input
        type="date"
        value={from}
        max={to}
        onChange={e => setFrom(e.target.value)}
      />
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>→</span>
      <input
        type="date"
        value={to}
        min={from}
        onChange={e => setTo(e.target.value)}
      />
    </div>
  );
}
