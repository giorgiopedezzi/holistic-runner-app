import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PRESETS, type DateRangeState } from "@/hooks/useDateRange";
import { defaultCompareRange, type CompareRangeState } from "@/hooks/useCompareRange";
import { DatePicker, Select, Switch } from "@/components/ui";
import type { SavedDateRange } from "@/types/api";
import { fmtDate } from "@/utils/fmt";

// One shared bar — preset dropdown, manual from/to pickers, and a named-
// range picker — used everywhere a date range is chosen (Overview & Trends,
// Activities/Body, and Manage's per-provider sync ranges), not just Overview
// where it originated. `compare`/`savedRanges` are optional: without
// `compare` this renders just the one row (Activities/Body, Manage's sync
// sections); with it, Overview & Trends also gets the "Current" title, the
// comparison toggle, and the second "Compared to" row. `racePicker` is
// likewise optional — an extra control rendered right after the named-range
// Select, in the same row; only App.tsx's Activities-tab usage passes one
// (a "pick a race" dropdown that jumps from/to to that race's own day), so
// every other consumer of this shared bar is unaffected.
type Props = DateRangeState & { compare?: CompareRangeState; savedRanges?: SavedDateRange[]; racePicker?: ReactNode };

const NO_NAMED_RANGE = "";
const orStyle = { fontSize: 12 };

function savedRangeLabel(r: SavedDateRange): string {
  return `${r.name} (${fmtDate(r.from_date)} → ${fmtDate(r.to_date)})`;
}

export function DateRangeBar({ from, to, setFrom, setTo, setPreset, compare, savedRanges = [], racePicker }: Props) {
  const { t } = useTranslation();
  function isActive(days: number) {
    const target = days >= 9999 ? "2000-01-01"
      : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return from === target;
  }

  // Derived, not separately stored — the named-range dropdown shows
  // whichever saved range's (from_date, to_date) currently matches the live
  // from/to, same pattern as the preset dropdown's isActive() above. Picking
  // one just calls the same setFrom/setTo every other control here already
  // uses, so "takes precedence" falls out for free (last write wins, no
  // separate locked flag to keep in sync).
  const activePreset = PRESETS.find(p => isActive(p.days));
  const currentNamedId = savedRanges.find(r => r.from_date === from && r.to_date === to)?.id;
  // Compare-side ranges are only offered if they ended before CURRENT's own
  // start — a training block can't be "compared to" something that overlaps
  // or postdates it. Only meaningful (and only ever non-empty) when `compare`
  // is passed.
  const eligibleForCompare = compare ? savedRanges.filter(r => r.to_date < from) : [];
  const compareNamedId = compare ? savedRanges.find(r => r.from_date === compare.from && r.to_date === compare.to)?.id : undefined;

  // Picking "— none —" actively clears the filter (resets to the app's own
  // default 30-day window) rather than being a no-op — previously the only
  // way to back out of a named-range/race pick was to touch some OTHER
  // control (a preset, a manual date), which worked but wasn't discoverable:
  // the first/"none" option in a dropdown should itself be a real, selectable
  // action (explicit user feedback).
  function pickCurrent(idStr: string) {
    if (idStr === NO_NAMED_RANGE) { setPreset(30); return; }
    const r = savedRanges.find(x => String(x.id) === idStr);
    if (r) { setFrom(r.from_date); setTo(r.to_date); }
  }
  function pickCompare(idStr: string) {
    if (!compare) return;
    if (idStr === NO_NAMED_RANGE) {
      const def = defaultCompareRange(from, to);
      compare.setFrom(def.from); compare.setTo(def.to);
      return;
    }
    const r = eligibleForCompare.find(x => String(x.id) === idStr);
    if (r) { compare.setFrom(r.from_date); compare.setTo(r.to_date); }
  }

  return (
    <div>
      {/* "Current" title + the Compare on/off switch — only where a compare
          side exists at all (Overview & Trends). Activities/Body and
          Manage's sync sections have no comparison concept, so they get just
          the plain row below with no heading above it. */}
      {compare && (
        <div className="hra-row-between">
          <span className="hra-text-primary" style={{ fontSize: 13, fontWeight: 600 }}>{t("dateRange.current", "Current")}</span>
          <label className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            {t("dateRange.enableComparison", "Enable comparison")}
            <Switch checked={compare.enabled} onCheckedChange={compare.setEnabled} />
          </label>
        </div>
      )}

      {/* One row: preset dropdown, the manual date pickers, and the
          named-range picker. */}
      <div className="hra-row-wrap">
        <Select
          value={activePreset ? String(activePreset.days) : NO_NAMED_RANGE}
          onValueChange={v => setPreset(Number(v))}
          placeholder={t("dateRange.customRange", "Custom range")}
          // Fixed width, not minWidth — the Compare row below mirrors this
          // exact box as an invisible spacer (see there) so its date pickers
          // line up with these. A minWidth lets the trigger grow/shrink with
          // whatever's selected ("7d" vs "Custom range" vs a longer preset
          // label), which drifted out of sync with the spacer's fixed
          // content and broke that alignment.
          triggerStyle={{ width: 90 }}
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
        {racePicker}
      </div>

      {/* Compare heading + row — only present at all when `compare` is
          passed (Overview & Trends). ALWAYS rendered once it is (never
          mounted/unmounted on the toggle), just grayed out and
          non-interactive while the switch above is off. Deliberate:
          unmounting this block on toggle made the rest of the page jump
          up/down under it — a "moving UI" — per explicit feedback; a fixed
          layout that merely dims is preferred. */}
      {compare && (
        <div style={{ opacity: compare.enabled ? 1 : 0.4, pointerEvents: compare.enabled ? "auto" : "none" }}>
          <div className="hra-text-primary" style={{ fontSize: 13, fontWeight: 600, marginTop: 8, marginBottom: 6 }}>{t("dateRange.comparedTo", "Compared to")}</div>
          <div className="hra-row-wrap">
            {/* Invisible placeholder matching Current's leading preset
                dropdown + "or" (this row has no preset shortcuts of its
                own) — kept as real flex items (display: contents on the
                wrapper) so the date pickers below start at the same x
                position/width as Current's, instead of sliding left to fill
                the gap. */}
            <div aria-hidden="true" style={{ display: "contents" }}>
              <Select
                value={NO_NAMED_RANGE}
                onValueChange={() => {}}
                placeholder={t("dateRange.customRange", "Custom range")}
                triggerStyle={{ width: 90, visibility: "hidden", pointerEvents: "none" }}
                options={PRESETS.map(p => ({ value: String(p.days), label: t(`common.preset.${p.days}`, p.label) }))}
              />
              <span className="hra-text-muted" style={{ ...orStyle, visibility: "hidden" }}>or</span>
            </div>
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
      )}
    </div>
  );
}
