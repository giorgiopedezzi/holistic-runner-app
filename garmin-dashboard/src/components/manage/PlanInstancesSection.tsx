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
import { TrainingPlanAccordion } from "@/components/TrainingPlanAccordion";
import {
  collectPlanAnchors, groupResolvedDaysIntoSectionViews, reconstructDslFromResolvedDay,
  resolveIntensityPaceSecPerKm, type SectionView,
} from "@/domain/runplan-aggregate";
import { recomposeDayLine, splitNote } from "@/domain/runplan-patch";
import { notify } from "@/utils/toast";
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

  const [mode, setMode] = useState<"list" | "instantiate" | "editor">("list");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // instantiate form — row 1 (identity). Link a race (HRA-121) is a plain
  // free-text URL, not a picker over existing activities — target_activity_id
  // stays a valid backend capability, just no longer surfaced by this form.
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

  // editor
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [sections, setSections] = useState<SectionView[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);

  function refreshInstances() {
    return api.planInstances.list().then(setInstances).catch(e => setListError(e instanceof Error ? e.message : t("manage.planInstances.loadFailed", "Failed to load instances")));
  }

  useEffect(() => { refreshInstances(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function resetInstantiateForm() {
    setTemplateId(""); setInstName(""); setRaceName(""); setRaceDate(""); setRaceUrl("");
    setStartDate(isoToday()); setDaysBeforeRace("");
    setRacePaceAnchor(NONE_ANCHOR); setPaceMode("anchor");
    setGoalH("0"); setGoalM("0"); setGoalS("0"); setDistanceM(""); setAnchorRows({});
    setPendingTemplateId(null);
    setInstantiateError(null);
  }

  function resetEditor() {
    setEditingId(null); setEditName(""); setSections([]); setEditError(null);
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

  // HRA-121: "non-default data" gating the template-switch warning — start
  // date at today counts as default (nothing was deliberately typed there).
  function hasEnteredData(): boolean {
    if (instName.trim() !== "" || raceName.trim() !== "" || raceDate !== "" || raceUrl.trim() !== "") return true;
    if (startDate !== isoToday()) return true;
    if (daysBeforeRace.trim() !== "") return true;
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

      await api.planTemplates.instantiate(Number(templateId), body);
      await refreshInstances();
      resetInstantiateForm();
      setMode("list");
      notify(t("manage.planInstances.instantiateSucceeded", "Instance created."));
    } catch (e) {
      setInstantiateError(e instanceof Error ? e.message : t("manage.planInstances.instantiateFailed", "Failed to create instance"));
    }
    setInstantiateLoading(false);
  }

  function sectionsFromDays(days: ResolvedDay[]) {
    return groupResolvedDaysIntoSectionViews(days.map(d => ({ ...d, dsl: reconstructDslFromResolvedDay(d) })));
  }

  async function startEdit(instance: PlanInstance) {
    resetEditor();
    setEditingId(instance.id);
    setEditName(instance.name ?? "");
    setMode("editor");
    try {
      const full = await api.planInstances.getById(instance.id);
      const days: ResolvedDay[] = full.days.map(d => ({
        section_name: d.section_name, week_number: d.week_number, date: d.date, day: d.day,
        suffix: d.suffix ?? undefined, category: d.category ?? undefined, workout_type: d.workout_type as WorkoutType,
        segments: JSON.parse(d.segments), activity_target: d.activity_target ? JSON.parse(d.activity_target) : undefined,
        activity_description: d.activity_description ?? undefined, notes: d.notes ?? undefined, needs_review: d.needs_review === 1,
      }));
      setSections(sectionsFromDays(days));
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

  async function onSave() {
    if (editingId == null) return;
    setSaveLoading(true); setEditError(null);
    const days = sections.flatMap(s => s.weeks.flatMap(w => w.days.map(d => ({
      section_name: s.name, week_number: w.number, date: d.date!, dsl: d.dsl,
    }))));
    try {
      const updated = await api.planInstances.update(editingId, editName, days);
      const resolvedDays: ResolvedDay[] = updated.days.map(d => ({
        section_name: d.section_name, week_number: d.week_number, date: d.date, day: d.day,
        suffix: d.suffix ?? undefined, category: d.category ?? undefined, workout_type: d.workout_type as WorkoutType,
        segments: JSON.parse(d.segments), activity_target: d.activity_target ? JSON.parse(d.activity_target) : undefined,
        activity_description: d.activity_description ?? undefined, notes: d.notes ?? undefined, needs_review: d.needs_review === 1,
      }));
      setSections(sectionsFromDays(resolvedDays));
      await refreshInstances();
      notify(t("manage.planInstances.saveSucceeded", "Instance saved."));
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("manage.planInstances.saveFailed", "Failed to save instance"));
    }
    setSaveLoading(false);
  }

  async function onApprove() {
    if (editingId == null) return;
    setApproveLoading(true);
    try {
      await api.planInstances.approve(editingId);
      await refreshInstances();
      notify(t("manage.planInstances.approveSucceeded", "Instance approved."));
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("manage.planInstances.approveFailed", "Failed to approve instance"));
    }
    setApproveLoading(false);
  }

  async function onDelete(id: number) {
    setDeleteError(null);
    try {
      await api.planInstances.remove(id);
      setDeleteConfirmId(null);
      if (editingId === id) { resetEditor(); setMode("list"); }
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
        <button className="hra-btn" data-variant="accent" onClick={() => { resetInstantiateForm(); setMode("instantiate"); }} disabled={!templates || templates.length === 0}>
          {t("manage.planInstances.newInstance", "New instance")}
        </button>
        {templates && templates.length === 0 && (
          <div className="hra-text-muted" style={{ fontSize: 11, marginTop: 6 }}>{t("manage.planInstances.noTemplates", "Save a template first — an instance is always created from one.")}</div>
        )}
      </Card>
    );
  }

  if (mode === "instantiate") {
    return (
      <Card className="hra-instantiate-form">
        <div className="hra-block-title" style={{ marginBottom: 12 }}>{t("manage.planInstances.instantiateTitle", "New instance")}</div>

        {/* Row 1 — identity. Template gates the whole form below; Name is
            required; Race name/Race date/Link a race are independently
            optional. Equal-width grid, not ad hoc flex-basis guessing. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 6 }}>
          <Field label={t("manage.planInstances.templateLabel", "Template")} required>
            <Select
              value={templateId} onValueChange={onTemplateSelectChange}
              options={(templates ?? []).map(tpl => ({ value: String(tpl.id), label: tpl.name }))}
              placeholder={t("manage.planInstances.templatePlaceholder", "Pick a template…")}
              triggerStyle={{ width: "100%" }}
            />
          </Field>
          <Field label={t("manage.planTemplates.nameLabel", "Name")} required>
            <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={instName} onChange={e => setInstName(e.target.value)} disabled={!formEnabled} style={{ width: "100%", padding: "0 10px" }} />
          </Field>
          <Field label={t("manage.planInstances.raceNameLabel", "Race name")}>
            <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={raceName} onChange={e => setRaceName(e.target.value)} disabled={!formEnabled} placeholder={t("common.optional", "Optional")} style={{ width: "100%", padding: "0 10px" }} />
          </Field>
          <Field label={t("manage.planInstances.raceDateLabel", "Race date")}>
            <DatePicker value={raceDate} onChange={onRaceDateChange} disabled={!formEnabled} />
          </Field>
          <Field label={t("manage.planInstances.linkRaceLabel", "Link a race")}>
            <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={raceUrl} onChange={e => setRaceUrl(e.target.value)} disabled={!formEnabled} placeholder={t("manage.planInstances.linkRacePlaceholder", "e.g. https://www.baa.org/races/boston-marathon")} style={{ width: "100%", padding: "0 10px" }} />
          </Field>
        </div>
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
          <span className="hra-text-danger">*</span> {t("manage.planInstances.requiredLegend", "required")}
          {!formEnabled && <> — {t("manage.planInstances.pickTemplateFirst", "pick a Template above to enable the rest of this form.")}</>}
        </div>

        {/* Row 2 — timing. */}
        <div style={{ display: "grid", gridTemplateColumns: "160px 160px", gap: 10, marginBottom: 6 }}>
          <Field label={t("manage.planInstances.startDateLabel", "Start date")}>
            <DatePicker value={startDate} onChange={onStartDateChange} disabled={!formEnabled} />
          </Field>
          <Field label={t("manage.planInstances.daysBeforeRaceLabel", "Days before race")}>
            <input
              className="hra-border-strong hra-bg-card hra-text-primary"
              value={daysBeforeRace} onChange={e => onDaysBeforeRaceChange(e.target.value)}
              type="number" disabled={!formEnabled || !raceDate}
              placeholder={raceDate ? undefined : t("manage.planInstances.daysBeforeRaceUnavailable", "Set a race date above")}
              style={{ width: "100%", padding: "0 10px" }}
            />
          </Field>
        </div>
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
          {t("manage.planInstances.timingLinkHint", "🔗 Start date and Days before race are linked once Race date is set — editing either recomputes the other.")}
        </div>

        {/* Row 3 — pace: Race pace anchor + Pace input mode on one line. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24, marginBottom: 6 }}>
          <Field label={t("manage.planInstances.racePaceAnchorLabel", "Race pace anchor")}>
            <div className="hra-segment">
              {[NONE_ANCHOR, ...templateAnchors].map(a => (
                <button key={a} className="hra-segment-item" data-active={racePaceAnchor === a} disabled={!formEnabled} onClick={() => onRacePaceAnchorChange(a)}>
                  {a === NONE_ANCHOR ? t("manage.planInstances.racePaceAnchorNone", "None") : a}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("manage.planInstances.paceLabel", "Pace input")}>
            <div className="hra-segment">
              <button className="hra-segment-item" data-active={paceMode === "goalTime"} disabled={!formEnabled || !hasRacePaceAnchor} onClick={() => setPaceMode("goalTime")}>{t("manage.planInstances.goalTimeMode", "Goal time")}</button>
              <button className="hra-segment-item" data-active={paceMode === "anchor"} disabled={!formEnabled} onClick={() => setPaceMode("anchor")}>{t("manage.planInstances.anchorMode", "Anchor override")}</button>
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
                <input className="hra-border-strong hra-bg-card hra-text-primary" value={goalH} onChange={e => setGoalH(e.target.value)} disabled={!formEnabled} type="number" min={0} aria-label={t("manage.planInstances.goalTimeHoursAria", "Hours")} />
                <span>:</span>
                <input className="hra-border-strong hra-bg-card hra-text-primary" value={goalM} onChange={e => setGoalM(e.target.value)} disabled={!formEnabled} type="number" min={0} max={59} aria-label={t("manage.planInstances.goalTimeMinutesAria", "Minutes")} />
                <span>:</span>
                <input className="hra-border-strong hra-bg-card hra-text-primary" value={goalS} onChange={e => setGoalS(e.target.value)} disabled={!formEnabled} type="number" min={0} max={59} aria-label={t("manage.planInstances.goalTimeSecondsAria", "Seconds")} />
              </div>
            </Field>
            {showDistanceOverride && (
              <Field label={t("manage.planInstances.distanceLabel", "Distance (m) — optional override, defaults to the template's own distance")}>
                <input className="hra-border-strong hra-bg-card hra-text-primary" value={distanceM} onChange={e => setDistanceM(e.target.value)} disabled={!formEnabled} type="number" style={{ width: "100%", padding: "0 10px" }} placeholder={t("manage.planInstances.distancePlaceholder", "e.g. 21097")} />
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
            Unresolved as the last column. */}
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
                  const relativeDisabled = derived || !formEnabled || row.absoluteValue.trim() !== "";
                  const absoluteDisabled = derived || !formEnabled || row.relativeTo !== "" || row.seconds.trim() !== "";
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
                          disabled={derived || !formEnabled || anchorRowIsEmpty(row)}
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

        {instantiateError && <ErrorBanner message={instantiateError} />}

        <div className="hra-row-wrap">
          <button className="hra-btn" data-variant="green" onClick={onInstantiate} disabled={!canInstantiate || instantiateLoading}>
            {instantiateLoading ? t("common.saving", "Saving…") : t("manage.planInstances.createButton", "Create instance")}
          </button>
          <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => { resetInstantiateForm(); setMode("list"); }}>
            {t("common.cancel", "Cancel")}
          </button>
        </div>

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
      </Card>
    );
  }

  return (
    <Card>
      <div className="hra-block-title" style={{ marginBottom: 12 }}>{t("manage.planInstances.editTitle", "Edit instance")}</div>
      <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
        {t("manage.planTemplates.nameLabel", "Name")}
        <input className="hra-border-strong hra-bg-card hra-text-primary" value={editName} onChange={e => setEditName(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 6 }} />
      </label>

      <div className="hra-row-wrap" style={{ marginBottom: 12 }}>
        <button className="hra-btn" data-variant="green" onClick={onSave} disabled={saveLoading || sections.length === 0}>
          {saveLoading ? t("common.saving", "Saving…") : t("common.save", "Save")}
        </button>
        <button className="hra-btn" onClick={onApprove} disabled={approveLoading || editingId == null}>
          {approveLoading ? t("manage.planTemplates.approving", "Approving…") : t("manage.planTemplates.approveButton", "Approve")}
        </button>
        <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => { resetEditor(); setMode("list"); }}>
          {t("common.cancel", "Cancel")}
        </button>
      </div>

      {editError && <ErrorBanner message={editError} />}

      {sections.length > 0 && (
        <TrainingPlanAccordion
          ownerName={editName || t("manage.planTemplates.untitled", "Untitled plan")}
          sections={sections}
          onSectionEdit={() => {}}
          onWeekEdit={() => {}}
          onDayEdit={onDayEdit}
          readOnlySectionWeek
        />
      )}
    </Card>
  );
}
