import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { PRESETS, type DateRangeState } from "@/hooks/useDateRange";
import type { CompareRangeState } from "@/hooks/useCompareRange";
import { DatePicker, Select, Switch } from "@/components/ui";
import type { SavedDateRange } from "@/types/api";
import { fmtDate } from "@/utils/fmt";

// savedRanges: only meaningful (and only ever passed) alongside `compare` —
// Overview & Trends owns the fetch (it also needs the list itself, to
// detect a linked race) and passes the same array down, rather than this
// component fetching its own copy. Activities/Body's plain single-range bar
// passes neither.
type Props = DateRangeState & { compare?: CompareRangeState; savedRanges?: SavedDateRange[] };

const NO_NAMED_RANGE = "";
const orStyle = { fontSize: 12 };

function savedRangeLabel(r: SavedDateRange): string {
  return `${r.name} (${fmtDate(r.from_date)} → ${fmtDate(r.to_date)})`;
}

export function DateRangeBar({ from, to, setFrom, setTo, setPreset, compare, savedRanges = [] }: Props) {
  const { t } = useTranslation();
  function isActive(days: number) {
    const target = days >= 9999 ? "2000-01-01"
      : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return from === target;
  }

  // ── Activities/Body's plain single-range bar (no `compare`) — unchanged,
  //    still the pill row. The dropdown/toggle redesign below is scoped to
  //    Overview & Trends, the only caller that passes `compare`. ──
  if (!compare) {
    return (
      <div className="hra-row-wrap">
        {PRESETS.map(p => (
          <button
            key={p.label}
            className={`hra-pill hra-nav-hover hra-dyn-bg hra-dyn-border hra-dyn-color ${isActive(p.days) ? "hra-pill-active" : ""}`}
            onClick={() => setPreset(p.days)}
            style={{
              borderRadius: 999,
              padding:      "3px 10px",
              fontSize:     12,
              fontWeight:   isActive(p.days) ? 600 : 400,
              "--dyn-bg":     isActive(p.days) ? undefined : "none",
              "--dyn-border": isActive(p.days) ? undefined : "var(--border)",
              "--dyn-color":  isActive(p.days) ? undefined : "var(--text-secondary)",
            } as CSSProperties}
          >
            {t(`common.preset.${p.days}`, p.label)}
          </button>
        ))}
        <span className="hra-text-muted" style={{ fontSize: 12, margin: "0 4px" }}>or</span>
        <DatePicker value={from} max={to} onChange={setFrom} />
        <span className="hra-text-muted" style={{ fontSize: 12 }}>→</span>
        <DatePicker value={to} min={from} onChange={setTo} />
      </div>
    );
  }

  // Derived, not separately stored — a side's named-range dropdown shows
  // whichever saved range's (from_date, to_date) currently matches that
  // side's live from/to, same pattern as the preset pills' isActive() above.
  // Picking one just calls the same setFrom/setTo every other control here
  // already uses, so "takes precedence" falls out for free (last write
  // wins, no separate locked flag to keep in sync).
  const activePreset = PRESETS.find(p => isActive(p.days));
  const currentNamedId = savedRanges.find(r => r.from_date === from && r.to_date === to)?.id;
  const compareNamedId = savedRanges.find(r => r.from_date === compare.from && r.to_date === compare.to)?.id;
  // Compare-side ranges are only offered if they ended before CURRENT's own
  // start — a training block can't be "compared to" something that overlaps
  // or postdates it.
  const eligibleForCompare = savedRanges.filter(r => r.to_date < from);

  function pickCurrent(idStr: string) {
    if (idStr === NO_NAMED_RANGE) return;
    const r = savedRanges.find(x => String(x.id) === idStr);
    if (r) { setFrom(r.from_date); setTo(r.to_date); }
  }
  function pickCompare(idStr: string) {
    if (idStr === NO_NAMED_RANGE) return;
    const r = eligibleForCompare.find(x => String(x.id) === idStr);
    // Non-null: this component returned early above when `compare` is
    // undefined — TS just can't carry that narrowing into a nested function
    // declaration's closure.
    if (r) { compare!.setFrom(r.from_date); compare!.setTo(r.to_date); }
  }

  return (
    <div>
      {/* "Current" title on the left; the Compare on/off switch pinned to
          the row's right end (not beside the title) — when off, no second
          row at all and OverviewTab adds no comparison data anywhere
          (rings, sport trend charts, linked race). */}
      <div className="hra-row-between">
        <span className="hra-text-primary" style={{ fontSize: 13, fontWeight: 600 }}>{t("dateRange.current", "Current")}</span>
        <label className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
          {t("dateRange.enableComparison", "Enable comparison")}
          <Switch checked={compare.enabled} onCheckedChange={compare.setEnabled} />
        </label>
      </div>

      {/* One row: preset dropdown (was individual pills — a dropdown frees
          enough width for the named-range picker to fit on the same line),
          the manual date pickers, and the named-range picker. */}
      <div className="hra-row-wrap">
        <Select
          value={activePreset ? String(activePreset.days) : NO_NAMED_RANGE}
          onValueChange={v => setPreset(Number(v))}
          placeholder={t("dateRange.customRange", "Custom range")}
          triggerStyle={{ minWidth: 90 }}
          options={PRESETS.map(p => ({ value: String(p.days), label: t(`common.preset.${p.days}`, p.label) }))}
        />
        <span className="hra-text-muted" style={orStyle}>or</span>
        <DatePicker value={from} max={to} onChange={setFrom} />
        <span className="hra-text-muted" style={orStyle}>→</span>
        <DatePicker value={to} min={from} onChange={setTo} />
        <span className="hra-text-muted" style={orStyle}>or</span>
        <Select
          value={currentNamedId != null ? String(currentNamedId) : NO_NAMED_RANGE}
          onValueChange={pickCurrent}
          placeholder={t("dateRange.pickNamedRange", "Pick a named date range…")}
          triggerStyle={{ flex: "1 1 220px", minWidth: 0 }}
          options={[
            { value: NO_NAMED_RANGE, label: t("dateRange.noneOption", "— none —") },
            ...savedRanges.map(r => ({ value: String(r.id), label: savedRangeLabel(r) })),
          ]}
        />
      </div>

      {/* Compare heading + row — ALWAYS rendered (never mounted/unmounted),
          just grayed out and non-interactive while the switch above is off.
          Deliberate: unmounting this block on toggle made the rest of the
          page jump up/down under it — a "moving UI" — per explicit feedback;
          a fixed layout that merely dims is preferred. Same
          eligibility/derivation rules as before either way: only ranges
          ending before Current's own start are offered, and the dropdown's
          value is derived from compare.from/to, never separately stored. */}
      <div style={{ opacity: compare.enabled ? 1 : 0.4, pointerEvents: compare.enabled ? "auto" : "none" }}>
        <div className="hra-text-primary" style={{ fontSize: 13, fontWeight: 600, marginTop: 12, marginBottom: 8 }}>{t("dateRange.comparedTo", "Compared to")}</div>
        <div className="hra-row-wrap">
          <DatePicker value={compare.from} max={compare.to} onChange={compare.setFrom} />
          <span className="hra-text-muted" style={orStyle}>→</span>
          <DatePicker value={compare.to} min={compare.from} onChange={compare.setTo} />
          <span className="hra-text-muted" style={orStyle}>or</span>
          <Select
            value={compareNamedId != null ? String(compareNamedId) : NO_NAMED_RANGE}
            onValueChange={pickCompare}
            placeholder={t("dateRange.pickNamedRange", "Pick a named date range…")}
            triggerStyle={{ flex: "1 1 220px", minWidth: 0 }}
            options={[
              { value: NO_NAMED_RANGE, label: t("dateRange.noneOption", "— none —") },
              ...eligibleForCompare.map(r => ({ value: String(r.id), label: savedRangeLabel(r) })),
            ]}
          />
        </div>
      </div>
    </div>
  );
}
