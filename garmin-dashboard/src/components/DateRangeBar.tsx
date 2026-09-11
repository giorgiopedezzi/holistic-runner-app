import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal, Pencil, X } from "lucide-react";
import { PRESETS, type DateRangeState } from "@/hooks/useDateRange";
import { defaultCompareRange, type CompareRangeState } from "@/hooks/useCompareRange";
import { DatePicker, Select, Sheet, SheetContent, SheetTrigger, Switch } from "@/components/ui";
import { useIsPhone } from "@/hooks/useIsPhone";
import type { DateRange, SavedDateRange } from "@/types/api";
import { fmtDate } from "@/utils/fmt";
import { ALL_SENTINEL, isoAgo, isoToday } from "@/utils/date";

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
type Props = DateRangeState & {
  compare?: CompareRangeState;
  savedRanges?: SavedDateRange[];
  racePicker?: ReactNode;
  // Overview & Trends only (HRA-306) — the phone-width collapsed summary and
  // comparison rows show activity counts alongside dates. Every other
  // DateRangeBar caller (Activities/Body, Manage) has its own count/list
  // readout nearby and doesn't pass these, so they render with no count
  // suffix, unchanged.
  currentActivityCount?: number;
  // null = not yet known (comparison off, or its fetch hasn't resolved yet)
  // — distinct from 0, which means comparison is on and the period is
  // genuinely empty (HRA-306 AC: never substitute the current-period value).
  compareActivityCount?: number | null;
  // The entity's overall min/max date (e.g. GET /api/range), for the "All
  // available data" summary to show its actual observation span instead of
  // just the semantic label. Omitted (or still loading) — falls back to the
  // label alone, same as before this Story.
  allRangeSpan?: DateRange | null;
};

const NO_NAMED_RANGE = "";
function savedRangeLabel(r: SavedDateRange): string {
  return `${r.name} (${fmtDate(r.from_date)} → ${fmtDate(r.to_date)})`;
}

function isActiveFor(value: string, days: number): boolean {
  const target = days >= 9999 ? ALL_SENTINEL : isoAgo(days);
  return value === target;
}

// Mirrors useDateRange's own setPreset(days) formula — duplicated here (not
// imported) because that hook only exposes it bound to its own setFrom/setTo
// calls, not as a standalone pure function. Used to compute the phone
// sheet's staged draft without touching real state until Apply.
function presetRange(days: number): { from: string; to: string } {
  return { from: days >= 9999 ? ALL_SENTINEL : isoAgo(days), to: isoToday() };
}

// "Default" comparison state for a given current range — enabled unless
// current is All (useCompareRange's own initial/reset rule), with the
// default compare window when enabled. Used only to decide whether the
// phone summary's non-default badge should count comparison as a deviation.
function isCompareOffDefault(from: string, to: string, compare: CompareRangeState): boolean {
  const expectedEnabled = from !== ALL_SENTINEL;
  if (compare.enabled !== expectedEnabled) return true;
  if (!compare.enabled) return false;
  const def = defaultCompareRange(from, to);
  return compare.from !== def.from || compare.to !== def.to;
}

// Draft shape staged inside the phone filter sheet (HRA-306) — nothing here
// touches real state (URL-backed hooks) until Apply commits it in one go;
// Cancel just discards it. Re-derived from live props every time the sheet
// opens.
interface Draft {
  from: string;
  to: string;
  compareEnabled: boolean;
  compareFrom: string;
  compareTo: string;
}

type RangeErrorKind = "current" | "compare" | null;

function rangeErrorKind(d: Draft): RangeErrorKind {
  if (d.from !== ALL_SENTINEL && d.from > d.to) return "current";
  if (d.compareEnabled && d.compareFrom > d.compareTo) return "compare";
  return null;
}

export function DateRangeBar(props: Props) {
  const {
    from, to, setFrom, setTo, setPreset, compare, savedRanges = [], racePicker,
    currentActivityCount, compareActivityCount, allRangeSpan,
  } = props;
  const { t } = useTranslation();
  const isPhone = useIsPhone();
  function isActive(days: number) {
    return isActiveFor(from, days);
  }
  const allSelected = from === ALL_SENTINEL;
  const allAvailableLabel = t("dateRange.allAvailable", "All available data");
  const orLabel = t("dateRange.or", "or");

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

  // ── Phone-width compaction (HRA-290, extended to the compare branch by
  // HRA-306) — a range summary (+ comparison summary, when `compare` is
  // passed) and a Filter button opening a Sheet with everything the full
  // row(s) below show. Unlike the desktop row, edits inside the sheet are
  // staged (Draft) and only committed on Apply; Cancel discards them.
  if (isPhone) {
    const matchedSaved = savedRanges.find(r => r.from_date === from && r.to_date === to);
    const allSpanLabel = allSelected && allRangeSpan?.min_date && allRangeSpan?.max_date
      ? ` (${fmtDate(allRangeSpan.min_date)} → ${fmtDate(allRangeSpan.max_date)})` : "";
    const summaryLabel = allSelected ? `${allAvailableLabel}${allSpanLabel}`
      : matchedSaved ? savedRangeLabel(matchedSaved)
      : `${fmtDate(from)} → ${fmtDate(to)}`;
    const countLabel = currentActivityCount == null ? ""
      : currentActivityCount === 1 ? ` · ${t("dateRange.activityCountOne", "1 activity")}`
      : ` · ${t("dateRange.activityCount", `${currentActivityCount} activities`)}`;

    // Off the app's shared 30-day default, or off the comparison default,
    // each count as one active filter — a simple, derivable-from-this-
    // component signal. Race selection (an opaque racePicker ReactNode)
    // isn't introspectable here, so it isn't counted.
    const activeFilterCount = (isActive(30) ? 0 : 1) + (compare && isCompareOffDefault(from, to, compare) ? 1 : 0);
    const filtersLabel = t("dateRange.filters", "Filters");
    const triggerLabel = activeFilterCount > 0
      ? t("dateRange.filtersActive", `${filtersLabel} (${activeFilterCount} active)`)
      : filtersLabel;

    function liveDraft(compareEnabledOverride?: boolean): Draft {
      return {
        from, to,
        compareEnabled: compareEnabledOverride ?? compare?.enabled ?? false,
        compareFrom: compare?.from ?? "",
        compareTo: compare?.to ?? "",
      };
    }

    return (
      <PhoneDateRangeBar
        summaryLabel={summaryLabel}
        countLabel={countLabel}
        triggerLabel={triggerLabel}
        activeFilterCount={activeFilterCount}
        filtersLabel={filtersLabel}
        from={from} to={to} setFrom={setFrom} setTo={setTo} setPreset={setPreset}
        compare={compare}
        savedRanges={savedRanges}
        racePicker={racePicker}
        eligibleForCompare={eligibleForCompare}
        compareActivityCount={compareActivityCount}
        currentActivityCount={currentActivityCount}
        allSelected={allSelected}
        allAvailableLabel={allAvailableLabel}
        liveDraft={liveDraft}
      />
    );
  }

  return (
    <div>
      {/* "Current" title + the Compare on/off switch — only where a compare
          side exists at all (Overview & Trends). Activities/Body and
          Manage's sync sections have no comparison concept, so they get just
          the plain row below with no heading above it. */}
      {compare && (
        <div className="hra-row-between">
          <span className="hra-text-primary text-label font-semibold" >{t("dateRange.current", "Current")}</span>
          <label className="hra-text-secondary flex items-center gap-1.5 text-meta cursor-pointer" >
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
          triggerClassName="hra-select-window"
          options={PRESETS.map(p => ({ value: String(p.days), label: t(`common.preset.${p.days}`, p.label) }))}
        />
        <span className="hra-text-muted text-meta">{orLabel}</span>
        {/* Grouped as one atomic unit (.hra-date-pair, index.css) so a
            narrow/mobile wrap never splits "from" from "to" across lines —
            the whole pair moves together, or stacks internally as a last
            resort, but never gets interrupted by the Select on either
            side. */}
        <div className="hra-date-pair">
          <DatePicker value={from} max={to} onChange={setFrom} label={allSelected ? allAvailableLabel : undefined} />
          <span className="hra-text-muted text-meta">→</span>
          <DatePicker value={to} min={from} onChange={setTo} />
        </div>
        <span className="hra-text-muted text-meta">{orLabel}</span>
        <Select
          value={currentNamedId != null ? String(currentNamedId) : NO_NAMED_RANGE}
          onValueChange={pickCurrent}
          placeholder={t("dateRange.pickNamedRange", "Pick a named date range…")}
          triggerClassName="hra-select-grow"
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
        <div className="hra-compare-range" data-enabled={compare.enabled}>
          <div className="hra-text-primary text-label font-semibold mt-2 mb-1.5" >{t("dateRange.comparedTo", "Compared to")}</div>
          <div className="hra-row-wrap">
            {/* Invisible placeholder matching Current's leading preset
                dropdown + "or" (this row has no preset shortcuts of its
                own) — kept as real flex items (display: contents on the
                wrapper) so the date pickers below start at the same x
                position/width as Current's, instead of sliding left to fill
                the gap. */}
            <div aria-hidden="true" className="contents">
              <Select
                value={NO_NAMED_RANGE}
                onValueChange={() => {}}
                placeholder={t("dateRange.customRange", "Custom range")}
                triggerClassName="hra-select-window hra-select-placeholder-hidden"
                options={PRESETS.map(p => ({ value: String(p.days), label: t(`common.preset.${p.days}`, p.label) }))}
              />
              <span className="hra-text-muted text-meta invisible">{orLabel}</span>
            </div>
            <div className="hra-date-pair">
              <DatePicker value={compare.from} max={compare.to} onChange={compare.setFrom} />
              <span className="hra-text-muted text-meta">→</span>
              <DatePicker value={compare.to} min={compare.from} onChange={compare.setTo} />
            </div>
            <span className="hra-text-muted text-meta">{orLabel}</span>
            <Select
              value={compareNamedId != null ? String(compareNamedId) : NO_NAMED_RANGE}
              onValueChange={pickCompare}
              placeholder={t("dateRange.pickNamedRange", "Pick a named date range…")}
              triggerClassName="hra-select-grow"
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

// ── Phone-width filter sheet (HRA-290 pattern, extended by HRA-306) ────────
// Split out so the desktop return above stays exactly the shape it was
// (line-for-line unchanged) and the phone form's own staged-draft state is
// self-contained.
interface PhoneProps extends DateRangeState {
  summaryLabel: string;
  countLabel: string;
  triggerLabel: string;
  activeFilterCount: number;
  filtersLabel: string;
  compare?: CompareRangeState;
  savedRanges: SavedDateRange[];
  racePicker?: ReactNode;
  eligibleForCompare: SavedDateRange[];
  compareActivityCount?: number | null;
  currentActivityCount?: number;
  allSelected: boolean;
  allAvailableLabel: string;
  liveDraft: (compareEnabledOverride?: boolean) => Draft;
}

function PhoneDateRangeBar({
  summaryLabel, countLabel, triggerLabel, activeFilterCount, filtersLabel,
  setFrom, setTo, compare, savedRanges, racePicker,
  eligibleForCompare, compareActivityCount, currentActivityCount, allAvailableLabel, liveDraft,
}: PhoneProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => liveDraft());

  function onOpenChange(next: boolean, compareEnabledOverride?: boolean) {
    if (next) setDraft(liveDraft(compareEnabledOverride));
    setOpen(next);
  }

  const errorKind = rangeErrorKind(draft);
  const error = errorKind === "current" ? t("dateRange.invalidRange", "End date must be on or after the start date.")
    : errorKind === "compare" ? t("dateRange.invalidCompareRange", "Comparison end date must be on or after the comparison start date.")
    : null;
  const draftAllSelected = draft.from === ALL_SENTINEL;
  const activePresetDraft = PRESETS.find(p => isActiveFor(draft.from, p.days));
  const currentNamedIdDraft = savedRanges.find(r => r.from_date === draft.from && r.to_date === draft.to)?.id;
  const compareNamedIdDraft = savedRanges.find(r => r.from_date === draft.compareFrom && r.to_date === draft.compareTo)?.id;

  function handleApply() {
    if (rangeErrorKind(draft)) return; // invalid — keep the sheet open with the entered values, per AC
    setFrom(draft.from);
    setTo(draft.to);
    // Applying a changed current range and a custom compare pick in the same
    // Apply inherits useCompareRange's own established reset-on-current-
    // change rule (its effect fires once `from`/`to` change and reapplies
    // the default compare window) — the exact same outcome two sequential
    // desktop edits in that order already produce today; not new behavior.
    if (compare) {
      compare.setEnabled(draft.compareEnabled);
      if (draft.compareEnabled) {
        compare.setFrom(draft.compareFrom);
        compare.setTo(draft.compareTo);
      }
    }
    setOpen(false);
  }

  function pickCurrentDraft(idStr: string) {
    if (idStr === NO_NAMED_RANGE) { setDraft(d => ({ ...d, ...presetRange(30) })); return; }
    const r = savedRanges.find(x => String(x.id) === idStr);
    if (r) setDraft(d => ({ ...d, from: r.from_date, to: r.to_date }));
  }
  function pickCompareDraft(idStr: string) {
    if (idStr === NO_NAMED_RANGE) {
      const def = defaultCompareRange(draft.from, draft.to);
      setDraft(d => ({ ...d, compareFrom: def.from, compareTo: def.to }));
      return;
    }
    const r = eligibleForCompare.find(x => String(x.id) === idStr);
    if (r) setDraft(d => ({ ...d, compareFrom: r.from_date, compareTo: r.to_date }));
  }

  const compareCountLabel = compareActivityCount == null ? ""
    : compareActivityCount === 1 ? ` · ${t("dateRange.activityCountOne", "1 activity")}`
    : ` · ${t("dateRange.activityCount", `${compareActivityCount} activities`)}`;
  // "Materially unequal" — a 30% relative gap between two known, non-zero-
  // denominator counts. Deliberately coarse (not a statistical test): this
  // is a plain-language nudge, not an analysis, so only a genuinely lopsided
  // pair of samples triggers it.
  const materiallyUnequal = currentActivityCount != null && compareActivityCount != null
    && Math.max(currentActivityCount, compareActivityCount) > 0
    && Math.abs(currentActivityCount - compareActivityCount) / Math.max(currentActivityCount, compareActivityCount) >= 0.3;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="hra-filter-summary text-body hra-text-primary">{summaryLabel}{countLabel}</span>
        <Sheet open={open} onOpenChange={v => onOpenChange(v)}>
          {/* Same icon/class as ActivityChartSection's "Chart options" sheet
              trigger (SlidersHorizontal, .hra-filter-trigger) — one visual
              language for "open a settings sheet" app-wide, not a
              differently-shaped Filter icon just for this one. */}
          <SheetTrigger className="hra-filter-trigger" aria-label={triggerLabel}>
            <SlidersHorizontal size={18} aria-hidden="true" />
            {activeFilterCount > 0 && <span className="hra-filter-badge" aria-hidden="true">{activeFilterCount}</span>}
          </SheetTrigger>
          <SheetContent title={filtersLabel}>
            <Select
              value={activePresetDraft ? String(activePresetDraft.days) : NO_NAMED_RANGE}
              onValueChange={v => setDraft(d => ({ ...d, ...presetRange(Number(v)) }))}
              placeholder={t("dateRange.customRange", "Custom range")}
              triggerClassName="hra-select-full"
              options={PRESETS.map(p => ({ value: String(p.days), label: t(`common.preset.${p.days}`, p.label) }))}
            />
            <div className="hra-date-pair">
              <DatePicker value={draft.from} max={draft.to} onChange={v => setDraft(d => ({ ...d, from: v }))} label={draftAllSelected ? allAvailableLabel : undefined} />
              <span className="hra-text-muted text-meta">→</span>
              <DatePicker value={draft.to} min={draft.from} onChange={v => setDraft(d => ({ ...d, to: v }))} />
            </div>
            <Select
              value={currentNamedIdDraft != null ? String(currentNamedIdDraft) : NO_NAMED_RANGE}
              onValueChange={pickCurrentDraft}
              placeholder={t("dateRange.pickNamedRange", "Pick a named date range…")}
              triggerClassName="hra-select-full"
              options={[
                { value: NO_NAMED_RANGE, label: t("dateRange.noneOption", "— none —") },
                ...savedRanges.map(r => ({ value: String(r.id), label: savedRangeLabel(r) })),
              ]}
            />
            {racePicker}

            {compare && (
              <>
                <label className="hra-text-secondary flex items-center gap-1.5 text-meta cursor-pointer">
                  {t("dateRange.enableComparison", "Enable comparison")}
                  <Switch checked={draft.compareEnabled} onCheckedChange={v => setDraft(d => ({ ...d, compareEnabled: v }))} />
                </label>
                {draft.compareEnabled && (
                  <div className="hra-compare-range" data-enabled="true">
                    <div className="hra-text-primary text-label font-semibold mb-1.5">{t("dateRange.comparedTo", "Compared to")}</div>
                    <div className="hra-date-pair">
                      <DatePicker value={draft.compareFrom} max={draft.compareTo} onChange={v => setDraft(d => ({ ...d, compareFrom: v }))} />
                      <span className="hra-text-muted text-meta">→</span>
                      <DatePicker value={draft.compareTo} min={draft.compareFrom} onChange={v => setDraft(d => ({ ...d, compareTo: v }))} />
                    </div>
                    <Select
                      value={compareNamedIdDraft != null ? String(compareNamedIdDraft) : NO_NAMED_RANGE}
                      onValueChange={pickCompareDraft}
                      placeholder={t("dateRange.pickNamedRange", "Pick a named date range…")}
                      triggerClassName="hra-select-full"
                      options={[
                        { value: NO_NAMED_RANGE, label: t("dateRange.noneOption", "— none —") },
                        ...eligibleForCompare.map(r => ({ value: String(r.id), label: savedRangeLabel(r) })),
                      ]}
                    />
                  </div>
                )}
              </>
            )}

            {error && <div className="hra-error-banner" role="alert">{error}</div>}

            <div className="hra-sheet-actions">
              <button type="button" className="hra-confirm-modal-cancel" onClick={() => setOpen(false)}>
                {t("common.cancel", "Cancel")}
              </button>
              <button type="button" className="hra-btn" data-variant="accent" onClick={handleApply} disabled={!!error}>
                {t("dateRange.apply", "Apply")}
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Page-level comparison entry (HRA-306) — collapsed to one
          consequential action when comparison is off (no form rendered
          unprompted), or a compact summary with edit/close when it's on.
          Only rendered at all when `compare` is passed (Overview & Trends). */}
      {compare && (compare.enabled ? (
        <div className="hra-fact-row hra-compare-summary">
          <span className="hra-text-secondary text-meta">
            {t("dateRange.comparedTo", "Compared to")} {fmtDate(compare.from)} → {fmtDate(compare.to)}{compareCountLabel}
          </span>
          {materiallyUnequal && (
            <div className="hra-text-muted text-meta">
              {t("dateRange.unevenSamples", "Sample sizes differ — these periods aren't automatically like-for-like.")}
            </div>
          )}
          <div className="hra-compare-summary-actions">
            <button
              type="button"
              className="hra-compare-summary-btn"
              aria-label={t("dateRange.editComparison", "Edit comparison")}
              onClick={() => onOpenChange(true, true)}
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="hra-compare-summary-btn"
              aria-label={t("dateRange.closeComparison", "Close comparison")}
              onClick={() => compare.setEnabled(false)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="hra-btn hra-compare-cta"
          data-variant="cta"
          onClick={() => onOpenChange(true, true)}
        >
          {t("dateRange.compareWithAnother", "Compare with another period")}
        </button>
      ))}
    </div>
  );
}
