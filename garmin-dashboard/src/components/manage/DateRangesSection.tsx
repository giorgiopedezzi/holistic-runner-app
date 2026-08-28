import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Card, Select, DatePicker } from "@/components/ui";
import type { RaceActivity, SavedDateRange } from "@/types/api";
import { fmtDate, fmtRaceLabel } from "@/utils/fmt";
import { isoToday, isoAgo } from "@/utils/date";

const NO_RACE = "none";
const NO_SELECTION = "";

function rangeLabel(r: SavedDateRange): string {
  return `${r.name} (${fmtDate(r.from_date)} → ${fmtDate(r.to_date)})`;
}

// Shared by Name (Create) and the range picker (Update) so the two rows'
// first column lines up at the same width — and by every action button so
// "Create"/"Update"/"Delete" render at one identical width regardless of
// label length, rather than each sizing to its own text.

interface LoadedRange { id: number; name: string; from: string; to: string; raceId: string }

// ── Named date ranges ────────────────────────────────────────────────────
// Save a training-block window (e.g. "week 2 of Boston prep") for later
// recall/comparison, optionally linked to the race it led up to. Three
// separate rows, each with one fixed purpose: Create (plain text name)
// always POSTs a new row; Update (a plain dropdown of existing names, no
// free typing/rename — picking one loads its from/to/race for editing) PUTs
// the one currently loaded; Delete (its own dropdown) removes one. No
// separate read-only list any more — each row's own dropdown is the one
// place a saved range is looked up by name.
export function DateRangesSection() {
  const { t } = useTranslation();
  const [ranges, setRanges] = useState<SavedDateRange[] | null>(null);
  const [races,  setRaces]  = useState<RaceActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // ── Create row ──
  const [createName, setCreateName] = useState("");
  const [createFrom, setCreateFrom] = useState(isoAgo(7));
  const [createTo,   setCreateTo]   = useState(isoToday());
  const [createRaceId, setCreateRaceId] = useState(NO_RACE);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Update row ──
  const [loaded, setLoaded] = useState<LoadedRange | null>(null);
  const [updateFrom, setUpdateFrom] = useState(isoAgo(7));
  const [updateTo,   setUpdateTo]   = useState(isoToday());
  const [updateRaceId, setUpdateRaceId] = useState(NO_RACE);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // ── Delete row ──
  const [deleteId, setDeleteId] = useState(NO_SELECTION);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    Promise.all([api.dateRanges.list(), api.garmin.races()])
      .then(([r, rc]) => { setRanges(r); setRaces(rc); })
      .catch(e => setError(e instanceof Error ? e.message : t("manage.dateRanges.loadFailed", "Failed to load date ranges")))
      .finally(() => setLoading(false));
  }

  // Run once on mount. NOT [t] — react-i18next's `t` identity churns across
  // renders more than expected in some test-mount scenarios, and refresh()
  // isn't memoized, so depending on `t` here risks a setLoading-triggered
  // re-render -> new `t` -> refire loop (observed and fixed as a real hang
  // elsewhere, useSettings.tsx's fetchSettings — see that file's comment).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, []);

  // Only races that took place strictly after the row's own `to` are
  // linkable — matches the server-side rule in date-ranges.controller.ts.
  const eligibleRacesForCreate = useMemo(() => races.filter(r => r.date_only > createTo), [races, createTo]);
  const eligibleRacesForUpdate = useMemo(() => races.filter(r => r.date_only > updateTo), [races, updateTo]);

  useEffect(() => {
    if (createRaceId !== NO_RACE && !eligibleRacesForCreate.some(r => String(r.id) === createRaceId)) setCreateRaceId(NO_RACE);
  }, [eligibleRacesForCreate, createRaceId]);
  useEffect(() => {
    if (updateRaceId !== NO_RACE && !eligibleRacesForUpdate.some(r => String(r.id) === updateRaceId)) setUpdateRaceId(NO_RACE);
  }, [eligibleRacesForUpdate, updateRaceId]);

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      await api.dateRanges.create(createName.trim(), createFrom, createTo, createRaceId === NO_RACE ? null : Number(createRaceId));
      setCreateName("");
      setCreateRaceId(NO_RACE);
      refresh();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t("manage.dateRanges.createFailed", "Failed to save date range"));
    } finally {
      setCreating(false);
    }
  }

  function resetUpdateRow() {
    setLoaded(null);
    setUpdateFrom(isoAgo(7));
    setUpdateTo(isoToday());
    setUpdateRaceId(NO_RACE);
  }

  function handlePickExisting(value: string) {
    if (value === NO_SELECTION) { resetUpdateRow(); return; }
    const range = ranges?.find(r => String(r.id) === value);
    if (!range) return;
    const raceId = range.activity_id != null ? String(range.activity_id) : NO_RACE;
    setLoaded({ id: range.id, name: range.name, from: range.from_date, to: range.to_date, raceId });
    setUpdateFrom(range.from_date);
    setUpdateTo(range.to_date);
    setUpdateRaceId(raceId);
  }

  const isUpdateDirty = loaded != null && (
    updateFrom !== loaded.from || updateTo !== loaded.to || updateRaceId !== loaded.raceId
  );
  const canUpdate = loaded != null && isUpdateDirty && updateFrom <= updateTo && !updating;

  async function handleUpdate() {
    if (!loaded) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      await api.dateRanges.update(loaded.id, loaded.name, updateFrom, updateTo, updateRaceId === NO_RACE ? null : Number(updateRaceId));
      resetUpdateRow();
      refresh();
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : t("manage.dateRanges.updateFailed", "Failed to update date range"));
    } finally {
      setUpdating(false);
    }
  }

  async function handleDelete() {
    if (deleteId === NO_SELECTION) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const id = Number(deleteId);
      await api.dateRanges.remove(id);
      setDeleteId(NO_SELECTION);
      setConfirmingDelete(false);
      if (loaded?.id === id) resetUpdateRow();
      refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t("manage.dateRanges.deleteFailed", "Failed to delete date range"));
    } finally {
      setDeleting(false);
    }
  }

  const canCreate = createName.trim().length > 0 && createFrom <= createTo && !creating;

  return (
    <Card className="mb-4">
      <div className="hra-block-title mb-1" >{t("manage.dateRanges.title", "Named date ranges")}</div>
      <div className="hra-text-secondary text-meta mb-3" >
        {t("manage.dateRanges.description", "Save a training-block window to recall and compare later — e.g. week 2 vs week 3 of Boston Marathon prep, or one race's build-up vs another's. Optionally link the race it led up to; only races that took place after the range's end date are selectable.")}
      </div>

      {/* ── Create ── */}
      <div className="hra-date-range-row">
        <input
          type="text"
          value={createName}
          onChange={e => setCreateName(e.target.value)}
          placeholder={t("manage.dateRanges.namePlaceholder", "New range name (e.g. Boston wk2)")}
          title={createName}
          className="hra-date-range-name hra-border-strong hra-bg-card hra-text-primary"
        />
        <DatePicker value={createFrom} onChange={setCreateFrom} max={createTo} />
        <span className="hra-text-muted text-meta" >→</span>
        <DatePicker value={createTo} onChange={setCreateTo} min={createFrom} />
        <Select
          value={createRaceId}
          onValueChange={setCreateRaceId}
          placeholder={t("manage.dateRanges.linkRacePlaceholder", "Link a race (optional)")}
          triggerClassName="hra-select-race"
          options={[{ value: NO_RACE, label: t("manage.dateRanges.noRace", "No race") }, ...eligibleRacesForCreate.map(r => ({ value: String(r.id), label: fmtRaceLabel(r) }))]}
        />
        <button
          className="hra-btn hra-date-range-action"
          data-variant="cta"
          data-tone="green"
          onClick={handleCreate}
          disabled={!canCreate}
        >
          {creating ? t("manage.dateRanges.savingEllipsis", "Saving…") : t("common.create", "Create")}
        </button>
      </div>
      {createError && <ErrorLine>{createError}</ErrorLine>}

      {/* ── Update ── */}
      <div className="hra-date-range-row">
        <Select
          value={loaded != null ? String(loaded.id) : NO_SELECTION}
          onValueChange={handlePickExisting}
          placeholder={t("manage.dateRanges.pickToEdit", "Pick a saved range to edit…")}
          triggerClassName="hra-select-first-column"
          options={[{ value: NO_SELECTION, label: t("manage.dateRanges.pickRangeOption", "— pick a range —") }, ...(ranges ?? []).map(r => ({ value: String(r.id), label: rangeLabel(r) }))]}
        />
        <DatePicker value={updateFrom} onChange={setUpdateFrom} max={updateTo} />
        <span className="hra-text-muted text-meta" >→</span>
        <DatePicker value={updateTo} onChange={setUpdateTo} min={updateFrom} />
        <Select
          value={updateRaceId}
          onValueChange={setUpdateRaceId}
          placeholder={t("manage.dateRanges.linkRacePlaceholder", "Link a race (optional)")}
          triggerClassName="hra-select-race"
          options={[{ value: NO_RACE, label: t("manage.dateRanges.noRace", "No race") }, ...eligibleRacesForUpdate.map(r => ({ value: String(r.id), label: fmtRaceLabel(r) }))]}
        />
        <button
          className="hra-btn hra-date-range-action"
          data-variant="cta"
          data-tone="green"
          onClick={handleUpdate}
          disabled={!canUpdate}
          title={loaded == null ? t("manage.dateRanges.pickFirstTooltip", "Pick a saved range above first") : undefined}
        >
          {updating ? t("manage.dateRanges.savingEllipsis", "Saving…") : t("common.update", "Update")}
        </button>
      </div>
      {updateError && <ErrorLine>{updateError}</ErrorLine>}

      {/* ── Delete ── */}
      <div className="hra-date-range-row">
        <Select
          value={deleteId}
          onValueChange={v => { setDeleteId(v); setConfirmingDelete(false); }}
          placeholder={t("manage.dateRanges.pickToDelete", "Pick a saved range to delete…")}
          triggerClassName="hra-select-first-column"
          options={[{ value: NO_SELECTION, label: t("manage.dateRanges.pickRangeOption", "— pick a range —") }, ...(ranges ?? []).map(r => ({ value: String(r.id), label: rangeLabel(r) }))]}
        />
        {confirmingDelete ? (
          <>
            <span className="hra-text-danger text-meta" >{t("manage.dateRanges.confirmDeleteQuestion", "Delete this range?")}</span>
            <button
              className="hra-btn hra-date-range-action" data-variant="cta" data-tone="red"
              onClick={handleDelete} disabled={deleting}
            >
              {deleting ? "…" : t("common.yesDelete", "Yes, delete")}
            </button>
            <button onClick={() => setConfirmingDelete(false)}
              className="hra-border-strong hra-text-secondary text-meta rounded-md py-1.5 px-3 bg-transparent cursor-pointer"
              >
              {t("common.cancel", "Cancel")}
            </button>
          </>
        ) : (
          <button
            className="hra-btn hra-date-range-action" data-variant="cta" data-tone="red"
            onClick={() => setConfirmingDelete(true)}
            disabled={deleteId === NO_SELECTION}
          >
            {t("common.delete", "Delete")}
          </button>
        )}
      </div>
      {deleteError && <ErrorLine>{deleteError}</ErrorLine>}

      {loading && <div className="hra-text-muted text-meta" >{t("common.loading", "Loading…")}</div>}
      {error   && <div className="hra-text-danger text-meta" >{error}</div>}
    </Card>
  );
}

function ErrorLine({ children }: { children: string }) {
  return (
    <div className="hra-status-msg mb-3" data-status="error" >
      {children}
    </div>
  );
}
