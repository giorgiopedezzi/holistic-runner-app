import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "@/api/client";
import { Card, Select, DatePicker } from "@/components/ui";
import type { RaceActivity, SavedDateRange } from "@/types/api";
import { fmtKm, fmtDate } from "@/utils/fmt";
import { isoToday, isoAgo } from "@/utils/date";

const NO_RACE = "none";
const NO_SELECTION = "";

function raceLabel(r: RaceActivity): string {
  const name = r.activity_name ? ` — ${r.activity_name}` : "";
  return `${fmtDate(r.date_only)}${name} (${fmtKm(r.distance_m)})`;
}

function rangeLabel(r: SavedDateRange): string {
  return `${r.name} (${fmtDate(r.from_date)} → ${fmtDate(r.to_date)})`;
}

const rowStyle: CSSProperties = { display: "flex", gap: 8, alignItems: "center", width: "100%", marginBottom: 12 };
// Shared by Name (Create) and the range picker (Update) so the two rows'
// first column lines up at the same width — and by every action button so
// "Create"/"Update"/"Delete" render at one identical width regardless of
// label length, rather than each sizing to its own text.
const firstColumnStyle: CSSProperties = { flex: "2 1 120px", minWidth: 0 };
const nameInputStyle: CSSProperties = {
  ...firstColumnStyle,
  fontSize: 13, padding: "6px 8px", borderRadius: 6,
  border: "1px solid var(--border-strong)", background: "var(--bg-card)", color: "var(--text-primary)",
};
const actionButtonStyle: CSSProperties = { flex: "0 0 auto", width: 100 };

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
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load date ranges"))
      .finally(() => setLoading(false));
  }

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
      setCreateError(e instanceof Error ? e.message : "Failed to save date range");
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
      setUpdateError(e instanceof Error ? e.message : "Failed to update date range");
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
      setDeleteError(e instanceof Error ? e.message : "Failed to delete date range");
    } finally {
      setDeleting(false);
    }
  }

  const canCreate = createName.trim().length > 0 && createFrom <= createTo && !creating;

  return (
    <Card style={{ marginBottom: 16 }}>
      <div className="hra-block-title" style={{ marginBottom: 4 }}>Named date ranges</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        Save a training-block window to recall and compare later — e.g. week 2 vs week 3 of Boston
        Marathon prep, or one race's build-up vs another's. Optionally link the race it led up to; only
        races that took place after the range's end date are selectable.
      </div>

      {/* ── Create ── */}
      <div style={rowStyle}>
        <input
          type="text"
          value={createName}
          onChange={e => setCreateName(e.target.value)}
          placeholder="New range name (e.g. Boston wk2)"
          title={createName}
          style={nameInputStyle}
        />
        <DatePicker value={createFrom} onChange={setCreateFrom} max={createTo} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>→</span>
        <DatePicker value={createTo} onChange={setCreateTo} min={createFrom} />
        <Select
          value={createRaceId}
          onValueChange={setCreateRaceId}
          placeholder="Link a race (optional)"
          triggerStyle={{ flex: "1.5 1 100px", minWidth: 0 }}
          options={[{ value: NO_RACE, label: "No race" }, ...eligibleRacesForCreate.map(r => ({ value: String(r.id), label: raceLabel(r) }))]}
        />
        <button
          className="hra-btn"
          data-variant="cta"
          style={{ "--btn-color": "var(--accent-green)", ...actionButtonStyle } as CSSProperties}
          onClick={handleCreate}
          disabled={!canCreate}
        >
          {creating ? "Saving…" : "Create"}
        </button>
      </div>
      {createError && <ErrorLine>{createError}</ErrorLine>}

      {/* ── Update ── */}
      <div style={rowStyle}>
        <Select
          value={loaded != null ? String(loaded.id) : NO_SELECTION}
          onValueChange={handlePickExisting}
          placeholder="Pick a saved range to edit…"
          triggerStyle={firstColumnStyle}
          options={[{ value: NO_SELECTION, label: "— pick a range —" }, ...(ranges ?? []).map(r => ({ value: String(r.id), label: rangeLabel(r) }))]}
        />
        <DatePicker value={updateFrom} onChange={setUpdateFrom} max={updateTo} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>→</span>
        <DatePicker value={updateTo} onChange={setUpdateTo} min={updateFrom} />
        <Select
          value={updateRaceId}
          onValueChange={setUpdateRaceId}
          placeholder="Link a race (optional)"
          triggerStyle={{ flex: "1.5 1 100px", minWidth: 0 }}
          options={[{ value: NO_RACE, label: "No race" }, ...eligibleRacesForUpdate.map(r => ({ value: String(r.id), label: raceLabel(r) }))]}
        />
        <button
          className="hra-btn"
          data-variant="cta"
          style={{ "--btn-color": "var(--accent-green)", ...actionButtonStyle } as CSSProperties}
          onClick={handleUpdate}
          disabled={!canUpdate}
          title={loaded == null ? "Pick a saved range above first" : undefined}
        >
          {updating ? "Saving…" : "Update"}
        </button>
      </div>
      {updateError && <ErrorLine>{updateError}</ErrorLine>}

      {/* ── Delete ── */}
      <div style={rowStyle}>
        <Select
          value={deleteId}
          onValueChange={v => { setDeleteId(v); setConfirmingDelete(false); }}
          placeholder="Pick a saved range to delete…"
          triggerStyle={firstColumnStyle}
          options={[{ value: NO_SELECTION, label: "— pick a range —" }, ...(ranges ?? []).map(r => ({ value: String(r.id), label: rangeLabel(r) }))]}
        />
        {confirmingDelete ? (
          <>
            <span style={{ fontSize: 12, color: "var(--accent-red)" }}>Delete this range?</span>
            <button
              className="hra-btn" data-variant="cta"
              style={{ "--btn-color": "var(--accent-red)", ...actionButtonStyle } as CSSProperties}
              onClick={handleDelete} disabled={deleting}
            >
              {deleting ? "…" : "Yes, delete"}
            </button>
            <button onClick={() => setConfirmingDelete(false)}
              style={{ fontSize: 12, border: "1px solid var(--border-strong)", borderRadius: 6, padding: "6px 12px", background: "none", color: "var(--text-secondary)", cursor: "pointer" }}>
              Cancel
            </button>
          </>
        ) : (
          <button
            className="hra-btn" data-variant="cta"
            style={{ "--btn-color": "var(--accent-red)", ...actionButtonStyle } as CSSProperties}
            onClick={() => setConfirmingDelete(true)}
            disabled={deleteId === NO_SELECTION}
          >
            Delete
          </button>
        )}
      </div>
      {deleteError && <ErrorLine>{deleteError}</ErrorLine>}

      {loading && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>}
      {error   && <div style={{ fontSize: 12, color: "var(--accent-red)" }}>{error}</div>}
    </Card>
  );
}

function ErrorLine({ children }: { children: string }) {
  return (
    <div style={{ marginBottom: 12, fontSize: 12, padding: "8px 12px", borderRadius: 6, background: "var(--bg-danger)", color: "var(--accent-red)", border: "1px solid var(--accent-red)44" }}>
      {children}
    </div>
  );
}
