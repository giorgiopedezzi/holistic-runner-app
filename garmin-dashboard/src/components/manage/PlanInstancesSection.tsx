/**
 * PlanInstancesSection.tsx (HRA-118, redesigned HRA-121)
 * Data & Sync card: instantiate/edit/approve/delete plan instances, on top
 * of the shared accordion (HRA-116) and the plan-instances backend (HRA-112
 * through HRA-115, HRA-118's own list route, HRA-121's redesign). Structural
 * sibling of PlanTemplatesSection (HRA-117), but simpler at save time: each
 * day PUTs its own {section_name, week_number, date, dsl} directly (HRA-115)
 * — there's no whole-document dsl_source to content-anchor-patch here,
 * unlike the template card.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Card, ErrorBanner, Badge, DatePicker, Select } from "@/components/ui";
import { TrainingPlanAccordion, DAY_PREFIX_RE, type DayRef, type WeekRef } from "@/components/TrainingPlanAccordion";
import {
  collectPlanAnchors, groupResolvedDaysIntoSectionViews, reconstructDslFromResolvedDay,
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
// Goal time is entered as three small H/M/S number fields (each defaults to
// "0", never a free-text HH:MM:SS string) — this combines them into total
// seconds, or null while any field isn't a valid non-negative number.
function goalTimeToSec(h: string, m: string, s: string): number | null {
  const hn = Number(h), mn = Number(m), sn = Number(s);
  if (![hn, mn, sn].every(n => Number.isFinite(n) && n >= 0)) return null;
  return hn * 3600 + mn * 60 + sn;
}
function pad2(n: string): string {
  return String(Math.max(0, Number(n) || 0)).padStart(2, "0");
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
interface AnchorRowState { absoluteValue: string; relativeTo: string; sign: "+" | "-"; seconds: string }
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

interface Props {
  // Lifted to ManageTab (not fetched here) — a template saved in the
  // sibling PlanTemplatesSection card must show up in this card's own
  // picker/list immediately, including enabling "New instance" the moment
  // the very first template exists.
  templates: PlanTemplate[] | null;
}

export function PlanInstancesSection({ templates }: Props) {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<PlanInstance[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // HRA-133: "instantiate" and "editor" used to be two structurally separate
  // screens — merged into one "plan" mode (see the unified render below),
  // so any field beyond day dsl/notes (start date, pace policy) has one
  // shared UI surface whether the instance is fresh or already exists. This
  // Story is a pure UI/state restructuring — no new editable capability
  // (that's the follow-up HRA-134): once an instance exists (editingId set,
  // `fieldsLocked` below), the shared top fields render populated but
  // disabled, same as before this Story they simply didn't exist in editor
  // mode at all.
  const [mode, setMode] = useState<"list" | "plan">("list");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
  // designated anchor). Goal time is three small H/M/S fields, not one
  // free-text string — each defaults to "0".
  const [racePaceAnchor, setRacePaceAnchor] = useState(NONE_ANCHOR);
  const [paceMode, setPaceMode] = useState<"anchor" | "goalTime">("anchor");
  const [goalH, setGoalH] = useState("0");
  const [goalM, setGoalM] = useState("0");
  const [goalS, setGoalS] = useState("0");
  const [distanceM, setDistanceM] = useState("");
  // One row per template anchor (HRA-121: a table, not add/remove rows) —
  // keyed by anchor name, synced whenever the template changes.
  const [anchorRows, setAnchorRows] = useState<Record<string, AnchorRowState>>({});
  // Set while a template switch is pending confirmation (HRA-121: switching
  // templates after real data has been entered warns before discarding it).
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const [instantiateLoading, setInstantiateLoading] = useState(false);
  const [instantiateError, setInstantiateError] = useState<string | null>(null);

  // Set once an instance exists (freshly created this session, or loaded via
  // startEdit) — governs `fieldsLocked` below. `instName` above now doubles
  // as this instance's name field (HRA-133).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [sections, setSections] = useState<SectionView[]>([]);
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
  // persisted pace_overrides JSON (a resolved PaceValue, not the same shape
  // as the UI's own absolute/relative row state — see startEdit's
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
  const [baselineGoalH, setBaselineGoalH] = useState("0");
  const [baselineGoalM, setBaselineGoalM] = useState("0");
  const [baselineGoalS, setBaselineGoalS] = useState("0");
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
  // server-side (never trusted from the client alone, HRA-132).
  const [effectiveFrom, setEffectiveFrom] = useState(isoToday());
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
    setGoalH("0"); setGoalM("0"); setGoalS("0"); setDistanceM(""); setAnchorRows({});
    setPendingTemplateId(null);
    setInstantiateError(null);
    setBaselineStartDate(""); setBaselineAnchorRows({});
    setBaselineRacePaceAnchor(NONE_ANCHOR); setBaselinePaceMode("anchor");
    setBaselineGoalH("0"); setBaselineGoalM("0"); setBaselineGoalS("0"); setBaselineDistanceM("");
    setBaselineInstName(""); setBaselineRaceName(""); setBaselineRaceDate(""); setBaselineRaceUrl("");
    setSaveForcedEnabled(false); setPendingNameChangeConfirm(false);
    setEffectiveFrom(isoToday()); setPendingRegenerateCount(null);
  }

  function resetEditor() {
    setEditingId(null); setSections([]); setEditError(null); setEditApprovedAt(null);
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
  // together. Used whenever leaving the screen entirely (Cancel, back to
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
    setGoalH("0"); setGoalM("0"); setGoalS("0"); setDistanceM("");
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
    if (goalH !== "0" || goalM !== "0" || goalS !== "0" || distanceM.trim() !== "") return true;
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
      // instance's own values, per the unified screen shape.
      setEditingId(created.id);
      setInstName(created.name ?? "");
      // HRA-134/HRA-136: current field values already equal exactly what was
      // just submitted — that's the new baseline, so both dirty buckets
      // start clean for a just-created instance.
      setBaselineStartDate(startDate);
      setBaselineAnchorRows(anchorRows);
      setBaselineRacePaceAnchor(racePaceAnchor);
      setBaselinePaceMode(paceMode);
      setBaselineGoalH(goalH); setBaselineGoalM(goalM); setBaselineGoalS(goalS); setBaselineDistanceM(distanceM);
      setBaselineInstName(created.name ?? "");
      setBaselineRaceName(raceName); setBaselineRaceDate(raceDate); setBaselineRaceUrl(raceUrl);
      setSaveForcedEnabled(false);
      const days: ResolvedDay[] = created.days.map(d => ({
        section_name: d.section_name, week_number: d.week_number, date: d.date, day: d.day,
        suffix: d.suffix ?? undefined, category: d.category ?? undefined, workout_type: d.workout_type as WorkoutType,
        segments: JSON.parse(d.segments), activity_target: d.activity_target ? JSON.parse(d.activity_target) : undefined,
        activity_description: d.activity_description ?? undefined, notes: d.notes ?? undefined, needs_review: d.needs_review === 1,
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
  // at resetPlanScreen()'s defaults. Populating alone doesn't make them
  // editable — `fieldsLocked` (below) disables every one of them; that's
  // this Story's own explicit scope boundary, left to HRA-134.
  async function startEdit(instance: PlanInstance) {
    resetPlanScreen();
    setEditingId(instance.id);
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
    setMode("plan");
    try {
      const full = await api.planInstances.getById(instance.id);
      const days: ResolvedDay[] = full.days.map(d => ({
        section_name: d.section_name, week_number: d.week_number, date: d.date, day: d.day,
        suffix: d.suffix ?? undefined, category: d.category ?? undefined, workout_type: d.workout_type as WorkoutType,
        segments: JSON.parse(d.segments), activity_target: d.activity_target ? JSON.parse(d.activity_target) : undefined,
        activity_description: d.activity_description ?? undefined, notes: d.notes ?? undefined, needs_review: d.needs_review === 1,
      }));
      const built = sectionsFromDays(days);
      setSections(built);
      setPersistedDsl(snapshotDsl(built));
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("manage.planInstances.loadInstanceFailed", "Failed to load instance"));
    }
  }

  function onDayEdit(sectionIndex: number, weekIndex: number, dayIndex: number, patch: { dsl?: string; notes?: string }) {
    setSections(prev => {
      const sections = [...prev];
      const section = { ...sections[sectionIndex] };
      const weeks = [...section.weeks];
      const week = { ...weeks[weekIndex] };
      const days = [...week.days];
      const day = days[dayIndex];
      const newLine = recomposeDayLine(day.dsl, patch);
      days[dayIndex] = { ...day, dsl: newLine, notes: splitNote(newLine).note };
      week.days = days; weeks[weekIndex] = week; section.weeks = weeks; sections[sectionIndex] = section;
      return sections;
    });
  }

  // HRA-127: day/week swap — flat, cross-week/cross-section pickable lists
  // for the two "swap with…" selectors below. A day's calendar date never
  // moves (only content exchanges), so date isn't part of the label — the
  // D-line workout text itself is the useful cue for telling rows apart.
  function weekLabel(weekNumber: number): string {
    return t("manage.planInstances.swapWeekLabel", `Week ${weekNumber}`, { n: weekNumber });
  }
  function dayOptions(): { value: string; label: string }[] {
    const out: { value: string; label: string }[] = [];
    sections.forEach((s, si) => s.weeks.forEach((w, wi) => w.days.forEach((d, di) => {
      out.push({ value: `${si}-${wi}-${di}`, label: `${weekLabel(w.number)} — ${d.dsl}` });
    })));
    return out;
  }
  function weekOptions(): { value: string; label: string }[] {
    const out: { value: string; label: string }[] = [];
    sections.forEach((s, si) => s.weeks.forEach((w, wi) => out.push({ value: `${si}-${wi}`, label: weekLabel(w.number) })));
    return out;
  }

  // Core swap mutations, parameterized by explicit refs so both the picker
  // (Select) UI below AND the accordion's native drag-and-drop (HRA-127
  // follow-up — TrainingPlanAccordion's onDaySwap/onWeekSwap props) share
  // one implementation. Only mutates local `sections` state — persisted the
  // same way any other day edit already is, via the existing Save button.
  function swapDaysByRef(a: { sectionIndex: number; weekIndex: number; dayIndex: number }, b: { sectionIndex: number; weekIndex: number; dayIndex: number }) {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, weeks: s.weeks.map(w => ({ ...w, days: w.days.map(d => ({ ...d })) })) }));
      const dayA = next[a.sectionIndex].weeks[a.weekIndex].days[a.dayIndex];
      const dayB = next[b.sectionIndex].weeks[b.weekIndex].days[b.dayIndex];
      const [newA, newB] = swapDayContent(dayA.dsl, dayB.dsl);
      next[a.sectionIndex].weeks[a.weekIndex].days[a.dayIndex] = { ...dayA, dsl: newA, notes: splitNote(newA).note };
      next[b.sectionIndex].weeks[b.weekIndex].days[b.dayIndex] = { ...dayB, dsl: newB, notes: splitNote(newB).note };
      return next;
    });
  }

  // Matches days by their own D-number (not array position) so weeks with
  // different declared day-sets (a pre-HRA-124 partial week, or two weeks
  // whose sections diverge) still swap every day-number both sides actually
  // share — a day-number present in only one side is left untouched rather
  // than guessed at, same "don't guess" discipline swapDayContent itself uses.
  function swapWeeksByRef(a: { sectionIndex: number; weekIndex: number }, b: { sectionIndex: number; weekIndex: number }) {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, weeks: s.weeks.map(w => ({ ...w, days: w.days.map(d => ({ ...d })) })) }));
      const weekA = next[a.sectionIndex].weeks[a.weekIndex];
      const weekB = next[b.sectionIndex].weeks[b.weekIndex];
      for (const dayB of weekB.days) {
        const dayA = weekA.days.find(d => d.day === dayB.day);
        if (!dayA) continue;
        const [newA, newB] = swapDayContent(dayA.dsl, dayB.dsl);
        dayA.dsl = newA; dayA.notes = splitNote(newA).note;
        dayB.dsl = newB; dayB.notes = splitNote(newB).note;
      }
      return next;
    });
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

  // HRA-127 follow-up: drag-and-drop, as an alternative UX to the picker
  // above for the same underlying swap — TrainingPlanAccordion calls these
  // with both rows' refs once a valid drop completes (it already guards
  // against a drop onto the row's own self). HRA-131: stages the same
  // pending-confirm state the picker path uses, rather than swapping
  // immediately — one confirm modal covers both entry points.
  function onDayDragSwap(a: DayRef, b: DayRef) {
    setPendingDaySwap({ a, b });
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
      setBaselineGoalH(goalH); setBaselineGoalM(goalM); setBaselineGoalS(goalS); setBaselineDistanceM(distanceM);
      setSaveForcedEnabled(true);
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

  async function onDelete(id: number) {
    setDeleteError(null);
    try {
      await api.planInstances.remove(id);
      setDeleteConfirmId(null);
      if (editingId === id) { resetPlanScreen(); setMode("list"); }
      await refreshInstances();
      notify(t("manage.planInstances.deleteSucceeded", "Instance deleted."));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t("manage.planInstances.deleteFailed", "Failed to delete instance"));
    }
  }

  if (mode === "list") {
    return (
      <Card>
        <div className="hra-block-title" style={{ marginBottom: 4 }}>{t("manage.planInstances.title", "Training-plan instances")}</div>
        <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          {t("manage.planInstances.description", "A concrete instantiation of a template for one race — resolved paces, a start date, and (optionally) a linked race activity.")}
        </div>
        {listError && <ErrorBanner message={listError} />}
        {instances === null ? (
          <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.planInstances.loading", "Loading…")}</div>
        ) : instances.length === 0 ? (
          <div className="hra-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>{t("manage.planInstances.empty", "No instances created yet.")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {instances.map(inst => (
              <div key={inst.id} className="hra-border-strong" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8 }}>
                <span className="hra-text-primary" style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{inst.name ?? t("manage.planInstances.untitled", "Untitled instance")}</span>
                {inst.event && <span className="hra-text-muted" style={{ fontSize: 11 }}>{t(`manage.planTemplates.event.${inst.event}`, inst.event)}</span>}
                <span className="hra-text-muted" style={{ fontSize: 11 }}>{inst.start_date}</span>
                <Badge
                  label={inst.approved_at ? t("manage.planInstances.approved", "Approved") : t("manage.planInstances.notApproved", "Not approved")}
                  color={inst.approved_at ? "var(--accent-green)" : "var(--text-muted)"}
                />
                <button className="hra-btn" onClick={() => startEdit(inst)}>{t("common.edit", "Edit")}</button>
                {deleteConfirmId === inst.id ? (
                  <>
                    <span className="hra-text-danger" style={{ fontSize: 12 }}>{t("manage.planInstances.deleteConfirm", "Delete this instance?")}</span>
                    <button className="hra-btn" data-variant="danger" onClick={() => onDelete(inst.id)}>{t("common.yesDelete", "Yes, delete")}</button>
                    <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => setDeleteConfirmId(null)}>{t("common.cancel", "Cancel")}</button>
                  </>
                ) : (
                  <button className="hra-btn" data-variant="danger" onClick={() => setDeleteConfirmId(inst.id)}>{t("common.delete", "Delete")}</button>
                )}
              </div>
            ))}
          </div>
        )}
        {deleteError && <ErrorBanner message={deleteError} />}
        <button className="hra-btn" data-variant="accent" onClick={() => { resetPlanScreen(); setMode("plan"); }} disabled={!templates || templates.length === 0}>
          {t("manage.planInstances.newInstance", "New instance")}
        </button>
        {templates && templates.length === 0 && (
          <div className="hra-text-muted" style={{ fontSize: 11, marginTop: 6 }}>{t("manage.planInstances.noTemplates", "Save a template first — an instance is always created from one.")}</div>
        )}
      </Card>
    );
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
  const goalTimeFieldsChanged = paceMode === "goalTime" && (goalH !== baselineGoalH || goalM !== baselineGoalM || goalS !== baselineGoalS || distanceM !== baselineDistanceM);
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

  return (
    <Card className="hra-instantiate-form">
      <div className="hra-row-wrap" style={{ alignItems: "center", marginBottom: 12 }}>
        <div className="hra-block-title">
          {fieldsLocked ? t("manage.planInstances.editTitle", "Edit instance") : t("manage.planInstances.instantiateTitle", "New instance")}
        </div>
        {fieldsLocked && (
          <Badge
            label={isApproved ? t("manage.planInstances.approved", "Approved") : t("manage.planInstances.notApproved", "Not approved")}
            color={isApproved ? "var(--accent-green)" : "var(--text-muted)"}
          />
        )}
      </div>

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
      {/* HRA-130/HRA-133: the fresh-form check (week1AnchorMismatch, live
          templateId/startDate) and the loaded-instance check
          (editWeek1AnchorMismatch, real persisted day dates) now both apply
          to the same unified screen — either firing is enough to warn. */}
      {showWeek1AnchorWarning && (
        <div className="hra-text-warning" style={{ fontSize: 11, marginBottom: 16 }}>
          {t("manage.planInstances.week1AnchorWarning", "Start date doesn't land the plan's implied Monday on an actual Monday — the plan will still be created, but check your dates.")}
        </div>
      )}

      {/* Row 3 — pace: Race pace anchor + Pace input mode on one line. */}
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
      </div>
      <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 14 }}>
        {t("manage.planInstances.paceModeHint", "Goal time is only selectable while a race pace anchor is chosen — \"None\" forces Anchor override.")}
      </div>

      {hasRacePaceAnchor && paceMode === "goalTime" && (
        <div style={{ display: "grid", gridTemplateColumns: showDistanceOverride ? "auto 200px" : "auto", gap: 10, marginBottom: 16 }}>
          <Field label={t("manage.planInstances.goalTimeLabel", "Goal time")}>
            <div className="hra-goal-time-fields">
              <input className="hra-border-strong hra-bg-card hra-text-primary" value={goalH} onChange={e => setGoalH(e.target.value)} disabled={fieldDisabled} type="number" min={0} aria-label={t("manage.planInstances.goalTimeHoursAria", "Hours")} />
              <span className="hra-goal-time-unit">{t("manage.planInstances.goalTimeHoursUnit", "h")}</span>
              <input className="hra-border-strong hra-bg-card hra-text-primary" value={goalM} onChange={e => setGoalM(e.target.value)} disabled={fieldDisabled} type="number" min={0} max={59} aria-label={t("manage.planInstances.goalTimeMinutesAria", "Minutes")} />
              <span className="hra-goal-time-unit">{t("manage.planInstances.goalTimeMinutesUnit", "m")}</span>
              <input className="hra-border-strong hra-bg-card hra-text-primary" value={goalS} onChange={e => setGoalS(e.target.value)} disabled={fieldDisabled} type="number" min={0} max={59} aria-label={t("manage.planInstances.goalTimeSecondsAria", "Seconds")} />
              <span className="hra-goal-time-unit">{t("manage.planInstances.goalTimeSecondsUnit", "s")}</span>
            </div>
          </Field>
          {showDistanceOverride && (
            <Field label={t("manage.planInstances.distanceLabel", "Distance (m) — optional override, defaults to the template's own distance")}>
              <input className="hra-border-strong hra-bg-card hra-text-primary" value={distanceM} onChange={e => setDistanceM(e.target.value)} disabled={fieldDisabled} type="number" style={{ width: "100%", padding: "0 10px" }} placeholder={t("manage.planInstances.distancePlaceholder", "e.g. 21097")} />
            </Field>
          )}
        </div>
      )}
      {hasRacePaceAnchor && paceMode === "anchor" && (
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
          {t("manage.planInstances.anchorModeHint", "Set {{anchor}}'s pace directly in its row in the table below.", { anchor: racePaceAnchor })}
        </div>
      )}

      {/* Anchor table (HRA-121) — replaces the earlier separate Race
          policy + Resolution sections: one row per template anchor,
          Absolute/Relative as two grouped column sets, Resolved/
          Unresolved as the last column. HRA-133: for a loaded instance,
          rows are populated from pace_overrides (startEdit's
          paceValueToAnchorRow) — still just a display, not yet editable. */}
      {templateAnchors.length === 0 ? (
        <div className="hra-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          {formEnabled
            ? t("manage.planInstances.resolutionEmpty", "This template references no symbolic pace anchors — nothing to resolve.")
            : t("manage.planInstances.resolutionNoTemplate", "Pick a template above to see its pace anchors.")}
        </div>
      ) : (
        <div className="hra-anchor-table-wrap" style={{ marginBottom: 8 }}>
          <table className="hra-anchor-table">
            <thead>
              <tr>
                <th rowSpan={2} style={{ verticalAlign: "bottom" }}>{t("manage.planInstances.colAnchor", "Anchor")}</th>
                <th className="hra-anchor-group hra-anchor-group-start">{t("manage.planInstances.colAbsolute", "Absolute")}</th>
                <th className="hra-anchor-group" colSpan={3}>{t("manage.planInstances.colRelative", "Relative")}</th>
                <th rowSpan={2} style={{ verticalAlign: "bottom" }}></th>
                <th rowSpan={2} style={{ verticalAlign: "bottom" }}>{t("manage.planInstances.colStatus", "Status")}</th>
              </tr>
              <tr className="hra-anchor-sub">
                <th className="hra-anchor-group-start">{t("manage.planInstances.colPace", "Pace")}</th>
                <th className="hra-anchor-group-start">{t("manage.planInstances.policyRelativeToLabel", "Relative to")}</th>
                <th>{t("manage.planInstances.colSign", "±")}</th>
                <th>{t("manage.planInstances.policySecondsLabel", "Seconds")}</th>
              </tr>
            </thead>
            <tbody>
              {templateAnchors.map(anchor => {
                const derived = hasRacePaceAnchor && paceMode === "goalTime" && anchor === racePaceAnchor;
                const row = anchorRows[anchor] ?? emptyAnchorRow();
                const relativeDisabled = derived || fieldDisabled || row.absoluteValue.trim() !== "";
                const absoluteDisabled = derived || fieldDisabled || row.relativeTo !== "" || row.seconds.trim() !== "";
                const resolved = resolution.find(r => r.anchor === anchor)?.secPerKm ?? null;
                return (
                  <tr key={anchor}>
                    <td className="hra-anchor-name">
                      {anchor}
                      {anchor === racePaceAnchor && (
                        <span className="hra-anchor-tag">{t("manage.planInstances.racePaceTag", "(race pace)")}</span>
                      )}
                    </td>
                    <td className="hra-anchor-group-start">
                      {derived ? (
                        derivedPaceSecPerKm != null ? (
                          <>
                            {formatPaceSecPerKm(derivedPaceSecPerKm)}
                            <span className="hra-anchor-tag">{t("manage.planInstances.derivedFromGoalTime", "(from goal time)")}</span>
                          </>
                        ) : (
                          <span className="hra-anchor-derived">—</span>
                        )
                      ) : (
                        <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={row.absoluteValue} onChange={e => setAnchorAbsolute(anchor, e.target.value)} disabled={absoluteDisabled} placeholder={t("manage.planInstances.anchorAbsolutePlaceholder", "e.g. 5:10/km")} style={{ width: "100%", padding: "0 8px" }} />
                      )}
                    </td>
                    <td className="hra-anchor-group-start">
                      <Select
                        value={row.relativeTo} onValueChange={v => setAnchorRelativeTo(anchor, v)}
                        options={templateAnchors.filter(a => a !== anchor).map(a => ({ value: a, label: a }))}
                        placeholder="—"
                        triggerStyle={{ width: "100%" }}
                        disabled={fieldDisabled}
                      />
                    </td>
                    <td>
                      <div className="hra-segment">
                        <button className="hra-segment-item" data-active={row.sign === "+"} disabled={relativeDisabled} onClick={() => setAnchorSign(anchor, "+")}>+</button>
                        <button className="hra-segment-item" data-active={row.sign === "-"} disabled={relativeDisabled} onClick={() => setAnchorSign(anchor, "-")}>−</button>
                      </div>
                    </td>
                    <td>
                      <input className="hra-border-strong hra-bg-card hra-text-primary" value={row.seconds} onChange={e => setAnchorSeconds(anchor, e.target.value)} disabled={relativeDisabled} type="number" placeholder="—" style={{ width: "100%", padding: "0 8px" }} />
                    </td>
                    <td>
                      <button
                        className="hra-border-strong hra-text-secondary"
                        style={{ background: "none", borderRadius: 5, padding: "5px 10px", fontSize: 11, cursor: "pointer" }}
                        disabled={derived || fieldDisabled || anchorRowIsEmpty(row)}
                        onClick={() => clearAnchorRow(anchor)}
                      >
                        {t("manage.planInstances.clearButton", "Clear")}
                      </button>
                    </td>
                    <td>
                      <Badge
                        label={resolved != null ? t("manage.planInstances.resolutionResolved", "Resolved") : t("manage.planInstances.resolutionUnresolved", "Unresolved")}
                        color={resolved != null ? "var(--accent-green)" : "var(--accent-red)"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 14 }}>
        {t("manage.planInstances.tableFillHint", "Fill exactly one of Absolute or Relative per row — the other disables once you start typing.")}
      </div>

      <div style={{ fontSize: 11, color: unresolvedAnchors.length > 0 ? "var(--accent-red)" : "var(--text-muted)", marginBottom: 14 }}>
        {unresolvedAnchors.length > 0
          ? t("manage.planInstances.resolutionBlockedHint", "{{anchors}} still unresolved — fill in Absolute or Relative for it above before you can create the instance.", { anchors: unresolvedAnchors.join(", ") })
          : t("manage.planInstances.resolutionReadyHint", "Every anchor resolves — Create instance is ready.")}
      </div>

      {!fieldsLocked && instantiateError && <ErrorBanner message={instantiateError} />}
      {fieldsLocked && editError && <ErrorBanner message={editError} />}

      {/* HRA-136 AC6: Save · Approve · the Regenerate unit · Cancel now all
          render in this one row — Regenerate's own label+date picker+button
          used to be a separate block that appeared/disappeared above this
          row (moving everything below it, the "no moving UI" rule this repo
          otherwise enforces); it's now a fixed sub-group inside the row
          itself, always present once the instance exists, only ever
          DISABLED (not unmounted) until the Regenerate-bucket is actually
          dirty (AC3) — same "visible but inert" treatment Approve already
          gets once isApproved. */}
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
            {/* The label + date picker + button read as ONE unit (AC3) — unlike
                every other multi-control group in this row, this one must
                NOT wrap internally: `.hra-row-wrap`'s own flex-wrap would let
                the label drop onto its own line above the date picker the
                moment the row runs out of horizontal space, which is exactly
                the split the Story calls out against. `flexWrap: "nowrap"`
                overrides that; `flexShrink: 0` keeps the whole unit intact
                (as one block) rather than letting ITS OWN box get squeezed
                first when the outer row wraps. */}
            <div
              style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", flexShrink: 0 }}
              title={!isApproved && !regenerateBucketDirty ? t("manage.planInstances.regenerateDisabledHint", "Change start date or a pace anchor first.") : undefined}
            >
              <span className="hra-text-secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{t("manage.planInstances.regenerateFromLabel", "Regenerate from")}</span>
              <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} min={isoToday()} disabled={isApproved} />
              <button className="hra-btn" data-variant="green" onClick={onRegenerateClick} disabled={regenerateLoading || !regenerateBucketDirty || isApproved}>
                {regenerateLoading ? t("common.saving", "Saving…") : t("manage.planInstances.regenerateButton", "Regenerate")}
              </button>
            </div>
          </>
        )}
        <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => { resetPlanScreen(); setMode("list"); }}>
          {t("common.cancel", "Cancel")}
        </button>
      </div>

      {/* HRA-136 Ask #2: confirm before a Name change actually persists —
          gated on the Save click (see onSaveClick/pendingNameChangeConfirm's
          own comments above), same modal shape every other pending-then-
          confirm action in this file already uses. */}
      {pendingNameChangeConfirm && (
        <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={cancelNameChange}>
          <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth: 360, padding: 20 }} onClick={e => e.stopPropagation()}>
            <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 16 }}>
              {t("manage.planInstances.renameConfirmBody", "This will rename the current plan — it won't create a copy. Continue?")}
            </div>
            <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
              <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={cancelNameChange}>
                {t("common.cancel", "Cancel")}
              </button>
              <button className="hra-btn" data-variant="green" onClick={confirmNameChange}>
                {t("manage.planInstances.renameConfirmButton", "Rename")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingTemplateId != null && (
        <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={cancelSwitchTemplate}>
          <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth: 360, padding: 20 }} onClick={e => e.stopPropagation()}>
            <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              {t("manage.planInstances.switchTemplateTitle", "Discard current instance data?")}
            </div>
            <div className="hra-text-secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>
              {t("manage.planInstances.switchTemplateBody", "This instance hasn't been created yet. Picking a different template will lose the name, dates, and pace values you've already entered.")}
            </div>
            <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
              <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={cancelSwitchTemplate}>
                {t("common.cancel", "Cancel")}
              </button>
              <button className="hra-btn" data-variant="danger" onClick={confirmSwitchTemplate}>
                {t("manage.planInstances.switchTemplateConfirm", "Switch template")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HRA-134: confirm before a regenerate would discard manually-edited
          days on/after the cutover — same pending-then-confirm/cancel shape
          the swap/template-switch modals already use. */}
      {pendingRegenerateCount != null && (
        <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={cancelRegenerate}>
          <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth: 400, padding: 20 }} onClick={e => e.stopPropagation()}>
            <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, lineHeight: 1.5 }}>
              {t("manage.planInstances.regenerateConfirmTitle", `Regenerating will discard ${pendingRegenerateCount} manual edit(s) — continue?`, { count: pendingRegenerateCount })}
            </div>
            <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
              <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={cancelRegenerate}>
                {t("common.cancel", "Cancel")}
              </button>
              <button className="hra-btn" data-variant="danger" onClick={doRegenerate}>
                {t("manage.planInstances.regenerateConfirmButton", "Regenerate")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HRA-127: day/week swap — only available while unapproved (AC3), a
          per-picker "swap with…" selector (the interaction pattern was left
          open by the Story; multiple accordion rows can already be expanded
          at once today, so comparing both sides before swapping works
          out of the box with no further change here). Swap only mutates
          local `sections` state, persisted the same way any other day edit
          already is — via the existing Save button (AC4). */}
      {!isApproved && sections.length > 0 && (dayOptions().length >= 2 || weekOptions().length >= 2) && (
        <div className="hra-border-strong" style={{ borderRadius: 8, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {dayOptions().length >= 2 && (
            <Field label={t("manage.planInstances.swapDaysLabel", "Swap two days")}>
              <div className="hra-row-wrap" style={{ alignItems: "center" }}>
                <Select value={swapDayA} onValueChange={setSwapDayA} options={dayOptions()} placeholder={t("manage.planInstances.swapPickDayPlaceholder", "Pick a day…")} triggerStyle={{ width: 260 }} />
                <span className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.planInstances.swapWithLabel", "with")}</span>
                <Select value={swapDayB} onValueChange={setSwapDayB} options={dayOptions()} placeholder={t("manage.planInstances.swapPickDayPlaceholder", "Pick a day…")} triggerStyle={{ width: 260 }} />
                <button className="hra-btn" onClick={onSwapDays} disabled={!swapDayA || !swapDayB || swapDayA === swapDayB}>
                  {t("manage.planInstances.swapButton", "Swap")}
                </button>
              </div>
            </Field>
          )}
          {weekOptions().length >= 2 && (
            <Field label={t("manage.planInstances.swapWeeksLabel", "Swap two weeks")}>
              <div className="hra-row-wrap" style={{ alignItems: "center" }}>
                <Select value={swapWeekA} onValueChange={setSwapWeekA} options={weekOptions()} placeholder={t("manage.planInstances.swapPickWeekPlaceholder", "Pick a week…")} triggerStyle={{ width: 160 }} />
                <span className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.planInstances.swapWithLabel", "with")}</span>
                <Select value={swapWeekB} onValueChange={setSwapWeekB} options={weekOptions()} placeholder={t("manage.planInstances.swapPickWeekPlaceholder", "Pick a week…")} triggerStyle={{ width: 160 }} />
                <button className="hra-btn" onClick={onSwapWeeks} disabled={!swapWeekA || !swapWeekB || swapWeekA === swapWeekB}>
                  {t("manage.planInstances.swapButton", "Swap")}
                </button>
              </div>
            </Field>
          )}
        </div>
      )}

      {sections.length > 0 && (
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
        />
      )}

      {/* HRA-131: confirm before either swap actually mutates `sections` —
          same modal shape as the template-switch confirm above, one modal
          shared by both entry points (picker Swap button + drag-and-drop). */}
      {pendingDaySwap != null && (() => {
        const dayA = dayByRef(pendingDaySwap.a);
        const dayB = dayByRef(pendingDaySwap.b);
        const labelFor = (d: DayView) => `${instanceDayDateLabel(d.date!)} (${d.dsl.replace(DAY_PREFIX_RE, "")})`;
        const bodyText = dayA && dayB ? `${labelFor(dayA)} with ${labelFor(dayB)}` : "";
        return (
          <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={cancelDaySwap}>
            <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth: 420, padding: 20 }} onClick={e => e.stopPropagation()}>
              <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, lineHeight: 1.5 }}>
                {t("manage.planInstances.daySwapConfirmTitle", `Swap ${bodyText}?`, { body: bodyText })}
              </div>
              <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
                <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={cancelDaySwap}>
                  {t("common.cancel", "Cancel")}
                </button>
                <button className="hra-btn" onClick={confirmDaySwap}>
                  {t("manage.planInstances.swapConfirmButton", "Swap")}
                </button>
              </div>
            </div>
          </div>
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
          <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={cancelWeekSwap}>
            <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth: 420, padding: 20 }} onClick={e => e.stopPropagation()}>
              <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, lineHeight: 1.5 }}>
                {t("manage.planInstances.weekSwapConfirmTitle", `Swap ${bodyText}?`, { body: bodyText })}
              </div>
              <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
                <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={cancelWeekSwap}>
                  {t("common.cancel", "Cancel")}
                </button>
                <button className="hra-btn" onClick={confirmWeekSwap}>
                  {t("manage.planInstances.swapConfirmButton", "Swap")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </Card>
  );
}
