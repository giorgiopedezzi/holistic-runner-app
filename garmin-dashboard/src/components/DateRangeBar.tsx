import { PRESETS, type DateRangeState } from "@/hooks/useDateRange";
import { DatePicker } from "@/components/ui";

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
          className={`hra-pill hra-nav-hover ${isActive(p.days) ? "hra-pill-active" : ""}`}
          onClick={() => setPreset(p.days)}
          style={{
            background:   isActive(p.days) ? undefined : "none",
            border:       isActive(p.days) ? undefined : "1px solid var(--border)",
            borderRadius: 999,
            padding:      "3px 10px",
            fontSize:     12,
            color:        isActive(p.days) ? undefined : "var(--text-secondary)",
            fontWeight:   isActive(p.days) ? 600 : 400,
          }}
        >
          {p.label}
        </button>
      ))}

      <span style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 4px" }}>or</span>

      <DatePicker value={from} max={to} onChange={setFrom} />
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>→</span>
      <DatePicker value={to} min={from} onChange={setTo} />
    </div>
  );
}
