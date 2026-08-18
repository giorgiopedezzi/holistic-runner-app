import { PRESETS, type DateRangeState } from "@/hooks/useDateRange";
import type { CompareRangeState } from "@/hooks/useCompareRange";
import { DatePicker } from "@/components/ui";

// `compare` is optional — Activities/Body tabs render this bar without it
// and get exactly the original layout (no "Current"/"Compare to" labels,
// no second picker pair); only Overview & Trends passes a CompareRangeState,
// since the comparison concept only means anything there.
type Props = DateRangeState & { compare?: CompareRangeState };

const columnLabelStyle = {
  fontSize: 11, color: "var(--text-muted)", fontWeight: 600,
  textTransform: "uppercase" as const, letterSpacing: "0.04em",
};

export function DateRangeBar({ from, to, setFrom, setTo, setPreset, compare }: Props) {
  function isActive(days: number) {
    const target = days >= 9999 ? "2000-01-01"
      : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return from === target;
  }

  const currentPickers = (
    <>
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
    </>
  );

  if (!compare) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {currentPickers}
      </div>
    );
  }

  // A rigid 50/50 grid (the previous version) capped the LEFT side to half
  // the row's width even though only the right side is actually short —
  // that's what forced the "to" picker onto its own line while the right
  // half sat mostly empty. Flex + space-between instead: neither side has a
  // fixed width, each sizes to its own content, and — since both rows below
  // share the exact same "one span/group flush left, one flush right"
  // shape — the left edges land on top of each other and the right edges
  // land on top of each other for free, with no shared grid needed to force
  // it structurally.
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={columnLabelStyle}>Current</span>
        <span style={columnLabelStyle}>Compare to</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {currentPickers}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <DatePicker value={compare.from} max={compare.to} onChange={compare.setFrom} />
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>→</span>
          <DatePicker value={compare.to} min={compare.from} onChange={compare.setTo} />
        </div>
      </div>
    </div>
  );
}
