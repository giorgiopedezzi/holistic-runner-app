/**
 * PlanInstancesSection.tsx (HRA-118, redesigned HRA-121, accordion-based
 * editing HRA-141)
 * Plans tab card: instantiate/edit/approve/delete plan instances, on top
 * of the shared accordion (HRA-116) and the plan-instances backend (HRA-112
 * through HRA-115, HRA-118's own list route, HRA-121's redesign). Structural
 * sibling of PlanTemplatesSection (HRA-117/HRA-140), but simpler at save
 * time: each day PUTs its own {section_name, week_number, date, dsl}
 * directly (HRA-115) — there's no whole-document dsl_source to
 * content-anchor-patch here, unlike the template card.
 *
 * HRA-141: the earlier `mode: "list" | "plan"` full-screen swap is gone,
 * same conversion HRA-140 already did for PlanTemplatesSection — each list
 * row is now its own `AccordionCard`, keyed by `activeKey: number | "new" |
 * null` instead of a page-level mode; `editingId` is a derived const. Only
 * ONE row's edits live in the "live" editor state at a time (the same
 * dozens of top-level useState fields this file already had — unchanged),
 * but unlike HRA-140's simpler single-dslSource draft, this card's own
 * per-row `Draft` also has to carry BOTH the live fields AND their own
 * baselines (`baselineInstName`/etc., `persistedDsl`) — collapsing a dirty
 * row and reopening it later must reproduce the exact same dirty-bucket
 * state HRA-136 already computes, not just the raw field values, or
 * `saveBucketDirty`/`regenerateBucketDirty` would silently read wrong the
 * moment a stashed draft is restored. `isDirty = saveBucketDirty ||
 * regenerateBucketDirty` (HRA-136's own union) is what drives both the
 * Restore confirm gate and the collapsed-row warning icon here — the exact
 * signal the Story's own Ask #3/#4 name.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { Card, ErrorBanner, Badge, DatePicker, Select, AccordionCard, ConfirmModal } from "@/components/ui";
import { TrainingPlanAccordion, DAY_PREFIX_RE, type DayRef, type WeekRef, type WorkoutTypeSwitchValue } from "@/components/TrainingPlanAccordion";
import { PlanInstanceCalendar, CategoryLegend } from "@/components/manage/PlanInstanceCalendar";
import { PlanInstanceAnchorTable } from "@/components/manage/PlanInstanceAnchorTable";
import {
  aggregateDayViews, collectPlanAnchors, computeResolvedDayDistance, groupResolvedDaysIntoSectionViews, reconstructDslFromResolvedDay,
  resolveIntensityPaceSecPerKm, weekDateRange, type SectionView, type DayView, type WeekView,
} from "@/domain/runplan-aggregate";
import { recomposeDayLine, splitNote, swapDayContent } from "@/domain/runplan-patch";
import { notify } from "@/utils/toast";
import { instanceDayDateLabel } from "@/utils/fmt";
import type { PlanTemplate, PlanInstance } from "@/types/api";
import type { EventType, OffsetUnit, PacePolicy, PaceValue, ResolvedDay, RunPlan, WorkoutType } from "@/types/runplan";
import { isoToday } from "@/utils/date";

const NONE_ANCHOR = "__none__";

// Mirrors garmin-stats/src/controllers/plan-templates.controller.ts's own
// STANDARD_DISTANCE_M — used only for the live client-side resolution
// preview below (the anchor table); the real distance resolution for
// goal_time still happens server-side, this just needs to match it closely
// enough to show an accurate preview.
const STANDARD_DISTANCE_M: Partial<Record<EventType, number>> = {
  "5k": 5000, "10k": 10000, half: 21097.5, marathon: 42195,
};
const KM_PER_MILE = 1.60934;

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000);
}
function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Goal time's h/m/s are each a (possibly partial, possibly empty) digit
// string sliced from the single masked HH:MM:SS input's own raw buffer
// (HRA-137, see goalTimeDigits/formatGoalTimeDigits below) — this combines
// them into total seconds, or null while any field isn't a valid
// non-negative number. Number("") is 0, so an untyped/incomplete segment
// counts as 0, same as the old three-separate-fields' own "0" default did.
function goalTimeToSec(h: string, m: string, s: string): number | null {
  const hn = Number(h), mn = Number(m), sn = Number(s);
  if (![hn, mn, sn].every(n => Number.isFinite(n) && n >= 0)) return null;
  return hn * 3600 + mn * 60 + sn;
}
function pad2(n: string): string {
  return String(Math.max(0, Number(n) || 0)).padStart(2, "0");
}
// HRA-137: a single masked HH:MM:SS text input replaces the old three
// separate H/M/S number fields — small custom mask per the Story's own
// explicit "zero-dependency, not a new library" instruction. The raw state
// is just the digits typed so far (0-6 chars, no colons); colons are
// inserted for display once a segment is reached, not typed. Standard
// "strip non-digits from whatever the browser reports as the new value"
// mask technique — this also makes backspace work for free (deleting a
// colon in the displayed text just gets stripped back out, net effect is
// the last real digit is gone).
function formatGoalTimeDigits(digits: string): string {
  const h = digits.slice(0, 2), m = digits.slice(2, 4), s = digits.slice(4, 6);
  if (digits.length <= 2) return h;
  if (digits.length <= 4) return `${h}:${m}`;
  return `${h}:${m}:${s}`;
}
function sanitizeGoalTimeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}
// HRA-137 Ask #3: the reverse direction — an absolute pace (from the
// race-pace anchor's own table row) converted back to a clock time, for
// display only (this input is read-only whenever it's showing this value —
// see the JSX below). Mirrors formatPaceSecPerKm's own rounding style.
function formatGoalTimeFromSec(totalSec: number): string {
  const total = Math.round(totalSec);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function formatPaceSecPerKm(sec: number): string {
  const total = Math.round(sec);
  const min = Math.floor(total / 60);
  const s = total % 60;
  return `${min}:${String(s).padStart(2, "0")}/km`;
}
// Same grammar as a PACE line's right-hand side (garmin-stats/src/domain/
// runplan/parser.ts's ABS_PACE_RE/OFFSET_RE) — for the live client-side
// resolution preview only; the real parse/validation happens server-side
// when this same raw string is sent as a pace_overrides value.
function parsePaceOverrideInput(raw: string, offsetUnit: OffsetUnit): PaceValue | null {
  const trimmed = raw.trim();
  const abs = /^(\d+):(\d{2})\/(km|mi)$/.exec(trimmed);
  if (abs) {
    const totalSec = parseInt(abs[1], 10) * 60 + parseInt(abs[2], 10);
    return { kind: "absolute", pace_sec_per_km: abs[3] === "km" ? totalSec : totalSec / KM_PER_MILE };
  }
  const off = /^([A-Za-z0-9_]+)([+-])(\d+(?:\.\d+)?)(s\/km|s\/mi)?$/.exec(trimmed);
  if (off) {
    const sign = off[2] === "+" ? 1 : -1;
    const amount = parseFloat(off[3]);
    const unit = (off[4] as OffsetUnit | undefined) ?? offsetUnit;
    const offset_sec_per_km = unit === "s/km" ? sign * amount : (sign * amount) / KM_PER_MILE;
    return { kind: "offset", anchor: off[1], offset_sec_per_km };
  }
  return null;
}
export interface AnchorRowState { absoluteValue: string; relativeTo: string; sign: "+" | "-"; seconds: string }
function emptyAnchorRow(): AnchorRowState {
  return { absoluteValue: "", relativeTo: "", sign: "+", seconds: "" };
}
function anchorRowIsEmpty(row: AnchorRowState): boolean {
  return row.absoluteValue.trim() === "" && row.relativeTo === "" && row.seconds.trim() === "";
}

// HRA-124: K0 = lowest D-number the template's week 1 actually declares —
// mirrors garmin-stats/src/domain/runplan/instantiate.ts's computeK0. Used
// only for this form's non-blocking week-1-anchor warning below; the
// backend does the real (authoritative) computation at instantiate time.
function computeK0(plan: RunPlan): number | null {
  let k0: number | null = null;
  for (const section of plan.sections) {
    for (const week of section.weeks) {
      if (week.number !== 1) continue;
      for (const day of week.days) {
        if (k0 === null || day.day < k0) k0 = day.day;
      }
    }
  }
  return k0;
}
// Monday=0..Sunday=6 weekday index for an ISO date.
function mondayBasedWeekday(dateISO: string): number {
  return (new Date(`${dateISO}T00:00:00Z`).getUTCDay() + 6) % 7;
}

// HRA-130: the same non-blocking week-1 Monday-anchor check the instantiate
// form's week1AnchorMismatch already does (HRA-124), but for the editor —
// computed straight from the loaded instance's own resolved days (real
// calendar dates + D-numbers already persisted) rather than re-parsing the
// template DSL and a live startDate; the instance itself is the source of
// truth for what actually got created. Checked per section (a plan can have
// more than one "week 1" if a section restarts its own numbering), any
// mismatch anywhere is enough to show the warning.
function editorWeek1AnchorMismatch(sections: SectionView[]): boolean {
  return sections.some(section => section.weeks.some(week => {
    if (week.number !== 1 || week.days.length === 0) return false;
    const k0Day = week.days.reduce((min, d) => (d.day < min.day ? d : min));
    return k0Day.date != null && mondayBasedWeekday(k0Day.date) !== (k0Day.day - 1) % 7;
  }));
}

// Every field in the instantiate form goes through this — label is always a
// block above its control (never beside it), enforced structurally by the
// column flex layout rather than left to each call site to get right.
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="hra-field-label">
        {label}{required && <span className="hra-text-danger"> *</span>}
      </span>
      {children}
    </div>
  );
}

// HRA-141: a row's identity — an existing instance's real id, or "new" for
// the not-yet-created draft row. String-keyed in `drafts` (object keys are
// always strings) but kept as this union everywhere else for type safety.
type RowKey = number | "new";

// HRA-141: what gets stashed when a dirty row is collapsed or switched away
// from. Unlike PlanTemplatesSection's own Draft (HRA-140) — a single
// dslSource string plus three scalars — this card's dirty state spans two
// whole buckets (HRA-136's saveBucketDirty/regenerateBucketDirty), each with
// its own baseline, so the draft has to carry BOTH the live fields and the
// baselines they're diffed against: reopening a stashed draft must restore
// the exact same dirty-bucket verdict it had when stashed, not just the raw
// field values with a freshly-recomputed (and therefore wrong) baseline.
interface Draft {
  templateId: string; instName: string; raceName: string; raceDate: string; raceUrl: string;
  startDate: string; daysBeforeRace: string; restDayLabel: string;
  racePaceAnchor: string; paceMode: "anchor" | "goalTime"; goalTimeDigits: string; distanceM: string;
  anchorRows: Record<string, AnchorRowState>;
  sections: SectionView[];
  effectiveFrom: string;
  editApprovedAt: string | null;
  saveForcedEnabled: boolean;
  baselineInstName: string; baselineRaceName: string; baselineRaceDate: string; baselineRaceUrl: string;
  baselineStartDate: string; baselineAnchorRows: Record<string, AnchorRowState>;
  baselineRacePaceAnchor: string; baselinePaceMode: "anchor" | "goalTime";
  baselineGoalTimeDigits: string; baselineDistanceM: string;
  persistedDsl: Record<string, string>;
}

interface Props {
  // Lifted to PlansTab (not fetched here) — a template saved in the
  // sibling PlanTemplatesSection card must show up in this card's own
  // picker/list immediately, including enabling "New instance" the moment
  // the very first template exists.
  templates: PlanTemplate[] | null;
}

export function PlanInstancesSection({ templates }: Props) {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<PlanInstance[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // HRA-141: which row is expanded — an existing instance's id, "new" for
  // the unsaved-draft row, or null (every row collapsed). Replaces the old
  // page-level `mode`; `editingId` is now derived from this, not its own
  // state (same conversion HRA-140 already did for PlanTemplatesSection).
  const [activeKey, setActiveKey] = useState<RowKey | null>(null);
  const editingId = typeof activeKey === "number" ? activeKey : null;
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // HRA-141: rows with unsaved edits that are currently collapsed (or were
  // never the active row to begin with, if a *different* row's live edits
  // just got stashed here). Presence of a key drives the warning icon
  // (Ask #4); an entry is removed only by a successful Save/Regenerate or an
  // explicit Restore (Ask #3), never by simply reopening the row.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // HRA-141 Ask #3: confirm gate before Restore actually discards — only
  // shown when the active row is genuinely dirty (either bucket); a clean
  // row restores (closes) immediately.
  const [pendingRestoreConfirm, setPendingRestoreConfirm] = useState(false);

  // Shared "plan" screen fields — row 1 (identity). Link a race (HRA-121) is
  // a plain free-text URL, not a picker over existing activities —
  // target_activity_id stays a valid backend capability, just no longer
  // surfaced by this form. `instName` is now the ONE name field for both
  // creating a fresh instance and displaying an existing one's name (HRA-133
  // unification — previously a separate `editName` existed purely because
  // editor mode was a disjoint screen).
  const [templateId, setTemplateId] = useState("");
  const [instName, setInstName] = useState("");
  const [raceName, setRaceName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [raceUrl, setRaceUrl] = useState("");
  // row 2 (timing) — startDate and daysBeforeRace are two views of one
  // relationship once raceDate is set (see onStartDateChange/
  // onDaysBeforeRaceChange/onRaceDateChange below).
  const [startDate, setStartDate] = useState(isoToday());
  const [daysBeforeRace, setDaysBeforeRace] = useState("");
  // HRA-124: free-text label attached as `notes` on every day auto-filled as
  // a REST day to plug a D-number gap the template left undeclared for a week.
  const [restDayLabel, setRestDayLabel] = useState("");
  // row 3 (pace) — racePaceAnchor defaults to NONE_ANCHOR (never auto-picks
  // one of the template's anchors); paceMode is forced to "anchor" whenever
  // it's NONE_ANCHOR (Goal time has nothing to convert to without a
  // designated anchor). HRA-137: Goal time is one masked HH:MM:SS text
  // input now — `goalTimeDigits` is its raw buffer (0-6 digit chars, no
  // colons, "" = untouched); `goalH`/`goalM`/`goalS` below are DERIVED from
  // it (2-char slices) rather than their own state, so every existing call
  // site that already reads them (goalTimeToSec, pad2, the instantiate body
  // builder, hasEnteredData) keeps working unchanged.
  const [racePaceAnchor, setRacePaceAnchor] = useState(NONE_ANCHOR);
  const [paceMode, setPaceMode] = useState<"anchor" | "goalTime">("anchor");
  const [goalTimeDigits, setGoalTimeDigits] = useState("");
  const goalH = goalTimeDigits.slice(0, 2);
  const goalM = goalTimeDigits.slice(2, 4);
  const goalS = goalTimeDigits.slice(4, 6);
  const [distanceM, setDistanceM] = useState("");
  // One row per template anchor (HRA-121: a table, not add/remove rows) —
  // keyed by anchor name, synced whenever the template changes.
  const [anchorRows, setAnchorRows] = useState<Record<string, AnchorRowState>>({});
  // Set while a template switch is pending confirmation (HRA-121: switching
  // templates after real data has been entered warns before discarding it).
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const [instantiateLoading, setInstantiateLoading] = useState(false);
  const [instantiateError, setInstantiateError] = useState<string | null>(null);

  const [sections, setSections] = useState<SectionView[]>([]);
  // HRA-162: a ref mirror of `sections`, read (never written) inside the
  // debounced live-validate callback below — that callback fires ~400ms
  // after the keystroke that scheduled it, well past the render whose
  // closure it was created in, so reading the `sections` state variable
  // directly there would see a stale snapshot. The ref always has the
  // latest value by the time the timeout fires.
  const sectionsRef = useRef(sections);
  useEffect(() => { sectionsRef.current = sections; }, [sections]);
  // HRA-143: List/Agenda toggle for the currently-open row's own accordion —
  // one shared state is enough since only one row is ever expanded at a
  // time (activeKey). Default List (AC2) — the pre-existing accordion,
  // unchanged; Agenda swaps it for a read-only calendar over the same
  // `sections` data, no separate fetch. Not part of Draft/dirty-tracking —
  // it's a view preference, not data, so switching rows doesn't need to
  // stash/restore it.
  const [viewMode, setViewMode] = useState<"list" | "agenda">("list");
  const [editError, setEditError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);
  // HRA-126: once set, the plan view locks — Save/day-edit disabled, Approve
  // disabled (no double-approve). Kept in sync at every point the instance's
  // own approved_at could change: loading it (startEdit), creating it fresh
  // (always null), saving (PUT clears approval, gate 2), approving.
  const [editApprovedAt, setEditApprovedAt] = useState<string | null>(null);
  // HRA-127: day/week swap — a per-picker "swap with…" selector (the
  // interaction pattern was left open by the Story). Selection keys are
  // "sectionIndex-weekIndex-dayIndex" / "sectionIndex-weekIndex" strings
  // (Select needs string values, same convention every other Select in this
  // file already uses, e.g. templateId). Swap only mutates local `sections`
  // state — persisted on the existing Save flow like any other day edit.
  const [swapDayA, setSwapDayA] = useState("");
  const [swapDayB, setSwapDayB] = useState("");
  const [swapWeekA, setSwapWeekA] = useState("");
  const [swapWeekB, setSwapWeekB] = useState("");
  // HRA-131: set while a swap (either entry point — the picker's Swap button
  // OR a drag-and-drop drop) is pending confirmation, naming both sides
  // concretely before anything actually mutates `sections`. Same
  // pending-then-confirm/cancel shape as pendingTemplateId above.
  const [pendingDaySwap, setPendingDaySwap] = useState<{ a: DayRef; b: DayRef } | null>(null);
  const [pendingWeekSwap, setPendingWeekSwap] = useState<{ a: WeekRef; b: WeekRef } | null>(null);
  // HRA-134: snapshots of startDate/anchorRows as of the last successful
  // load/create/save/regenerate — the "pendingChange" comparison below diffs
  // the live fields against these to decide whether to surface the cutover
  // picker at all ("editing either surfaces..."), not against the raw
  // persisted pace_overrides JSON, which is a resolved PaceValue, not the
  // same shape as the UI's own absolute/relative row state — see startEdit's
  // paceValueToAnchorRow for why that reverse mapping already exists).
  const [baselineStartDate, setBaselineStartDate] = useState("");
  const [baselineAnchorRows, setBaselineAnchorRows] = useState<Record<string, AnchorRowState>>({});
  // HRA-136: the rest of the Regenerate-bucket's own baselines — the Story's
  // dirty-bucket rule names "the goal-time/anchor-override toggle" and "the
  // race-pace-anchor selection" as pace-anchor fields alongside the anchor
  // table itself, so paceMode/racePaceAnchor need the same
  // snapshot-then-diff treatment startDate/anchorRows already get. Goal
  // time's own H/M/S + distance override aren't named individually in the
  // Story's bucket list, but they're the only inputs behind "the goal-time
  // toggle" when it's active — untracked, editing them wouldn't ever surface
  // as Regenerate-bucket-dirty, so they get baselines too, only consulted
  // while paceMode === "goalTime" (see regenerateBucketDirty below).
  const [baselineRacePaceAnchor, setBaselineRacePaceAnchor] = useState(NONE_ANCHOR);
  const [baselinePaceMode, setBaselinePaceMode] = useState<"anchor" | "goalTime">("anchor");
  // HRA-137: one baseline for the whole masked digit buffer, mirroring the
  // live goalTimeDigits it's diffed against — was three (baselineGoalH/M/S)
  // before Goal time became a single input.
  const [baselineGoalTimeDigits, setBaselineGoalTimeDigits] = useState("");
  const [baselineDistanceM, setBaselineDistanceM] = useState("");
  // HRA-136: the Save-bucket's own baselines — Name/Race name/date/url. Day
  // content's own baseline is `persistedDsl` (already existed for HRA-134's
  // manual-edit count) — reused below for the Save-bucket's day-dirty check.
  const [baselineInstName, setBaselineInstName] = useState("");
  const [baselineRaceName, setBaselineRaceName] = useState("");
  const [baselineRaceDate, setBaselineRaceDate] = useState("");
  const [baselineRaceUrl, setBaselineRaceUrl] = useState("");
  // HRA-136 AC5: "a successful Regenerate re-enables Save unconditionally" —
  // even when nothing in the Save-bucket happens to be dirty right after
  // (e.g. Name never changed). Set true on a successful regenerate; cleared
  // by a successful Save, by starting fresh, or the instant the
  // Regenerate-bucket goes dirty again (that always wins over this flag —
  // see saveEnabled below).
  const [saveForcedEnabled, setSaveForcedEnabled] = useState(false);
  // HRA-136 Ask #2: confirm popup before a Name change actually persists.
  // Gated on the Save action (not per-keystroke — same
  // pending-then-confirm/cancel shape pendingTemplateId/pendingDaySwap
  // already use for a different consequential action) since a modal per
  // character typed would be unusable.
  const [pendingNameChangeConfirm, setPendingNameChangeConfirm] = useState(false);
  // date -> dsl as of the last successful load/create/save/regenerate — the
  // "manual edit" count below diffs live `sections` against this to find
  // which days (on/after the cutover) actually diverged from what's really
  // persisted right now, regardless of how they were touched (direct dsl
  // edit, a day swap, or a week swap all mutate `sections` the same way).
  const [persistedDsl, setPersistedDsl] = useState<Record<string, string>>({});
  // The "Modification start from" cutover date (HRA-134) — defaults to
  // today, floored there both client-side (DatePicker's own min) and
  // server-side (never trusted from the client alone, HRA-132). Live
  // follow-up: the actual floor is max(startDate, today), not today alone —
  // a day before the instance's own (possibly just-changed) start date
  // doesn't exist to regenerate from. ISO "YYYY-MM-DD" strings compare
  // correctly with plain string comparison, so this needs no date parsing.
  const minEffectiveFrom = startDate > isoToday() ? startDate : isoToday();
  const [effectiveFrom, setEffectiveFrom] = useState(isoToday());
  // Live follow-up: DatePicker's own `min` only restricts what's newly
  // SELECTABLE in the calendar popup — it doesn't retroactively correct an
  // already-set value, so a startDate pushed later than the current
  // effectiveFrom (e.g. the user bumps start date after already opening the
  // picker) would otherwise leave effectiveFrom silently sitting below the
  // real floor. Clamp it back up whenever the floor moves past it.
  useEffect(() => {
    if (effectiveFrom < minEffectiveFrom) setEffectiveFrom(minEffectiveFrom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minEffectiveFrom]);
  const [regenerateLoading, setRegenerateLoading] = useState(false);
  // Set while a regenerate is pending confirmation because it would discard
  // one or more manually-edited days on/after the cutover — same
  // pending-then-confirm/cancel shape pendingTemplateId/pendingDaySwap
  // already established. null means "no manual edits in range," so
  // onRegenerate proceeds immediately without asking.
  const [pendingRegenerateCount, setPendingRegenerateCount] = useState<number | null>(null);

  function refreshInstances() {
    return api.planInstances.list().then(setInstances).catch(e => setListError(e instanceof Error ? e.message : t("manage.planInstances.loadFailed", "Failed to load instances")));
  }

  useEffect(() => { refreshInstances(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function resetInstantiateForm() {
    setTemplateId(""); setInstName(""); setRaceName(""); setRaceDate(""); setRaceUrl("");
    setStartDate(isoToday()); setDaysBeforeRace(""); setRestDayLabel("");
    setRacePaceAnchor(NONE_ANCHOR); setPaceMode("anchor");
    setGoalTimeDigits(""); setDistanceM(""); setAnchorRows({});
    setPendingTemplateId(null);
    setInstantiateError(null);
    setBaselineStartDate(""); setBaselineAnchorRows({});
    setBaselineRacePaceAnchor(NONE_ANCHOR); setBaselinePaceMode("anchor");
    setBaselineGoalTimeDigits(""); setBaselineDistanceM("");
    setBaselineInstName(""); setBaselineRaceName(""); setBaselineRaceDate(""); setBaselineRaceUrl("");
    setSaveForcedEnabled(false); setPendingNameChangeConfirm(false);
    setEffectiveFrom(isoToday()); setPendingRegenerateCount(null);
  }

  function resetEditor() {
    setSections([]); setEditError(null); setEditApprovedAt(null);
    setSwapDayA(""); setSwapDayB(""); setSwapWeekA(""); setSwapWeekB("");
    setPersistedDsl({});
  }

  // HRA-134: date -> dsl for every day currently in `sections` — the shape
  // `persistedDsl` snapshots at each successful load/create/save/regenerate.
  function snapshotDsl(secs: SectionView[]): Record<string, string> {
    const map: Record<string, string> = {};
    secs.forEach(s => s.weeks.forEach(w => w.days.forEach(d => { if (d.date != null) map[d.date] = d.dsl; })));
    return map;
  }

  // HRA-133: the unified "plan" screen's own reset — both the shared top
  // fields and the editor's own day-level state, since they now render
  // together. Used whenever leaving the screen entirely (Restore, back to
  // list) or starting completely fresh (New instance).
  function resetPlanScreen() {
    resetInstantiateForm();
    resetEditor();
  }

  // Row 2: Start date and Days-before-race are two views of one relationship
  // once Race date is set — editing either recomputes the other; neither
  // touches Race date itself.
  function onStartDateChange(v: string) {
    setStartDate(v);
    if (raceDate) setDaysBeforeRace(String(daysBetween(v, raceDate)));
  }
  function onDaysBeforeRaceChange(v: string) {
    setDaysBeforeRace(v);
    const n = Number(v);
    if (raceDate && v.trim() !== "" && Number.isFinite(n)) setStartDate(addDaysISO(raceDate, -n));
  }
  function onRaceDateChange(v: string) {
    setRaceDate(v);
    setDaysBeforeRace(v ? String(daysBetween(startDate, v)) : "");
  }

  function parsePlan(tpl: PlanTemplate | undefined): RunPlan | null {
    if (!tpl) return null;
    try { return JSON.parse(tpl.parsed_plan) as RunPlan; } catch { return null; }
  }

  // The actual template switch, once nothing needs confirming (or the user
  // just confirmed discarding what was there).
  function applyTemplateChange(id: string) {
    setTemplateId(id);
    const anchors = collectPlanAnchors(parsePlan(templates?.find(tpl => String(tpl.id) === id)) ?? { metadata: { unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: {} }, sections: [] });
    setRacePaceAnchor(NONE_ANCHOR);
    setPaceMode("anchor");
    setGoalTimeDigits(""); setDistanceM("");
    setAnchorRows(Object.fromEntries(anchors.map(a => [a, emptyAnchorRow()])));
  }

  // HRA-121: picking a different template while real (non-default) data is
  // already in the form would silently discard it — this instance hasn't
  // been created yet, so nothing is actually saved anywhere until Create is
  // clicked. Confirm first via the modal below instead.
  function onTemplateSelectChange(id: string) {
    if (templateId !== "" && id !== templateId && hasEnteredData()) {
      setPendingTemplateId(id);
      return;
    }
    applyTemplateChange(id);
  }
  function confirmSwitchTemplate() {
    if (pendingTemplateId != null) applyTemplateChange(pendingTemplateId);
    setPendingTemplateId(null);
  }
  function cancelSwitchTemplate() { setPendingTemplateId(null); }

  // Goal time is only selectable while a race pace anchor is chosen — with
  // NONE_ANCHOR there's no anchor for it to convert to, so switching to
  // NONE_ANCHOR while Goal time was active forces Anchor override instead.
  function onRacePaceAnchorChange(v: string) {
    setRacePaceAnchor(v);
    if (v === NONE_ANCHOR && paceMode === "goalTime") setPaceMode("anchor");
  }

  // Fill exactly one of Absolute or Relative per anchor row — typing into
  // one side clears the other, rather than a separate mode toggle.
  function setAnchorAbsolute(anchor: string, value: string) {
    setAnchorRows(prev => ({ ...prev, [anchor]: { ...(prev[anchor] ?? emptyAnchorRow()), absoluteValue: value, relativeTo: "", seconds: "" } }));
  }
  function setAnchorRelativeTo(anchor: string, value: string) {
    setAnchorRows(prev => ({ ...prev, [anchor]: { ...(prev[anchor] ?? emptyAnchorRow()), relativeTo: value, absoluteValue: "" } }));
  }
  function setAnchorSign(anchor: string, sign: "+" | "-") {
    setAnchorRows(prev => ({ ...prev, [anchor]: { ...(prev[anchor] ?? emptyAnchorRow()), sign, absoluteValue: "" } }));
  }
  function setAnchorSeconds(anchor: string, value: string) {
    setAnchorRows(prev => ({ ...prev, [anchor]: { ...(prev[anchor] ?? emptyAnchorRow()), seconds: value, absoluteValue: "" } }));
  }
  function clearAnchorRow(anchor: string) {
    setAnchorRows(prev => ({ ...prev, [anchor]: emptyAnchorRow() }));
  }

  const selectedTemplate = templates?.find(tpl => String(tpl.id) === templateId);
  const selectedPlan = parsePlan(selectedTemplate);
  const templateAnchors = selectedPlan ? collectPlanAnchors(selectedPlan) : [];
  const hasRacePaceAnchor = racePaceAnchor !== NONE_ANCHOR;
  const formEnabled = templateId !== "";

  // HRA-120: a custom-event template always carries its own distance_m
  // (mandatory at template save time) — this field is now an optional
  // override, never required to instantiate. Precedence at instantiate time:
  // this explicit value > the template's own distance_m > the event's
  // standard distance (enforced server-side, controllers/plan-templates.controller.ts).
  const showDistanceOverride = paceMode === "goalTime" && selectedTemplate?.event === "custom";

  // Live, client-side resolution preview (HRA-121): reuses the same pure
  // resolveIntensityPaceSecPerKm the template accordion already relies on
  // (domain/runplan-aggregate.ts) — no new preview endpoint. Every anchor
  // not covered by the race pace anchor or its own table row simply
  // resolves against the template's own plan-level pace_policy, same
  // precedence instantiatePlan itself applies server-side.
  function previewGoalDistanceM(): number | null {
    if (distanceM.trim() !== "") return Number(distanceM);
    if (selectedPlan?.metadata.distance_m != null) return selectedPlan.metadata.distance_m;
    if (selectedTemplate?.event) return STANDARD_DISTANCE_M[selectedTemplate.event as EventType] ?? null;
    return null;
  }
  function buildOverridePolicy(offsetUnit: OffsetUnit): PacePolicy {
    const policy: PacePolicy = {};
    if (hasRacePaceAnchor && paceMode === "goalTime") {
      const distM = previewGoalDistanceM();
      const goalSec = goalTimeToSec(goalH, goalM, goalS);
      if (distM != null && goalSec != null && goalSec > 0) policy[racePaceAnchor] = { kind: "absolute", pace_sec_per_km: goalSec / (distM / 1000) };
    }
    for (const anchor of templateAnchors) {
      if (hasRacePaceAnchor && paceMode === "goalTime" && anchor === racePaceAnchor) continue; // derived above, not from its table row
      const row = anchorRows[anchor];
      if (!row) continue;
      if (row.absoluteValue.trim() !== "") {
        const parsed = parsePaceOverrideInput(row.absoluteValue, offsetUnit);
        if (parsed) policy[anchor] = parsed;
      } else if (row.relativeTo !== "" && row.seconds.trim() !== "") {
        const secs = Number(row.seconds);
        if (Number.isFinite(secs)) policy[anchor] = { kind: "offset", anchor: row.relativeTo, offset_sec_per_km: row.sign === "+" ? secs : -secs };
      }
    }
    return policy;
  }
  const overridePolicy = selectedPlan ? buildOverridePolicy(selectedPlan.metadata.offset_unit) : {};
  const mergedPolicy: PacePolicy = selectedPlan ? { ...selectedPlan.metadata.pace_policy, ...overridePolicy } : {};
  const resolution = templateAnchors.map(anchor => ({
    anchor, secPerKm: resolveIntensityPaceSecPerKm({ kind: "anchor", anchor, raw: anchor }, mergedPolicy),
  }));
  const unresolvedAnchors = resolution.filter(r => r.secPerKm == null).map(r => r.anchor);
  const allResolved = unresolvedAnchors.length === 0;

  // The actual resolved pace for the race-pace anchor when it's derived from
  // Goal time (HRA-121 follow-up) — shown in the table alongside the "(from
  // goal time)" note, not replaced by it; null while goal time is still 0 or
  // the distance can't be determined (unresolved).
  const derivedPaceSecPerKm = (() => {
    if (!(hasRacePaceAnchor && paceMode === "goalTime")) return null;
    const distM = previewGoalDistanceM();
    const goalSec = goalTimeToSec(goalH, goalM, goalS);
    if (distM == null || goalSec == null || goalSec <= 0) return null;
    return goalSec / (distM / 1000);
  })();

  // HRA-137 Ask #3: the reverse direction — when the race-pace anchor's own
  // Absolute pace is set directly (Anchor-override mode), compute the
  // equivalent Goal Time from it, for display in the (read-only while in
  // this mode) Goal time field below. Only fires for an ABSOLUTE row value
  // — a Relative-to-another-anchor row has no standalone pace to convert
  // without resolving the whole policy chain first, same scope boundary
  // derivedPaceSecPerKm's own goalTime->pace direction already has (it only
  // ever reads the anchor's own goal-time inputs, never the rest of the
  // policy).
  const equivalentGoalTimeSec = (() => {
    if (!(hasRacePaceAnchor && paceMode === "anchor") || !selectedPlan) return null;
    const row = anchorRows[racePaceAnchor];
    if (!row || row.absoluteValue.trim() === "") return null;
    const parsed = parsePaceOverrideInput(row.absoluteValue, selectedPlan.metadata.offset_unit);
    if (!parsed || parsed.kind !== "absolute") return null;
    const distM = previewGoalDistanceM();
    if (distM == null) return null;
    return parsed.pace_sec_per_km * (distM / 1000);
  })();
  // What the single masked Goal-time input actually displays: its own live
  // buffer while it's the editable source of truth (goalTime mode), or the
  // just-computed equivalent while it's a read-only preview (anchor mode).
  const goalTimeDisplayValue = paceMode === "goalTime"
    ? formatGoalTimeDigits(goalTimeDigits)
    : (equivalentGoalTimeSec != null ? formatGoalTimeFromSec(equivalentGoalTimeSec) : "");

  const canInstantiate = templateId !== "" && instName.trim() !== "" && startDate !== "" && allResolved;

  // HRA-124: non-blocking warning only — trueMonday (start_date walked back
  // to what D1's date would be, per K0) landing on a real Monday is never
  // required to create the instance.
  const week1K0 = selectedPlan ? computeK0(selectedPlan) : null;
  const week1AnchorMismatch = week1K0 != null && startDate !== "" && mondayBasedWeekday(startDate) !== (week1K0 - 1) % 7;

  // HRA-121: "non-default data" gating the template-switch warning — start
  // date at today counts as default (nothing was deliberately typed there).
  function hasEnteredData(): boolean {
    if (instName.trim() !== "" || raceName.trim() !== "" || raceDate !== "" || raceUrl.trim() !== "") return true;
    if (startDate !== isoToday()) return true;
    if (daysBeforeRace.trim() !== "") return true;
    if (restDayLabel.trim() !== "") return true;
    if (goalTimeDigits !== "" || distanceM.trim() !== "") return true;
    if (racePaceAnchor !== NONE_ANCHOR) return true;
    return Object.values(anchorRows).some(row => !anchorRowIsEmpty(row));
  }

  async function onInstantiate() {
    setInstantiateLoading(true); setInstantiateError(null);
    try {
      const body: Parameters<typeof api.planTemplates.instantiate>[1] = { name: instName.trim(), start_date: startDate };
      if (raceName.trim() !== "") body.race_name = raceName.trim();
      if (raceDate.trim() !== "") body.race_date = raceDate.trim();
      if (raceUrl.trim() !== "") body.race_url = raceUrl.trim();
      if (restDayLabel.trim() !== "") body.rest_day_label = restDayLabel.trim();

      const overrides: Record<string, string> = {};
      for (const anchor of templateAnchors) {
        if (hasRacePaceAnchor && paceMode === "goalTime" && anchor === racePaceAnchor) continue;
        const row = anchorRows[anchor];
        if (!row) continue;
        if (row.absoluteValue.trim() !== "") overrides[anchor] = row.absoluteValue.trim();
        else if (row.relativeTo !== "" && row.seconds.trim() !== "") overrides[anchor] = `${row.relativeTo}${row.sign}${row.seconds.trim()}`;
      }
      if (hasRacePaceAnchor && paceMode === "goalTime") {
        body.goal_time = `${pad2(goalH)}:${pad2(goalM)}:${pad2(goalS)}`;
        body.race_pace_anchor = racePaceAnchor;
        if (distanceM.trim() !== "") body.distance_m = Number(distanceM);
      }
      if (Object.keys(overrides).length > 0) body.pace_overrides = overrides;

      const created = await api.planTemplates.instantiate(Number(templateId), body);
      await refreshInstances();
      // HRA-123: stay on the same unified plan screen instead of dropping
      // back to the list — created already carries {..., days}
      // (PlanInstanceWithDays), same shape startEdit() fetches via getById,
      // so no extra round-trip is needed. HRA-133: the shared top fields
      // (templateId, instName, startDate, race info, pace anchors) are
      // deliberately NOT reset here — they already hold exactly what was
      // just submitted, and now stay visible (locked) as this same
      // instance's own values, per the unified screen shape. HRA-141: the
      // "new" draft row's identity transitions to the real numeric id, same
      // as PlanTemplatesSection's own onSave does — and any stashed "new"
      // draft is dropped, since it's now persisted.
      setDrafts(prev => { if (!("new" in prev)) return prev; const next = { ...prev }; delete next.new; return next; });
      setActiveKey(created.id);
      setInstName(created.name ?? "");
      // HRA-134/HRA-136: current field values already equal exactly what was
      // just submitted — that's the new baseline, so both dirty buckets
      // start clean for a just-created instance.
      setBaselineStartDate(startDate);
      setBaselineAnchorRows(anchorRows);
      setBaselineRacePaceAnchor(racePaceAnchor);
      setBaselinePaceMode(paceMode);
      setBaselineGoalTimeDigits(goalTimeDigits); setBaselineDistanceM(distanceM);
      setBaselineInstName(created.name ?? "");
      setBaselineRaceName(raceName); setBaselineRaceDate(raceDate); setBaselineRaceUrl(raceUrl);
      setSaveForcedEnabled(false);
      const days: ResolvedDay[] = created.days.map(d => ({
        section_name: d.section_name, week_number: d.week_number, date: d.date, day: d.day,
        suffix: d.suffix ?? undefined, category: d.category ?? undefined, workout_type: d.workout_type as WorkoutType,
        segments: JSON.parse(d.segments), activity_target: d.activity_target ? JSON.parse(d.activity_target) : undefined,
        activity_description: d.activity_description ?? undefined, notes: d.notes ?? undefined, needs_review: d.needs_review === 1,
        id: d.id, scheduled_time: d.scheduled_time,
      }));
      const built = sectionsFromDays(days);
      setSections(built);
      setPersistedDsl(snapshotDsl(built));
      notify(t("manage.planInstances.instantiateSucceeded", "Instance created."));
    } catch (e) {
      setInstantiateError(e instanceof Error ? e.message : t("manage.planInstances.instantiateFailed", "Failed to create instance"));
    }
    setInstantiateLoading(false);
  }

  function sectionsFromDays(days: ResolvedDay[]) {
    return groupResolvedDaysIntoSectionViews(days.map(d => ({ ...d, dsl: reconstructDslFromResolvedDay(d) })));
  }

  // HRA-133: a stored PaceValue (JSON on plan_instances.pace_overrides) has
  // the same absolute/offset shape parsePaceOverrideInput already parses raw
  // text into — this is the reverse direction, formatting one back into the
  // anchor table row's own display fields. Note: goal_time is collapsed into
  // a plain absolute PaceValue at instantiate time (garmin-stats controller)
  // — there is no persisted way to tell "this came from goal_time" apart
  // from a raw absolute override, so a loaded instance always shows every
  // override as an Anchor-override-style row, never Goal time (known,
  // unavoidable display limitation — flagged in this Story's review).
  function paceValueToAnchorRow(pv: PaceValue): AnchorRowState {
    if (pv.kind === "absolute") return { absoluteValue: formatPaceSecPerKm(pv.pace_sec_per_km), relativeTo: "", sign: "+", seconds: "" };
    return { absoluteValue: "", relativeTo: pv.anchor, sign: pv.offset_sec_per_km >= 0 ? "+" : "-", seconds: String(Math.abs(pv.offset_sec_per_km)) };
  }

  // HRA-133: populates the same shared top fields the create flow uses, from
  // the loaded instance's own persisted values — this is what makes "same
  // screen shape whether fresh or existing" (AC1) true, not just a layout
  // coincidence. Fields with no persisted equivalent (restDayLabel, the
  // goal_time/race_pace_anchor split — see paceValueToAnchorRow above) stay
  // at resetPlanScreen()'s defaults.
  async function startEdit(instance: PlanInstance) {
    resetPlanScreen();
    setInstName(instance.name ?? "");
    setBaselineInstName(instance.name ?? "");
    setEditApprovedAt(instance.approved_at);
    setTemplateId(String(instance.template_id));
    setStartDate(instance.start_date);
    setBaselineStartDate(instance.start_date);
    setRaceName(instance.race_name ?? "");
    setRaceDate(instance.race_date ?? "");
    setRaceUrl(instance.race_url ?? "");
    setBaselineRaceName(instance.race_name ?? "");
    setBaselineRaceDate(instance.race_date ?? "");
    setBaselineRaceUrl(instance.race_url ?? "");
    setDaysBeforeRace(instance.race_date ? String(daysBetween(instance.start_date, instance.race_date)) : "");
    const plan = parsePlan(templates?.find(tpl => String(tpl.id) === String(instance.template_id)));
    const anchors = plan ? collectPlanAnchors(plan) : [];
    const overrides: PacePolicy = instance.pace_overrides ? JSON.parse(instance.pace_overrides) : {};
    const loadedAnchorRows = Object.fromEntries(anchors.map(a => [a, overrides[a] ? paceValueToAnchorRow(overrides[a]) : emptyAnchorRow()]));
    setAnchorRows(loadedAnchorRows);
    setBaselineAnchorRows(loadedAnchorRows);
    try {
      const full = await api.planInstances.getById(instance.id);
      const days: ResolvedDay[] = full.days.map(d => ({
        section_name: d.section_name, week_number: d.week_number, date: d.date, day: d.day,
        suffix: d.suffix ?? undefined, category: d.category ?? undefined, workout_type: d.workout_type as WorkoutType,
        segments: JSON.parse(d.segments), activity_target: d.activity_target ? JSON.parse(d.activity_target) : undefined,
        activity_description: d.activity_description ?? undefined, notes: d.notes ?? undefined, needs_review: d.needs_review === 1,
        id: d.id, scheduled_time: d.scheduled_time,
      }));
      const built = sectionsFromDays(days);
      setSections(built);
      setPersistedDsl(snapshotDsl(built));
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("manage.planInstances.loadInstanceFailed", "Failed to load instance"));
    }
  }

  // HRA-141: captures every live field PLUS its own baseline into one Draft
  // — see the interface's own comment for why the baselines have to travel
  // with the live values rather than being recomputed on reopen.
  function captureDraft(): Draft {
    return {
      templateId, instName, raceName, raceDate, raceUrl,
      startDate, daysBeforeRace, restDayLabel,
      racePaceAnchor, paceMode, goalTimeDigits, distanceM,
      anchorRows, sections, effectiveFrom,
      editApprovedAt, saveForcedEnabled,
      baselineInstName, baselineRaceName, baselineRaceDate, baselineRaceUrl,
      baselineStartDate, baselineAnchorRows,
      baselineRacePaceAnchor, baselinePaceMode, baselineGoalTimeDigits, baselineDistanceM,
      persistedDsl,
    };
  }
  // The inverse of captureDraft — restores every field from a stashed draft
  // exactly as it was, live values AND baselines both, so the dirty-bucket
  // verdict reopening a drafted row shows is identical to the one it had
  // when collapsed.
  function restoreDraft(draft: Draft) {
    setTemplateId(draft.templateId); setInstName(draft.instName); setRaceName(draft.raceName);
    setRaceDate(draft.raceDate); setRaceUrl(draft.raceUrl);
    setStartDate(draft.startDate); setDaysBeforeRace(draft.daysBeforeRace); setRestDayLabel(draft.restDayLabel);
    setRacePaceAnchor(draft.racePaceAnchor); setPaceMode(draft.paceMode);
    setGoalTimeDigits(draft.goalTimeDigits); setDistanceM(draft.distanceM);
    setAnchorRows(draft.anchorRows); setSections(draft.sections); setEffectiveFrom(draft.effectiveFrom);
    setEditApprovedAt(draft.editApprovedAt); setSaveForcedEnabled(draft.saveForcedEnabled);
    setBaselineInstName(draft.baselineInstName); setBaselineRaceName(draft.baselineRaceName);
    setBaselineRaceDate(draft.baselineRaceDate); setBaselineRaceUrl(draft.baselineRaceUrl);
    setBaselineStartDate(draft.baselineStartDate); setBaselineAnchorRows(draft.baselineAnchorRows);
    setBaselineRacePaceAnchor(draft.baselineRacePaceAnchor); setBaselinePaceMode(draft.baselinePaceMode);
    setBaselineGoalTimeDigits(draft.baselineGoalTimeDigits); setBaselineDistanceM(draft.baselineDistanceM);
    setPersistedDsl(draft.persistedDsl);
    setInstantiateError(null); setEditError(null); setPendingTemplateId(null);
  }

  // HRA-141: called before switching away from whatever row is currently
  // active (collapsing it, or opening a different row) — stashes a draft
  // into `drafts` if the row is genuinely dirty (either bucket), or drops
  // any stale stash if it turned out clean. Isn't called until AFTER the
  // dirty-bucket consts (below) are computed for this render, so it always
  // reads the up-to-date verdict.
  function stashCurrentIfDirty(dirty: boolean) {
    if (activeKey == null) return;
    const key = String(activeKey);
    if (dirty) {
      setDrafts(prev => ({ ...prev, [key]: captureDraft() }));
    } else {
      setDrafts(prev => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
    }
  }

  // HRA-141: the single entry point for both the "+ New instance" button and
  // every row's own AccordionCard toggle — stashes whatever was previously
  // open (never a discard), then either collapses everything (re-clicking
  // the already-open row) or opens the requested row, restoring its stashed
  // draft if one exists.
  async function onToggleRow(key: RowKey, dirtyNow: boolean) {
    if (activeKey === key) {
      stashCurrentIfDirty(dirtyNow);
      setActiveKey(null);
      return;
    }
    stashCurrentIfDirty(dirtyNow);
    setActiveKey(key);
    const draft = drafts[String(key)];
    if (draft) {
      restoreDraft(draft);
    } else if (key === "new") {
      resetPlanScreen();
    } else {
      const instance = instances?.find(inst => inst.id === key);
      if (instance) await startEdit(instance);
    }
  }

  function onDayEdit(sectionIndex: number, weekIndex: number, dayIndex: number, patch: { dsl?: string; notes?: string }) {
    const day = sections[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
    if (!day) return;
    const newLine = recomposeDayLine(day.dsl, patch);
    setSections(prev => {
      const sections = [...prev];
      const section = { ...sections[sectionIndex] };
      const weeks = [...section.weeks];
      const week = { ...weeks[weekIndex] };
      const days = [...week.days];
      days[dayIndex] = { ...days[dayIndex], dsl: newLine, notes: splitNote(newLine).note };
      week.days = days; weeks[weekIndex] = week; section.weeks = weeks; sections[sectionIndex] = section;
      return sections;
    });
    // HRA-162: a DSL edit (not a bare notes edit) re-triggers live
    // validation — the day's needs_review/warnings otherwise stay exactly
    // what they were at last load/save, stale until the whole-day bulk Save.
    if (patch.dsl !== undefined && day.id != null) scheduleLiveValidate(sectionIndex, weekIndex, dayIndex, day.id, newLine);
  }

  // HRA-162: debounced per-day live validation as the user edits DSL text in
  // List view (docs/runplan-dsl.md's "would be nice to validate on the fly"
  // note, now implemented). Deliberately a server round-trip against the
  // exact same parseDayEntry-backed endpoint the persisted
  // PATCH .../days/:dayId already validates against — POST
  // .../days/:dayId/validate (docs/api.md, HRA-162) — never a client-side
  // grammar reimplementation, per the Story's own AC ("not a
  // separate/duplicated rule set that could drift from parser.ts"). 400ms
  // debounce so it doesn't fire on every keystroke; a response that arrives
  // after the day's dsl has already moved on (a newer edit, a save, a row
  // switch) is discarded rather than clobbering fresher feedback with a
  // stale one — checked against sectionsRef (see its own comment above).
  const validateTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  function scheduleLiveValidate(sectionIndex: number, weekIndex: number, dayIndex: number, dayId: number, dsl: string) {
    clearTimeout(validateTimers.current[dayId]);
    validateTimers.current[dayId] = setTimeout(() => {
      delete validateTimers.current[dayId];
      if (editingId == null) return;
      api.planInstances.validateDay(editingId, dayId, dsl)
        .then(result => {
          const liveDay = sectionsRef.current[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
          if (!liveDay || liveDay.id !== dayId || liveDay.dsl !== dsl) return; // stale — a newer edit/save has already superseded this
          // Live follow-up: the parse succeeding also resolves it now
          // (docs/api.md), so workout_type/distance are included whenever
          // parsing didn't fail — patch those too, not just needs_review/
          // warnings, so this day's own total and its week/section rollups
          // stay consistent with the DSL actually on screen instead of only
          // updating at the next full Save/reload. When the parse itself
          // failed, those fields are absent and only needs_review/warnings
          // patch — same as before this change.
          const patch: Partial<DayView> = { needs_review: result.needs_review, warnings: result.warnings };
          if (result.workout_type !== undefined && result.segments !== undefined) {
            patch.workout_type = result.workout_type;
            patch.distance = computeResolvedDayDistance({
              section_name: "", week_number: 0, date: liveDay.date ?? "", day: liveDay.day, suffix: liveDay.suffix, category: liveDay.category,
              workout_type: result.workout_type, segments: result.segments,
              activity_target: result.activity_target ?? undefined, activity_description: result.activity_description ?? undefined,
              notes: liveDay.notes, needs_review: result.needs_review,
            });
          }
          patchLocalDayResolved(sectionIndex, weekIndex, dayIndex, patch);
        })
        .catch(() => {}); // never block typing on a transient network failure — the next debounced call (or the eventual Save) will surface it
    }, 400);
  }
  // Live follow-up: applies a patch to one day AND recomputes its owning
  // week's/section's own AggregateTotals in the SAME state update (via
  // aggregateDayViews, the DayView-shaped twin of aggregateResolvedDays
  // every other Section/Week total already uses) — the single place any
  // local (not-yet-saved) change to a day's workout_type/distance has to
  // go through, so the accordion's title-row totals never drift from
  // what's actually showing on screen. Used by the debounced live-validate
  // result above and by the run/rest/other switch's own confirm below.
  // Live follow-up: recomputes ONE week's and its owning section's own
  // AggregateTotals from whatever `sections` array is handed in — pure, no
  // state write itself, so both a single setSections updater (patchLocalDayResolved
  // below) and a multi-day one (swapDaysByRef/swapWeeksByRef, whose own
  // updater already builds the post-swap array before this runs) can call
  // it as the last step, including twice in the same updater when a swap's
  // two sides land in different weeks/sections.
  function recomputeTotals(secs: SectionView[], sectionIndex: number, weekIndex: number): SectionView[] {
    const next = [...secs];
    const section = { ...next[sectionIndex] };
    const weeks = [...section.weeks];
    weeks[weekIndex] = { ...weeks[weekIndex], totals: aggregateDayViews(weeks[weekIndex].days) };
    section.weeks = weeks;
    section.totals = aggregateDayViews(weeks.flatMap(w => w.days));
    next[sectionIndex] = section;
    return next;
  }
  function patchLocalDayResolved(sectionIndex: number, weekIndex: number, dayIndex: number, patch: Partial<DayView>) {
    setSections(prev => {
      const next = [...prev];
      const section = { ...next[sectionIndex] };
      const weeks = [...section.weeks];
      const days = [...weeks[weekIndex].days];
      days[dayIndex] = { ...days[dayIndex], ...patch };
      weeks[weekIndex] = { ...weeks[weekIndex], days };
      section.weeks = weeks;
      next[sectionIndex] = section;
      return recomputeTotals(next, sectionIndex, weekIndex);
    });
  }
  useEffect(() => () => { Object.values(validateTimers.current).forEach(clearTimeout); }, []);

  // HRA-150: unlike onDayEdit above (local-only, waits for the whole-day
  // bulk Save), scheduled_time persists immediately via its own PATCH
  // (docs/api.md's PATCH /plan-instances/:id/days/:dayId, HRA-149) — the
  // Story's own AC3. Optimistic: the local edit lands before the request
  // resolves so the input never visibly lags, and is rolled back on failure.
  function dayStateAt(sectionIndex: number, weekIndex: number, dayIndex: number) {
    return sections[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
  }
  function patchLocalDayScheduledTime(sectionIndex: number, weekIndex: number, dayIndex: number, scheduledTime: string | null | undefined) {
    setSections(prev => {
      const next = [...prev];
      const section = { ...next[sectionIndex] };
      const weeks = [...section.weeks];
      const week = { ...weeks[weekIndex] };
      const days = [...week.days];
      days[dayIndex] = { ...days[dayIndex], scheduled_time: scheduledTime };
      week.days = days; weeks[weekIndex] = week; section.weeks = weeks; next[sectionIndex] = section;
      return next;
    });
  }
  async function onScheduledTimeEdit(sectionIndex: number, weekIndex: number, dayIndex: number, scheduledTime: string | null) {
    if (editingId == null) return;
    const day = dayStateAt(sectionIndex, weekIndex, dayIndex);
    if (day?.id == null) return;
    const previous = day.scheduled_time;
    patchLocalDayScheduledTime(sectionIndex, weekIndex, dayIndex, scheduledTime);
    try {
      const updated = await api.planInstances.patchDay(editingId, day.id, { scheduled_time: scheduledTime });
      patchLocalDayScheduledTime(sectionIndex, weekIndex, dayIndex, updated.scheduled_time);
    } catch (e) {
      patchLocalDayScheduledTime(sectionIndex, weekIndex, dayIndex, previous);
      notify(e instanceof Error ? e.message : t("manage.planInstances.scheduledTimeFailed", "Failed to save scheduled time"), "error");
    }
  }

  // Live follow-up (post-HRA-163): the run/rest/other switch now writes the
  // DSL TEXT field itself (REST/OTHER's own bare DSL keyword; RUN clears
  // the body so a real workout can be typed) instead of a separate
  // workout_type column — reusing onDayEdit below, the exact same
  // local-only-until-Save path a manual DSL edit already goes through
  // (HRA-149/150's own rule), rather than the HRA-163 immediate-PATCH
  // mechanism this replaces (that backend field/endpoint support has been
  // reverted — nothing calls it any more). This also means the switch no
  // longer needs its own trainingLoadCategory approximation: it now has
  // exactly the same (already-accepted) "distance/metrics/category stay
  // stale until Save" behavior as typing REST/OTHER into the DSL box by
  // hand, not a special case.
  // Destructive (replaces whatever workout text/segments were there), so
  // it stages a pending confirmation first — same "stage, render a confirm
  // modal, mutate only once the user actually confirms" shape
  // pendingDaySwap/pendingWeekSwap/pendingRegenerateCount already use.
  const [pendingWorkoutTypeChange, setPendingWorkoutTypeChange] = useState<{
    sectionIndex: number; weekIndex: number; dayIndex: number; workoutType: WorkoutTypeSwitchValue;
  } | null>(null);
  function onWorkoutTypeEdit(sectionIndex: number, weekIndex: number, dayIndex: number, workoutType: WorkoutTypeSwitchValue) {
    setPendingWorkoutTypeChange({ sectionIndex, weekIndex, dayIndex, workoutType });
  }
  function cancelWorkoutTypeChange() { setPendingWorkoutTypeChange(null); }
  function confirmWorkoutTypeChange() {
    if (!pendingWorkoutTypeChange) return;
    const { sectionIndex, weekIndex, dayIndex, workoutType } = pendingWorkoutTypeChange;
    setPendingWorkoutTypeChange(null);
    const day = sections[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
    if (!day) return;
    const dayPrefix = day.dsl.match(DAY_PREFIX_RE)?.[0] ?? "";
    // RUN has no single canonical DSL body (unlike REST/OTHER's own bare
    // keyword) — clears the body instead, so the day is ready for the user
    // to type a real workout, same "confirm, then replace" shape either way.
    const newBody = workoutType === "rest" ? "REST" : workoutType === "other" ? "OTHER" : "";
    const newDsl = recomposeDayLine(`${dayPrefix}${newBody}`, { notes: day.notes });
    onDayEdit(sectionIndex, weekIndex, dayIndex, { dsl: newDsl });
    // Bug fix: onDayEdit only ever patches dsl/notes (matching a manual DSL
    // edit) — day.workout_type/distance stay whatever they were at last
    // load/Save until a real re-parse happens (onDayEdit's own debounced
    // live-validate, ~400ms later), so the switch's own active button
    // (workoutTypeSwitchValue(day.workout_type)) never moved after a
    // confirm, and the row's/week's/section's totals kept showing this
    // day's OLD content. Unlike a hand-typed edit, REST/OTHER/RUN-clear's
    // outcome is fully known up front (no segments -> 0 distance) — patch
    // workout_type+distance (and the owning week/section totals with them,
    // via patchLocalDayResolved) immediately, rather than waiting on the
    // debounce that's about to fire anyway and would just confirm the same
    // values.
    patchLocalDayResolved(sectionIndex, weekIndex, dayIndex, { workout_type: workoutType as WorkoutType, distance: { meters: 0, approximate: false } });
    notify(t("manage.planInstances.workoutTypeChanged", "Day type updated — remember to Save."));
  }

  // HRA-151: PlanInstanceCalendar (the Agenda view) only ever has the day's
  // own backend id at hand — react-big-calendar's dateHeader contract gives
  // it a Date, not the section/week/day indices the List view already
  // threads through. Resolves the same {sectionIndex, weekIndex, dayIndex}
  // ref onScheduledTimeEdit above needs, then delegates to it — one PATCH +
  // optimistic-update implementation shared by both views of the same
  // `sections` state (the "sibling views share data" pattern this file's own
  // template/instance list lift-up already established, CLAUDE.md).
  function findDayIndicesById(dayId: number): { sectionIndex: number; weekIndex: number; dayIndex: number } | null {
    for (let si = 0; si < sections.length; si++) {
      for (let wi = 0; wi < sections[si].weeks.length; wi++) {
        const dayIndex = sections[si].weeks[wi].days.findIndex(d => d.id === dayId);
        if (dayIndex !== -1) return { sectionIndex: si, weekIndex: wi, dayIndex };
      }
    }
    return null;
  }
  function onScheduledTimeEditByDayId(dayId: number, scheduledTime: string | null) {
    const ref = findDayIndicesById(dayId);
    if (!ref) return;
    onScheduledTimeEdit(ref.sectionIndex, ref.weekIndex, ref.dayIndex, scheduledTime);
  }

  // HRA-127: day/week swap — flat, cross-week/cross-section pickable lists
  // for the two "swap with…" selectors below. A day's calendar date never
  // moves (only content exchanges), so date isn't part of the label — the
  // D-line workout text itself is the useful cue for telling rows apart.

  // HRA-152 follow-up fix: scheduled_time is its own persisted column, not
  // part of the DSL text swapDayContent exchanges — a swap that only moved
  // dsl/notes left each day's OLD scheduled_time behind at its own position,
  // so the workout moved but its scheduled time didn't (reported live after
  // shipping HRA-152). scheduled_time persists immediately regardless of the
  // Save button (HRA-149/150's own rule, unlike dsl/notes which stay local
  // until Save) — so a swap has to PATCH both sides' new scheduled_time
  // right away too, or local state and the backend disagree the moment
  // either day's chip is touched next. Best-effort: the local (already-
  // swapped) state is the source of truth for display either way; a failed
  // PATCH here only means the backend hasn't caught up yet, surfaced via the
  // same error toast onScheduledTimeEdit already uses.
  async function persistSwappedScheduledTimes(pairs: { day: DayView; newScheduledTime: string | null | undefined }[]) {
    if (editingId == null) return;
    const instanceId = editingId;
    await Promise.allSettled(
      pairs
        .filter((p): p is { day: DayView & { id: number }; newScheduledTime: string | null | undefined } => p.day.id != null)
        .map(({ day, newScheduledTime }) => api.planInstances.patchDay(instanceId, day.id, { scheduled_time: newScheduledTime ?? null })),
    ).then(results => {
      if (results.some(r => r.status === "rejected")) {
        notify(t("manage.planInstances.scheduledTimeFailed", "Failed to save scheduled time"), "error");
      }
    });
  }

  // Core swap mutations, parameterized by explicit refs so both the picker
  // (Select) UI below AND the accordion's native drag-and-drop (HRA-127
  // follow-up — TrainingPlanAccordion's onDaySwap/onWeekSwap props) share
  // one implementation. dsl/notes only mutate local `sections` state —
  // persisted the same way any other day edit already is, via the existing
  // Save button; scheduled_time additionally persists right away (see
  // persistSwappedScheduledTimes above).
  // HRA-164: a day's SLOT (day/suffix/category — the D<n>[suffix][tag]:
  // prefix identity, plus date/id, the actual calendar position and backend
  // row this content now lives in) never moves; everything else describes
  // the CONTENT that just moved into that slot, so it has to travel WITH
  // that content, not stay behind. The old code spread the OLD day object
  // and only overrode dsl/notes/scheduled_time — leaving workout_type,
  // needs_review, warnings, distance, metrics, trainingLoadCategory
  // describing the day's PREVIOUS content while the visible dsl already
  // showed the new one. Fixed by inverting which side is spread: take the
  // OTHER day's entire object (its derived fields are already correct for
  // the content that's arriving) and override only this slot's own
  // position-identity fields back on top — no per-field copy list to keep in
  // sync as DayView gains fields later (the AC's own "not a partial field
  // list" concern). trainingLoadCategory is a still-approximate carryover in
  // one case (a swap across week boundaries can change long_run's "week's
  // longest run" context) — same known limitation flagged on HRA-163, not
  // reintroduced here, not fixed here either (would need a full plan-wide
  // reclassify, out of this bug's scope).
  function swapDaysByRef(a: { sectionIndex: number; weekIndex: number; dayIndex: number }, b: { sectionIndex: number; weekIndex: number; dayIndex: number }) {
    const dayA = sections[a.sectionIndex]?.weeks[a.weekIndex]?.days[a.dayIndex];
    const dayB = sections[b.sectionIndex]?.weeks[b.weekIndex]?.days[b.dayIndex];
    if (!dayA || !dayB) return;
    const [newA, newB] = swapDayContent(dayA.dsl, dayB.dsl);
    const newTimeA = dayB.scheduled_time;
    const newTimeB = dayA.scheduled_time;
    setSections(prev => {
      const next = prev.map(s => ({ ...s, weeks: s.weeks.map(w => ({ ...w, days: w.days.map(d => ({ ...d })) })) }));
      next[a.sectionIndex].weeks[a.weekIndex].days[a.dayIndex] = {
        ...dayB, dsl: newA, notes: splitNote(newA).note, scheduled_time: newTimeA,
        day: dayA.day, suffix: dayA.suffix, category: dayA.category, date: dayA.date, id: dayA.id,
      };
      next[b.sectionIndex].weeks[b.weekIndex].days[b.dayIndex] = {
        ...dayA, dsl: newB, notes: splitNote(newB).note, scheduled_time: newTimeB,
        day: dayB.day, suffix: dayB.suffix, category: dayB.category, date: dayB.date, id: dayB.id,
      };
      // Live follow-up: each slot's own distance/workout_type already moved
      // correctly WITH its content (the spread above), but the OWNING
      // week's/section's own AggregateTotals are a separate, precomputed
      // value that doesn't recompute itself — same-week swaps happen to
      // still be numerically right (same days, same content, just
      // reordered), but a cross-week/cross-section swap actually needs to
      // move content out of one total and into the other. Recompute both
      // sides unconditionally rather than special-casing same-vs-cross.
      const afterA = recomputeTotals(next, a.sectionIndex, a.weekIndex);
      return recomputeTotals(afterA, b.sectionIndex, b.weekIndex);
    });
    void persistSwappedScheduledTimes([
      { day: dayA, newScheduledTime: newTimeA },
      { day: dayB, newScheduledTime: newTimeB },
    ]);
  }

  // Matches days by their own D-number (not array position) so weeks with
  // different declared day-sets (a pre-HRA-124 partial week, or two weeks
  // whose sections diverge) still swap every day-number both sides actually
  // share — a day-number present in only one side is left untouched rather
  // than guessed at, same "don't guess" discipline swapDayContent itself uses.
  // HRA-164: same fix as swapDaysByRef above, per day pair — captures each
  // day's full pre-mutation snapshot (originalA/originalB, already needed for
  // timePairs below) and assigns the OTHER side's whole snapshot onto this
  // slot before re-fixing the position-identity fields back on top, instead
  // of mutating only dsl/notes/scheduled_time in place and leaving every
  // other derived field (workout_type, needs_review, warnings, distance,
  // metrics, trainingLoadCategory) describing the day's old content.
  function swapWeeksByRef(a: { sectionIndex: number; weekIndex: number }, b: { sectionIndex: number; weekIndex: number }) {
    const timePairs: { day: DayView; newScheduledTime: string | null | undefined }[] = [];
    setSections(prev => {
      const next = prev.map(s => ({ ...s, weeks: s.weeks.map(w => ({ ...w, days: w.days.map(d => ({ ...d })) })) }));
      const weekA = next[a.sectionIndex].weeks[a.weekIndex];
      const weekB = next[b.sectionIndex].weeks[b.weekIndex];
      for (const dayB of weekB.days) {
        const dayA = weekA.days.find(d => d.day === dayB.day);
        if (!dayA) continue;
        const [newA, newB] = swapDayContent(dayA.dsl, dayB.dsl);
        const newTimeA = dayB.scheduled_time;
        const newTimeB = dayA.scheduled_time;
        const originalA = { ...dayA };
        const originalB = { ...dayB };
        timePairs.push({ day: originalA, newScheduledTime: newTimeA }, { day: originalB, newScheduledTime: newTimeB });
        Object.assign(dayA, originalB, {
          dsl: newA, notes: splitNote(newA).note, scheduled_time: newTimeA,
          day: originalA.day, suffix: originalA.suffix, category: originalA.category, date: originalA.date, id: originalA.id,
        });
        Object.assign(dayB, originalA, {
          dsl: newB, notes: splitNote(newB).note, scheduled_time: newTimeB,
          day: originalB.day, suffix: originalB.suffix, category: originalB.category, date: originalB.date, id: originalB.id,
        });
      }
      // Live follow-up: same reasoning as swapDaysByRef's own totals
      // recompute above — each day's own distance/workout_type already
      // moved correctly with its content, but the two weeks' (and their
      // sections') own AggregateTotals need recomputing too, since a
      // whole week's worth of content can cross a section boundary here.
      const afterA = recomputeTotals(next, a.sectionIndex, a.weekIndex);
      return recomputeTotals(afterA, b.sectionIndex, b.weekIndex);
    });
    void persistSwappedScheduledTimes(timePairs);
  }

  // HRA-131: both entry points below now only stage a pending swap for
  // confirmation — neither mutates `sections` directly any more. The actual
  // mutation happens in confirmDaySwap/confirmWeekSwap once the user
  // confirms the modal (rendered further down, next to TrainingPlanAccordion).
  function onSwapDays() {
    if (!swapDayA || !swapDayB || swapDayA === swapDayB) return;
    const [aSi, aWi, aDi] = swapDayA.split("-").map(Number);
    const [bSi, bWi, bDi] = swapDayB.split("-").map(Number);
    setPendingDaySwap({ a: { sectionIndex: aSi, weekIndex: aWi, dayIndex: aDi }, b: { sectionIndex: bSi, weekIndex: bWi, dayIndex: bDi } });
  }

  function onSwapWeeks() {
    if (!swapWeekA || !swapWeekB || swapWeekA === swapWeekB) return;
    const [aSi, aWi] = swapWeekA.split("-").map(Number);
    const [bSi, bWi] = swapWeekB.split("-").map(Number);
    setPendingWeekSwap({ a: { sectionIndex: aSi, weekIndex: aWi }, b: { sectionIndex: bSi, weekIndex: bWi } });
  }

  // HRA-158: onSwapDays/onSwapWeeks are kept per the Story's AC (drag-and-drop
  // reuses the same swap plumbing) even though their only caller, the picker
  // UI, is now hidden — referenced here so the retained functions aren't
  // flagged as unused.
  void onSwapDays;
  void onSwapWeeks;

  // HRA-127 follow-up: drag-and-drop, as an alternative UX to the picker
  // above for the same underlying swap — TrainingPlanAccordion calls these
  // with both rows' refs once a valid drop completes (it already guards
  // against a drop onto the row's own self). HRA-131: stages the same
  // pending-confirm state the picker path uses, rather than swapping
  // immediately — one confirm modal covers both entry points.
  function onDayDragSwap(a: DayRef, b: DayRef) {
    setPendingDaySwap({ a, b });
  }
  // HRA-152: PlanInstanceCalendar's own drag-and-drop only ever has each
  // side's backend dayId (see its own Props comment) — resolves both to the
  // {sectionIndex, weekIndex, dayIndex} refs onDayDragSwap above needs via
  // the same findDayIndicesById HRA-151 already built for scheduled_time,
  // then delegates to it. Same pending-confirm modal, same swapDaysByRef
  // core, same notify() — only the entry point is new (Ask #1).
  function onDayDragSwapByDayId(aDayId: number, bDayId: number) {
    const aRef = findDayIndicesById(aDayId);
    const bRef = findDayIndicesById(bDayId);
    if (!aRef || !bRef) return;
    onDayDragSwap(aRef, bRef);
  }
  function onWeekDragSwap(a: WeekRef, b: WeekRef) {
    setPendingWeekSwap({ a, b });
  }

  function dayByRef(ref: DayRef): DayView | undefined {
    return sections[ref.sectionIndex]?.weeks[ref.weekIndex]?.days[ref.dayIndex];
  }
  function weekByRef(ref: WeekRef): WeekView | undefined {
    return sections[ref.sectionIndex]?.weeks[ref.weekIndex];
  }

  function confirmDaySwap() {
    if (pendingDaySwap != null) {
      swapDaysByRef(pendingDaySwap.a, pendingDaySwap.b);
      notify(t("manage.planInstances.daySwapped", "Days swapped — remember to Save."));
    }
    setPendingDaySwap(null);
    setSwapDayA(""); setSwapDayB("");
  }
  function cancelDaySwap() { setPendingDaySwap(null); }

  function confirmWeekSwap() {
    if (pendingWeekSwap != null) {
      swapWeeksByRef(pendingWeekSwap.a, pendingWeekSwap.b);
      notify(t("manage.planInstances.weekSwapped", "Weeks swapped — remember to Save."));
    }
    setPendingWeekSwap(null);
    setSwapWeekA(""); setSwapWeekB("");
  }
  function cancelWeekSwap() { setPendingWeekSwap(null); }

  // HRA-136: now also persists Race name/date/url (HRA-135's PATCH accepts
  // them alongside name/days) — always sent (not conditionally, unlike
  // onInstantiate's own body-building) since PATCH's own semantics make
  // resending an unchanged value harmless, and it keeps this call a single
  // fixed shape rather than a diff against baselines.
  async function onSave() {
    if (editingId == null) return;
    setSaveLoading(true); setEditError(null);
    const days = sections.flatMap(s => s.weeks.flatMap(w => w.days.map(d => ({
      section_name: s.name, week_number: w.number, date: d.date!, dsl: d.dsl,
    }))));
    const name = instName.trim();
    try {
      const updated = await api.planInstances.update(editingId, {
        name, race_name: raceName.trim() || null, race_date: raceDate || null, race_url: raceUrl.trim() || null, days,
      });
      const resolvedDays: ResolvedDay[] = updated.days.map(d => ({
        section_name: d.section_name, week_number: d.week_number, date: d.date, day: d.day,
        suffix: d.suffix ?? undefined, category: d.category ?? undefined, workout_type: d.workout_type as WorkoutType,
        segments: JSON.parse(d.segments), activity_target: d.activity_target ? JSON.parse(d.activity_target) : undefined,
        activity_description: d.activity_description ?? undefined, notes: d.notes ?? undefined, needs_review: d.needs_review === 1,
        id: d.id, scheduled_time: d.scheduled_time,
      }));
      const built = sectionsFromDays(resolvedDays);
      setSections(built);
      setPersistedDsl(snapshotDsl(built));
      setEditApprovedAt(updated.approved_at);
      // HRA-136: re-baseline the Save-bucket's own fields to what was just
      // persisted, and drop the post-regenerate forced-enable now that a
      // real save ran — Save's enabled state goes back to pure dirty-tracking.
      setInstName(updated.name ?? name);
      setBaselineInstName(updated.name ?? name);
      setBaselineRaceName(updated.race_name ?? "");
      setBaselineRaceDate(updated.race_date ?? "");
      setBaselineRaceUrl(updated.race_url ?? "");
      setSaveForcedEnabled(false);
      // HRA-141: the row this draft belonged to just got persisted — drop
      // its stash, matching PlanTemplatesSection's own onSave.
      setDrafts(prev => { const key = String(editingId); if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
      await refreshInstances();
      notify(t("manage.planInstances.saveSucceeded", "Instance saved."));
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("manage.planInstances.saveFailed", "Failed to save instance"));
    }
    setSaveLoading(false);
  }

  // HRA-136 Ask #2: Save is gated on a confirm popup only when Name actually
  // changed — checked at click time against the Save-bucket's own baseline,
  // not per-keystroke (see pendingNameChangeConfirm's own comment above).
  function onSaveClick() {
    if (instName.trim() !== baselineInstName) { setPendingNameChangeConfirm(true); return; }
    onSave();
  }
  function confirmNameChange() { setPendingNameChangeConfirm(false); onSave(); }
  function cancelNameChange() { setPendingNameChangeConfirm(false); }

  async function onApprove() {
    if (editingId == null) return;
    setApproveLoading(true);
    try {
      const approved = await api.planInstances.approve(editingId);
      setEditApprovedAt(approved.approved_at);
      await refreshInstances();
      notify(t("manage.planInstances.approveSucceeded", "Instance approved."));
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("manage.planInstances.approveFailed", "Failed to approve instance"));
    }
    setApproveLoading(false);
  }

  // Regenerate always sends a COMPLETE override map, even {} — omitting the
  // field would mean "keep the instance's current stored overrides"
  // server-side (HRA-132), silently ignoring the user having cleared every
  // anchor row. HRA-136: the goal-time/race-pace-anchor toggle is now
  // reachable post-creation too (Ask #1) — the regenerate endpoint itself
  // has no goal_time field (that's a contract change, HRA-36's territory,
  // out of this Story's slice), so the race-pace anchor's own row is
  // populated from the SAME client-side derivation the anchor table's
  // preview already uses (derivedPaceSecPerKm) rather than sent as raw
  // goal_time/race_pace_anchor fields — this stays entirely within the
  // existing pace_overrides: Record<string,string> contract.
  function buildPaceOverridesForRegenerate(): Record<string, string> {
    const overrides: Record<string, string> = {};
    if (hasRacePaceAnchor && paceMode === "goalTime" && derivedPaceSecPerKm != null) {
      overrides[racePaceAnchor] = formatPaceSecPerKm(derivedPaceSecPerKm);
    }
    for (const anchor of templateAnchors) {
      if (hasRacePaceAnchor && paceMode === "goalTime" && anchor === racePaceAnchor) continue; // derived above
      const row = anchorRows[anchor];
      if (!row) continue;
      if (row.absoluteValue.trim() !== "") overrides[anchor] = row.absoluteValue.trim();
      else if (row.relativeTo !== "" && row.seconds.trim() !== "") overrides[anchor] = `${row.relativeTo}${row.sign}${row.seconds.trim()}`;
    }
    return overrides;
  }

  // Counts days in the CURRENT `sections` (not the persisted baseline) whose
  // date falls on/after `cutover` and whose dsl has diverged from
  // `persistedDsl` — i.e. days a regenerate call would silently discard.
  function manualEditCount(cutover: string): number {
    let count = 0;
    sections.forEach(s => s.weeks.forEach(w => w.days.forEach(d => {
      if (d.date != null && d.date >= cutover && persistedDsl[d.date] !== undefined && persistedDsl[d.date] !== d.dsl) count++;
    })));
    return count;
  }

  async function doRegenerate() {
    if (editingId == null) return;
    setPendingRegenerateCount(null);
    setRegenerateLoading(true); setEditError(null);
    try {
      const updated = await api.planInstances.regenerate(editingId, {
        start_date: startDate,
        pace_overrides: buildPaceOverridesForRegenerate(),
        effective_from: effectiveFrom,
      });
      const resolvedDays: ResolvedDay[] = updated.days.map(d => ({
        section_name: d.section_name, week_number: d.week_number, date: d.date, day: d.day,
        suffix: d.suffix ?? undefined, category: d.category ?? undefined, workout_type: d.workout_type as WorkoutType,
        segments: JSON.parse(d.segments), activity_target: d.activity_target ? JSON.parse(d.activity_target) : undefined,
        activity_description: d.activity_description ?? undefined, notes: d.notes ?? undefined, needs_review: d.needs_review === 1,
        id: d.id, scheduled_time: d.scheduled_time,
      }));
      const built = sectionsFromDays(resolvedDays);
      setSections(built);
      setPersistedDsl(snapshotDsl(built));
      setEditApprovedAt(updated.approved_at);
      // The just-regenerated values are the new baseline — the
      // Regenerate-bucket goes clean until something is edited again, and
      // (HRA-136 AC5) Save is unconditionally force-enabled regardless of
      // whether the Save-bucket itself happens to be dirty right now.
      setBaselineStartDate(startDate);
      setBaselineAnchorRows(anchorRows);
      setBaselineRacePaceAnchor(racePaceAnchor);
      setBaselinePaceMode(paceMode);
      setBaselineGoalTimeDigits(goalTimeDigits); setBaselineDistanceM(distanceM);
      setSaveForcedEnabled(true);
      // HRA-141: this row just got persisted too — drop its stash, matching
      // onSave above (a successful Regenerate is one of AC4's two "clears
      // the warning icon" triggers).
      setDrafts(prev => { const key = String(editingId); if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
      await refreshInstances();
      notify(t("manage.planInstances.regenerateSucceeded", `Instance regenerated — days from ${effectiveFrom} onward were updated.`, { date: effectiveFrom }));
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("manage.planInstances.regenerateFailed", "Failed to regenerate instance"));
    }
    setRegenerateLoading(false);
  }

  // HRA-134: warn before discarding manually-edited days on/after the
  // cutover — same pending-then-confirm/cancel shape pendingTemplateId/
  // pendingDaySwap already established. No manual edits in range means
  // nothing to warn about, so regenerate proceeds immediately.
  function onRegenerateClick() {
    const count = manualEditCount(effectiveFrom);
    if (count > 0) { setPendingRegenerateCount(count); return; }
    doRegenerate();
  }
  function cancelRegenerate() { setPendingRegenerateCount(null); }

  // HRA-141 Ask #3: "Restore" (renamed from Cancel) discards the active
  // row's unsaved edits and collapses it — since the list row itself only
  // ever displays the real persisted `instances` data (never mutated by
  // local typing), simply resetting local state + collapsing IS "reverting
  // to the last-saved values"; there's nothing to re-populate. Gated on a
  // confirm only when genuinely dirty (either bucket, HRA-136's own union).
  function onRestoreClick(dirty: boolean) {
    if (dirty) { setPendingRestoreConfirm(true); return; }
    doRestore();
  }
  function doRestore() {
    setPendingRestoreConfirm(false);
    if (activeKey != null) {
      const key = String(activeKey);
      setDrafts(prev => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
    }
    resetPlanScreen();
    setActiveKey(null);
  }
  function cancelRestoreConfirm() { setPendingRestoreConfirm(false); }

  async function onDelete(id: number) {
    setDeleteError(null);
    try {
      await api.planInstances.remove(id);
      setDeleteConfirmId(null);
      setDrafts(prev => { const key = String(id); if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
      if (activeKey === id) { resetPlanScreen(); setActiveKey(null); }
      await refreshInstances();
      notify(t("manage.planInstances.deleteSucceeded", "Instance deleted."));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t("manage.planInstances.deleteFailed", "Failed to delete instance"));
    }
  }

  // HRA-126: once approved, the plan view locks — Save and day-edit disabled,
  // Approve disabled (no double-approve). Nothing is hidden or deleted — the
  // instance stays fully viewable/retrievable, only the editing affordances
  // go away.
  const isApproved = editApprovedAt != null;
  const editWeek1AnchorMismatch = editorWeek1AnchorMismatch(sections);
  // HRA-133/HRA-134/HRA-136: once an instance exists (freshly created this
  // session, or loaded via startEdit), the shared top fields below used to
  // lock — HRA-136 Ask #1 unlocks every one of them (Template excepted,
  // which keeps its own `fieldsLocked` gate below): the Name/start_date/
  // anchor-table exception three earlier Stories carved out one field at a
  // time (`nameDisabled`/`editableFieldDisabled`) is now just the general
  // rule, so those two names collapse into one `fieldDisabled`.
  const fieldsLocked = editingId != null;
  const fieldDisabled = fieldsLocked ? isApproved : !formEnabled;
  const showWeek1AnchorWarning = week1AnchorMismatch || editWeek1AnchorMismatch;
  // HRA-136: the two disjoint dirty buckets from the Story's own Ask #4.
  // Never true before an instance exists (fieldsLocked false) or once
  // approved (editing an approved instance is out of scope, same HRA-126
  // lock every other write already respects).
  const anchorRowsChanged = JSON.stringify(anchorRows) !== JSON.stringify(baselineAnchorRows);
  const goalTimeFieldsChanged = paceMode === "goalTime" && (goalTimeDigits !== baselineGoalTimeDigits || distanceM !== baselineDistanceM);
  const regenerateBucketDirty = fieldsLocked && !isApproved && (
    startDate !== baselineStartDate || racePaceAnchor !== baselineRacePaceAnchor || paceMode !== baselinePaceMode
    || anchorRowsChanged || goalTimeFieldsChanged
  );
  const anyDayDirty = sections.some(s => s.weeks.some(w => w.days.some(d => d.date != null && persistedDsl[d.date] !== undefined && persistedDsl[d.date] !== d.dsl)));
  const saveBucketDirty = fieldsLocked && !isApproved && (
    instName.trim() !== baselineInstName || raceName.trim() !== baselineRaceName || raceDate !== baselineRaceDate
    || raceUrl.trim() !== baselineRaceUrl || anyDayDirty
  );
  // AC3: Regenerate-bucket-dirty always wins, disabling Save entirely even
  // when the Save-bucket is also currently dirty. AC5: a successful
  // Regenerate re-enables Save unconditionally (saveForcedEnabled) — but
  // still loses to a fresh Regenerate-bucket edit made after that, same as
  // any other Save-bucket dirtiness would.
  const saveEnabled = !regenerateBucketDirty && (saveBucketDirty || saveForcedEnabled);
  // The Regenerate-unit div below isn't a real <button> (it nests a
  // DatePicker inside it), so its own disabled state has to be computed and
  // applied by hand instead of a `disabled` attribute — same three
  // conditions the old plain <button> used.
  const regenerateDisabled = regenerateLoading || !regenerateBucketDirty || isApproved;
  // HRA-141: the single "does this row have anything unsaved" signal the
  // Story's own Ask #3/#4 name — drives both the Restore confirm gate and
  // what gets stashed on collapse/row-switch.
  const isDirty = saveBucketDirty || regenerateBucketDirty;

  // HRA-141 Ask #2/#4: a collapsed row's own status hint — a drafted (dirty
  // but collapsed) row gets the warning icon; any other collapsed row gets
  // the plain "Open to edit" hint. Mirrors PlanTemplatesSection's own
  // rowStatusHint exactly.
  function rowStatusHint(key: RowKey) {
    if (drafts[String(key)]) {
      return (
        <span
          title={t("manage.planInstances.unsavedChanges", "Unsaved changes")}
          className="hra-text-warning"
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          <AlertTriangle size={14} />
        </span>
      );
    }
    return (
      <span className="hra-text-secondary" style={{ fontSize: 11, fontStyle: "italic" }}>
        {t("manage.planInstances.openToEditHint", "Open to edit")}
      </span>
    );
  }

  function renderRowTitle(inst: PlanInstance) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inst.name ?? t("manage.planInstances.untitled", "Untitled instance")}</span>
        {inst.event && <span className="hra-text-muted" style={{ fontSize: 11 }}>{t(`manage.planTemplates.event.${inst.event}`, inst.event)}</span>}
        <span className="hra-text-muted" style={{ fontSize: 11 }}>{inst.start_date}</span>
        <Badge
          label={inst.approved_at ? t("manage.planInstances.approved", "Approved") : t("manage.planInstances.notApproved", "Not approved")}
          color={inst.approved_at ? "var(--accent-green)" : "var(--text-muted)"}
        />
        {activeKey !== inst.id && rowStatusHint(inst.id)}
      </span>
    );
  }

  // HRA-141: everything that used to render as the whole `mode === "plan"`
  // screen (minus the outer Card/title-badge header, which the accordion's
  // own row title now covers) — shared by every row's AccordionCard, only
  // ever actually rendered for whichever one is expanded (each call site
  // gates on `activeKey === key` before calling this).
  function renderEditorFields() {
    return (
      <>
        {/* Row 1 — identity. Template gates the whole form below; Name is
            required; Race name/Race date/Link a race are independently
            optional. Equal-width grid, not ad hoc flex-basis guessing.
            HRA-133: same row whether creating fresh or viewing an existing
            instance — startEdit() populates every field from the instance's
            own persisted values, fieldsLocked/fieldDisabled just gate
            interactivity, not visibility (AC1's "same screen shape"). */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 6 }}>
          <Field label={t("manage.planInstances.templateLabel", "Template")} required>
            <Select
              value={templateId} onValueChange={onTemplateSelectChange}
              options={(templates ?? []).map(tpl => ({ value: String(tpl.id), label: tpl.name }))}
              placeholder={t("manage.planInstances.templatePlaceholder", "Pick a template…")}
              triggerStyle={{ width: "100%" }}
              disabled={fieldsLocked}
            />
          </Field>
          <Field label={t("manage.planTemplates.nameLabel", "Name")} required>
            <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={instName} onChange={e => setInstName(e.target.value)} disabled={fieldDisabled} style={{ width: "100%", padding: "0 10px" }} />
          </Field>
          <Field label={t("manage.planInstances.raceNameLabel", "Race name")}>
            <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={raceName} onChange={e => setRaceName(e.target.value)} disabled={fieldDisabled} placeholder={t("common.optional", "Optional")} style={{ width: "100%", padding: "0 10px" }} />
          </Field>
          <Field label={t("manage.planInstances.raceDateLabel", "Race date")}>
            <DatePicker value={raceDate} onChange={onRaceDateChange} disabled={fieldDisabled} />
          </Field>
          <Field label={t("manage.planInstances.linkRaceLabel", "Link a race")}>
            <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={raceUrl} onChange={e => setRaceUrl(e.target.value)} disabled={fieldDisabled} placeholder={t("manage.planInstances.linkRacePlaceholder", "e.g. https://www.baa.org/races/boston-marathon")} style={{ width: "100%", padding: "0 10px" }} />
          </Field>
        </div>
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
          <span className="hra-text-danger">*</span> {t("manage.planInstances.requiredLegend", "required")}
          {!fieldsLocked && !formEnabled && <> — {t("manage.planInstances.pickTemplateFirst", "pick a Template above to enable the rest of this form.")}</>}
        </div>

        {/* Row 2 — timing. */}
        <div style={{ display: "grid", gridTemplateColumns: "160px 160px 220px", gap: 10, marginBottom: 6 }}>
          <Field label={t("manage.planInstances.startDateLabel", "Start date")}>
            <DatePicker value={startDate} onChange={onStartDateChange} disabled={fieldDisabled} />
          </Field>
          <Field label={t("manage.planInstances.daysBeforeRaceLabel", "Days before race")}>
            <input
              className="hra-border-strong hra-bg-card hra-text-primary"
              value={daysBeforeRace} onChange={e => onDaysBeforeRaceChange(e.target.value)}
              type="number" disabled={fieldDisabled || !raceDate}
              placeholder={raceDate ? undefined : t("manage.planInstances.daysBeforeRaceUnavailable", "Set a race date above")}
              style={{ width: "100%", padding: "0 10px" }}
            />
          </Field>
          <Field label={t("manage.planInstances.restDayLabelLabel", "Rest day label")}>
            <input
              className="hra-border-strong hra-bg-card hra-text-primary"
              value={restDayLabel} onChange={e => setRestDayLabel(e.target.value)}
              disabled={fieldDisabled} placeholder={t("manage.planInstances.restDayLabelPlaceholder", "e.g. Easy jog")}
              style={{ width: "100%", padding: "0 10px" }}
            />
          </Field>
        </div>
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 4 }}>
          {t("manage.planInstances.timingLinkHint", "🔗 Start date and Days before race are linked once Race date is set — editing either recomputes the other.")}
        </div>
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
          {t("manage.planInstances.restDayLabelHint", "Any day 1-7 the template doesn't declare for a week is auto-filled as a REST day carrying this label as its note.")}
        </div>
        {showWeek1AnchorWarning && (
          <div className="hra-text-warning" style={{ fontSize: 11, marginBottom: 16 }}>
            {t("manage.planInstances.week1AnchorWarning", "Start date doesn't land the plan's implied Monday on an actual Monday — the plan will still be created, but check your dates.")}
          </div>
        )}

        {/* Row 3 — pace: Race pace anchor + Pace input mode + Goal time all on
            one line (HRA-137 Ask #1). */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24, marginBottom: 6 }}>
          <Field label={t("manage.planInstances.racePaceAnchorLabel", "Race pace anchor")}>
            <div className="hra-segment">
              {[NONE_ANCHOR, ...templateAnchors].map(a => (
                <button key={a} className="hra-segment-item" data-active={racePaceAnchor === a} disabled={fieldDisabled} onClick={() => onRacePaceAnchorChange(a)}>
                  {a === NONE_ANCHOR ? t("manage.planInstances.racePaceAnchorNone", "None") : a}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("manage.planInstances.paceLabel", "Pace input")}>
            <div className="hra-segment">
              <button className="hra-segment-item" data-active={paceMode === "goalTime"} disabled={fieldDisabled || !hasRacePaceAnchor} onClick={() => setPaceMode("goalTime")}>{t("manage.planInstances.goalTimeMode", "Goal time")}</button>
              <button className="hra-segment-item" data-active={paceMode === "anchor"} disabled={fieldDisabled} onClick={() => setPaceMode("anchor")}>{t("manage.planInstances.anchorMode", "Anchor override")}</button>
            </div>
          </Field>
          <Field label={t("manage.planInstances.goalTimeLabel", "Goal time")}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="hra-border-strong hra-bg-card hra-text-primary"
                value={goalTimeDisplayValue}
                onChange={e => { if (paceMode === "goalTime") setGoalTimeDigits(sanitizeGoalTimeInput(e.target.value)); }}
                disabled={fieldDisabled || paceMode !== "goalTime"}
                inputMode="numeric" maxLength={8} style={{ width: 90 }}
                placeholder={t("manage.planInstances.goalTimePlaceholder", "HH:MM:SS")}
                aria-label={t("manage.planInstances.goalTimeAria", "Goal time (HH:MM:SS)")}
              />
              {paceMode === "anchor" && equivalentGoalTimeSec != null && (
                <span className="hra-anchor-tag">{t("manage.planInstances.goalTimeFromAnchor", "(from {{anchor}}'s pace)", { anchor: racePaceAnchor })}</span>
              )}
            </div>
          </Field>
        </div>
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 14 }}>
          {t("manage.planInstances.paceModeHint", "Goal time is only selectable while a race pace anchor is chosen — \"None\" forces Anchor override.")}
        </div>

        {hasRacePaceAnchor && paceMode === "goalTime" && showDistanceOverride && (
          <div style={{ marginBottom: 16 }}>
            <Field label={t("manage.planInstances.distanceLabel", "Distance (m) — optional override, defaults to the template's own distance")}>
              <input className="hra-border-strong hra-bg-card hra-text-primary" value={distanceM} onChange={e => setDistanceM(e.target.value)} disabled={fieldDisabled} type="number" style={{ width: 200, padding: "0 10px" }} placeholder={t("manage.planInstances.distancePlaceholder", "e.g. 21097")} />
            </Field>
          </div>
        )}
        {hasRacePaceAnchor && paceMode === "anchor" && (
          <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
            {t("manage.planInstances.anchorModeHint", "Set {{anchor}}'s pace directly in its row in the table below.", { anchor: racePaceAnchor })}
          </div>
        )}

        <PlanInstanceAnchorTable
          templateAnchors={templateAnchors}
          anchorRows={anchorRows}
          resolution={resolution}
          racePaceAnchor={racePaceAnchor}
          paceMode={paceMode}
          derivedPaceSecPerKm={derivedPaceSecPerKm}
          fieldDisabled={fieldDisabled}
          unresolvedAnchors={unresolvedAnchors}
          formEnabled={formEnabled}
          setAnchorAbsolute={setAnchorAbsolute}
          setAnchorRelativeTo={setAnchorRelativeTo}
          setAnchorSign={setAnchorSign}
          setAnchorSeconds={setAnchorSeconds}
          clearAnchorRow={clearAnchorRow}
        />

        {!fieldsLocked && instantiateError && <ErrorBanner message={instantiateError} />}
        {fieldsLocked && editError && <ErrorBanner message={editError} />}

        <div className="hra-row-wrap" style={{ marginBottom: 12, alignItems: "center" }}>
          {!fieldsLocked ? (
            <button className="hra-btn" data-variant="green" onClick={onInstantiate} disabled={!canInstantiate || instantiateLoading}>
              {instantiateLoading ? t("common.saving", "Saving…") : t("manage.planInstances.createButton", "Create instance")}
            </button>
          ) : (
            <>
              <button className="hra-btn" data-variant="green" onClick={onSaveClick} disabled={saveLoading || sections.length === 0 || isApproved || !saveEnabled}>
                {saveLoading ? t("common.saving", "Saving…") : t("common.save", "Save")}
              </button>
              <button className="hra-btn" onClick={onApprove} disabled={approveLoading || editingId == null || isApproved}>
                {approveLoading ? t("manage.planTemplates.approving", "Approving…") : t("manage.planTemplates.approveButton", "Approve")}
              </button>
              {/* AC3/AC6: label + date picker + button as ONE real control — a
                  button-shaped div with the DatePicker nested INSIDE it
                  (compact/borderless, index.css's .hra-regenerate-unit
                  override). A literal <button> can't contain the date
                  picker's own nested <button> (invalid HTML), so this is
                  role="button" on a <div>, with tabIndex/onKeyDown restoring
                  the click/keyboard-activate behavior a real button gives
                  for free, and data-disabled driving the same visual
                  language .hra-btn:disabled already has. The nested
                  DatePicker's own click is wrapped in a stopPropagation span
                  so opening the calendar doesn't also fire Regenerate. */}
              <div
                className="hra-btn hra-regenerate-unit" data-variant="green"
                role="button" tabIndex={regenerateDisabled ? -1 : 0}
                onClick={() => { if (!regenerateDisabled) onRegenerateClick(); }}
                onKeyDown={e => { if (!regenerateDisabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRegenerateClick(); } }}
                data-disabled={regenerateDisabled || undefined}
                aria-disabled={regenerateDisabled}
                title={!isApproved && !regenerateBucketDirty ? t("manage.planInstances.regenerateDisabledHint", "Change start date or a pace anchor first.") : undefined}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span>{regenerateLoading ? t("common.saving", "Saving…") : t("manage.planInstances.regenerateFromLabel", "Regenerate from")}</span>
                <span onClick={e => e.stopPropagation()} style={{ display: "inline-flex" }}>
                  <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} min={minEffectiveFrom} disabled={regenerateDisabled} />
                </span>
              </div>
            </>
          )}
          {/* HRA-159: "Restore" renames to "Reset to previous values" here —
              a dedicated key, not a change to the shared common.restore
              key PlanTemplatesSection.tsx also uses, since this Story's ask
              is scoped to the instance card only. */}
          <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => onRestoreClick(isDirty)}>
            {t("manage.planInstances.resetButton", "Reset to previous values")}
          </button>
          {/* HRA-157: List/Agenda switch relocated here from its own row
              above the accordion/calendar — right-aligned via marginLeft:
              auto in this flex row, while the buttons above stay
              left-aligned. Only shown once there's something to switch
              between, same gating the old location used. */}
          {sections.length > 0 && (
            <div className="hra-segment" style={{ marginLeft: "auto" }}>
              <button className="hra-segment-item" data-active={viewMode === "list"} onClick={() => setViewMode("list")}>
                {t("manage.planInstances.viewList", "List")}
              </button>
              <button className="hra-segment-item" data-active={viewMode === "agenda"} onClick={() => setViewMode("agenda")}>
                {t("manage.planInstances.viewAgenda", "Agenda")}
              </button>
            </div>
          )}
        </div>

        <ConfirmModal
          open={pendingNameChangeConfirm}
          title={
            <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 16 }}>
              {t("manage.planInstances.renameConfirmBody", "This will rename the current plan — it won't create a copy. Continue?")}
            </div>
          }
          confirmLabel={t("manage.planInstances.renameConfirmButton", "Rename")}
          variant="green"
          onConfirm={confirmNameChange}
          onCancel={cancelNameChange}
        />

        <ConfirmModal
          open={pendingTemplateId != null}
          title={
            <>
              <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                {t("manage.planInstances.switchTemplateTitle", "Discard current instance data?")}
              </div>
              <div className="hra-text-secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>
                {t("manage.planInstances.switchTemplateBody", "This instance hasn't been created yet. Picking a different template will lose the name, dates, and pace values you've already entered.")}
              </div>
            </>
          }
          confirmLabel={t("manage.planInstances.switchTemplateConfirm", "Switch template")}
          variant="danger"
          onConfirm={confirmSwitchTemplate}
          onCancel={cancelSwitchTemplate}
        />

        <ConfirmModal
          open={pendingRegenerateCount != null}
          title={
            <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, lineHeight: 1.5 }}>
              {t("manage.planInstances.regenerateConfirmTitle", `Regenerating will discard ${pendingRegenerateCount ?? 0} manual edit(s) — continue?`, { count: pendingRegenerateCount ?? 0 })}
            </div>
          }
          confirmLabel={t("manage.planInstances.regenerateConfirmButton", "Regenerate")}
          variant="danger"
          maxWidth={400}
          onConfirm={doRegenerate}
          onCancel={cancelRegenerate}
        />

        <ConfirmModal
          open={pendingRestoreConfirm}
          title={
            <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 16 }}>
              {t("manage.planInstances.restoreConfirmBody", "You have unsaved changes — reset them to the previous values?")}
            </div>
          }
          confirmLabel={t("manage.planInstances.resetButton", "Reset to previous values")}
          variant="danger"
          onConfirm={doRestore}
          onCancel={cancelRestoreConfirm}
        />

        {/* HRA-158: the picker-based day/week swap block (Select dropdowns + Swap
            buttons) is hidden — superseded by drag-and-drop swap in both List
            (TrainingPlanAccordion's useDragSwap) and Agenda (PlanInstanceCalendar's
            DayCellEvent drag handling). The underlying swap logic below (state,
            swapDaysByRef/swapWeeksByRef, onSwapDays/onSwapWeeks) is kept — drag-and-drop
            still calls into it. */}

        {sections.length > 0 && (
          <>
            {/* HRA-157: the List/Agenda switch's old spot now holds the
                always-visible workout-type legend instead — rendered once,
                outside the viewMode branch below, so it stays mounted
                (same node, same content) across List/Agenda toggling rather
                than remounting. */}
            <div style={{ marginBottom: 12 }}>
              <CategoryLegend />
            </div>
            {viewMode === "list" ? (
              <TrainingPlanAccordion
                ownerName={instName || t("manage.planTemplates.untitled", "Untitled plan")}
                sections={sections}
                onSectionEdit={() => {}}
                onWeekEdit={() => {}}
                onDayEdit={onDayEdit}
                readOnlySectionWeek
                readOnlyDays={isApproved}
                onDaySwap={onDayDragSwap}
                onWeekSwap={onWeekDragSwap}
                onScheduledTimeEdit={onScheduledTimeEdit}
                onWorkoutTypeEdit={onWorkoutTypeEdit}
                isDayDirty={day => day.date != null && persistedDsl[day.date] !== undefined && persistedDsl[day.date] !== day.dsl}
              />
            ) : (
              <PlanInstanceCalendar
                sections={sections} readOnlyDays={isApproved}
                onScheduledTimeEdit={onScheduledTimeEditByDayId} onDaySwap={onDayDragSwapByDayId}
              />
            )}
          </>
        )}

        {pendingWorkoutTypeChange != null && (() => {
          const { sectionIndex, weekIndex, dayIndex, workoutType } = pendingWorkoutTypeChange;
          const day = sections[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
          const currentText = day ? day.dsl.replace(DAY_PREFIX_RE, "") : "";
          const dateLabel = day?.date ? instanceDayDateLabel(day.date) : "";
          const typeLabel = workoutType === "rest"
            ? t("runplan.accordion.workoutTypeRest", "Rest")
            : workoutType === "other"
              ? t("runplan.accordion.workoutTypeOther", "Other")
              : t("runplan.accordion.workoutTypeRun", "Run");
          const title = workoutType === "run"
            ? t("manage.planInstances.workoutTypeConfirmClearTitle", `Clear ${dateLabel}'s workout text ("${currentText}") so you can enter a new run?`, { date: dateLabel, body: currentText })
            : t("manage.planInstances.workoutTypeConfirmSetTitle", `Set ${dateLabel} to ${typeLabel}? This replaces the current workout text ("${currentText}").`, { date: dateLabel, type: typeLabel, body: currentText });
          return (
            <ConfirmModal
              open
              title={
                <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, lineHeight: 1.5 }}>
                  {title}
                </div>
              }
              confirmLabel={t("common.confirm", "Confirm")}
              maxWidth={420}
              onConfirm={confirmWorkoutTypeChange}
              onCancel={cancelWorkoutTypeChange}
            />
          );
        })()}

        {pendingDaySwap != null && (() => {
          const dayA = dayByRef(pendingDaySwap.a);
          const dayB = dayByRef(pendingDaySwap.b);
          const labelFor = (d: DayView) => `${instanceDayDateLabel(d.date!)} (${d.dsl.replace(DAY_PREFIX_RE, "")})`;
          const bodyText = dayA && dayB ? `${labelFor(dayA)} with ${labelFor(dayB)}` : "";
          return (
            <ConfirmModal
              open
              title={
                <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, lineHeight: 1.5 }}>
                  {t("manage.planInstances.daySwapConfirmTitle", `Swap ${bodyText}?`, { body: bodyText })}
                </div>
              }
              confirmLabel={t("manage.planInstances.swapConfirmButton", "Swap")}
              maxWidth={420}
              onConfirm={confirmDaySwap}
              onCancel={cancelDaySwap}
            />
          );
        })()}

        {pendingWeekSwap != null && (() => {
          const weekA = weekByRef(pendingWeekSwap.a);
          const weekB = weekByRef(pendingWeekSwap.b);
          const rangeA = weekA ? weekDateRange(weekA) : null;
          const rangeB = weekB ? weekDateRange(weekB) : null;
          const bodyText = rangeA && rangeB
            ? `week ${instanceDayDateLabel(rangeA.start)} → ${instanceDayDateLabel(rangeA.end)} with week ${instanceDayDateLabel(rangeB.start)} → ${instanceDayDateLabel(rangeB.end)}`
            : "";
          return (
            <ConfirmModal
              open
              title={
                <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, lineHeight: 1.5 }}>
                  {t("manage.planInstances.weekSwapConfirmTitle", `Swap ${bodyText}?`, { body: bodyText })}
                </div>
              }
              confirmLabel={t("manage.planInstances.swapConfirmButton", "Swap")}
              maxWidth={420}
              onConfirm={confirmWeekSwap}
              onCancel={cancelWeekSwap}
            />
          );
        })()}
      </>
    );
  }

  const newDraftPending = activeKey === "new" || drafts["new"] != null;

  return (
    <Card className="hra-instantiate-form">
      <div className="hra-block-title" style={{ marginBottom: 4 }}>{t("manage.planInstances.title", "Training-plan instances")}</div>
      <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        {t("manage.planInstances.description", "A concrete instantiation of a template for one race — resolved paces, a start date, and (optionally) a linked race activity.")}
      </div>
      {listError && <ErrorBanner message={listError} />}

      {instances === null ? (
        <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.planInstances.loading", "Loading…")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {newDraftPending && (
            <AccordionCard
              title={
                <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  <span>{instName || t("manage.planInstances.instantiateTitle", "New instance")}</span>
                  {activeKey !== "new" && rowStatusHint("new")}
                </span>
              }
              expanded={activeKey === "new"}
              onToggle={() => onToggleRow("new", isDirty)}
            >
              {activeKey === "new" ? renderEditorFields() : null}
            </AccordionCard>
          )}
          {instances.length === 0 && !newDraftPending ? (
            <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.planInstances.empty", "No instances created yet.")}</div>
          ) : (
            instances.map(inst => (
              // HRA-141 (same pattern as PlanTemplatesSection/HRA-140's own
              // round-2 review fix): Delete is a real DOM SIBLING of the
              // AccordionCard, overlaid on its collapsed header via
              // position:absolute + z-index rather than living inside the
              // header <button> (invalid HTML) or as a separate column
              // beside the card. Works whether the row is expanded or
              // collapsed.
              <div key={inst.id} style={{ position: "relative" }}>
                <AccordionCard title={renderRowTitle(inst)} expanded={activeKey === inst.id} onToggle={() => onToggleRow(inst.id, isDirty)}>
                  {activeKey === inst.id ? renderEditorFields() : null}
                </AccordionCard>
                <button
                  className="hra-btn" data-variant="danger"
                  onClick={() => setDeleteConfirmId(inst.id)}
                  title={t("common.delete", "Delete")}
                  aria-label={t("common.delete", "Delete")}
                  style={{ position: "absolute", top: 15, right: 46, zIndex: 1, padding: "4px 8px", display: "inline-flex", alignItems: "center" }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
      {deleteError && <ErrorBanner message={deleteError} />}
      <button className="hra-btn" data-variant="accent" onClick={() => onToggleRow("new", isDirty)} disabled={newDraftPending || !templates || templates.length === 0}>
        {t("manage.planInstances.newInstance", "New instance")}
      </button>
      {templates && templates.length === 0 && (
        <div className="hra-text-muted" style={{ fontSize: 11, marginTop: 6 }}>{t("manage.planInstances.noTemplates", "Save a template first — an instance is always created from one.")}</div>
      )}

      {/* One shared confirm modal (not per-row) — deleteConfirmId already
          uniquely identifies the target, and only one can ever be pending
          at a time. */}
      <ConfirmModal
        open={deleteConfirmId != null}
        title={
          <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 16 }}>
            {t("manage.planInstances.deleteConfirm", "Delete this instance?")}
          </div>
        }
        confirmLabel={t("common.yesDelete", "Yes, delete")}
        variant="danger"
        onConfirm={() => deleteConfirmId != null && onDelete(deleteConfirmId)}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </Card>
  );
}
