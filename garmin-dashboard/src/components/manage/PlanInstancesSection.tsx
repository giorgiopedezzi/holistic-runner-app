/**
 * PlanInstancesSection.tsx (HRA-118)
 * Data & Sync card: instantiate/edit/approve/delete plan instances, on top
 * of the shared accordion (HRA-116) and the plan-instances backend (HRA-112
 * through HRA-115, plus this Story's own GET /api/v1/plan-instances list
 * route). Structural sibling of PlanTemplatesSection (HRA-117), but simpler
 * at save time: each day PUTs its own {section_name, week_number, date, dsl}
 * directly (HRA-115) — there's no whole-document dsl_source to
 * content-anchor-patch here, unlike the template card.
 */
import { useEffect, useState } from "react";
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
import type { PlanTemplate, PlanInstance, RaceActivity } from "@/types/api";
import type { EventType, OffsetUnit, PacePolicy, PaceValue, ResolvedDay, RunPlan, WorkoutType } from "@/types/runplan";
import { isoToday } from "@/utils/date";

const NO_RACE = "__no_race__";
const NONE_ANCHOR = "__none__";

// Mirrors garmin-stats/src/controllers/plan-templates.controller.ts's own
// STANDARD_DISTANCE_M — used only for the live client-side resolution
// preview below (Row 4); the real distance resolution for goal_time still
// happens server-side, this just needs to match it closely enough to show
// an accurate preview.
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
function parseGoalTimeSec(raw: string): number | null {
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
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
function formatPaceSecPerKm(sec: number): string {
  const total = Math.round(sec);
  const min = Math.floor(total / 60);
  const s = total % 60;
  return `${min}:${String(s).padStart(2, "0")}/km`;
}

interface PolicyRow {
  id: number;
  anchor: string;
  mode: "absolute" | "relative";
  absoluteValue: string;
  relativeTo: string;
  sign: "+" | "-";
  seconds: string;
}
let nextPolicyRowId = 1;
function emptyPolicyRow(): PolicyRow {
  return { id: nextPolicyRowId++, anchor: "", mode: "absolute", absoluteValue: "", relativeTo: "", sign: "+", seconds: "" };
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
  const [races, setRaces] = useState<RaceActivity[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [mode, setMode] = useState<"list" | "instantiate" | "editor">("list");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // instantiate form — row 1 (identity)
  const [templateId, setTemplateId] = useState("");
  const [instName, setInstName] = useState("");
  const [raceName, setRaceName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [targetActivityId, setTargetActivityId] = useState(NO_RACE);
  // row 2 (timing) — startDate and daysBeforeRace are two views of one
  // relationship once raceDate is set (see onStartDateChange/
  // onDaysBeforeRaceChange/onRaceDateChange below).
  const [startDate, setStartDate] = useState(isoToday());
  const [daysBeforeRace, setDaysBeforeRace] = useState("");
  // row 3 (pace) — racePaceAnchor is one of the template's own anchors, or
  // NONE_ANCHOR; paceMode is forced to "anchor" whenever it's NONE_ANCHOR
  // (Goal time has nothing to convert to without a designated anchor).
  const [racePaceAnchor, setRacePaceAnchor] = useState(NONE_ANCHOR);
  const [paceMode, setPaceMode] = useState<"anchor" | "goalTime">("goalTime");
  const [goalTime, setGoalTime] = useState("");
  const [distanceM, setDistanceM] = useState("");
  const [anchorOverrideValue, setAnchorOverrideValue] = useState("");
  const [policyRows, setPolicyRows] = useState<PolicyRow[]>([]);
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

  useEffect(() => {
    refreshInstances();
    api.garmin.races().then(setRaces).catch(() => setRaces([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function resetInstantiateForm() {
    setTemplateId(""); setInstName(""); setRaceName(""); setRaceDate("");
    setStartDate(isoToday()); setDaysBeforeRace("");
    setRacePaceAnchor(NONE_ANCHOR); setPaceMode("goalTime");
    setGoalTime(""); setDistanceM(""); setAnchorOverrideValue(""); setPolicyRows([]);
    setTargetActivityId(NO_RACE);
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

  function onTemplateChange(id: string) {
    setTemplateId(id);
    const tpl = templates?.find(t => String(t.id) === id);
    let plan: RunPlan | null = null;
    if (tpl) { try { plan = JSON.parse(tpl.parsed_plan) as RunPlan; } catch { plan = null; } }
    const anchors = plan ? collectPlanAnchors(plan) : [];
    setRacePaceAnchor(anchors.length > 0 ? anchors[0] : NONE_ANCHOR);
    setPaceMode("goalTime");
    setGoalTime(""); setDistanceM(""); setAnchorOverrideValue(""); setPolicyRows([]);
  }

  // Goal time is only selectable while a race pace anchor is chosen — with
  // NONE_ANCHOR there's no anchor for it to convert to, so switching to
  // NONE_ANCHOR while Goal time was active forces Anchor override instead.
  function onRacePaceAnchorChange(v: string) {
    setRacePaceAnchor(v);
    if (v === NONE_ANCHOR && paceMode === "goalTime") setPaceMode("anchor");
  }

  function addPolicyRow() { setPolicyRows(prev => [...prev, emptyPolicyRow()]); }
  function removePolicyRow(id: number) { setPolicyRows(prev => prev.filter(r => r.id !== id)); }
  function updatePolicyRow(id: number, patch: Partial<PolicyRow>) {
    setPolicyRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  const selectedTemplate = templates?.find(tpl => String(tpl.id) === templateId);
  let selectedPlan: RunPlan | null = null;
  if (selectedTemplate) { try { selectedPlan = JSON.parse(selectedTemplate.parsed_plan) as RunPlan; } catch { selectedPlan = null; } }
  const templateAnchors = selectedPlan ? collectPlanAnchors(selectedPlan) : [];
  const hasRacePaceAnchor = racePaceAnchor !== NONE_ANCHOR;

  // HRA-120: a custom-event template always carries its own distance_m
  // (mandatory at template save time) — this field is now an optional
  // override, never required to instantiate. Precedence at instantiate time:
  // this explicit value > the template's own distance_m > the event's
  // standard distance (enforced server-side, controllers/plan-templates.controller.ts).
  const showDistanceOverride = paceMode === "goalTime" && selectedTemplate?.event === "custom";

  // Row 4 — live, client-side resolution preview (HRA-121): reuses the same
  // pure resolveIntensityPaceSecPerKm the template accordion already relies
  // on (domain/runplan-aggregate.ts) — no new preview endpoint. Anchors not
  // covered by the race pace anchor or a Race policy row simply resolve
  // against the template's own plan-level pace_policy, same precedence
  // instantiatePlan itself applies server-side.
  function previewGoalDistanceM(): number | null {
    if (distanceM.trim() !== "") return Number(distanceM);
    if (selectedPlan?.metadata.distance_m != null) return selectedPlan.metadata.distance_m;
    if (selectedTemplate?.event) return STANDARD_DISTANCE_M[selectedTemplate.event as EventType] ?? null;
    return null;
  }
  function buildOverridePolicy(offsetUnit: OffsetUnit): PacePolicy {
    const policy: PacePolicy = {};
    if (hasRacePaceAnchor) {
      if (paceMode === "goalTime") {
        const distM = previewGoalDistanceM();
        const goalSec = parseGoalTimeSec(goalTime);
        if (distM != null && goalSec != null) policy[racePaceAnchor] = { kind: "absolute", pace_sec_per_km: goalSec / (distM / 1000) };
      } else if (anchorOverrideValue.trim() !== "") {
        const parsed = parsePaceOverrideInput(anchorOverrideValue, offsetUnit);
        if (parsed) policy[racePaceAnchor] = parsed;
      }
    }
    for (const row of policyRows) {
      if (row.anchor === "") continue;
      if (row.mode === "absolute" && row.absoluteValue.trim() !== "") {
        const parsed = parsePaceOverrideInput(row.absoluteValue, offsetUnit);
        if (parsed) policy[row.anchor] = parsed;
      } else if (row.mode === "relative" && row.relativeTo !== "" && row.seconds.trim() !== "") {
        const secs = Number(row.seconds);
        if (Number.isFinite(secs)) policy[row.anchor] = { kind: "offset", anchor: row.relativeTo, offset_sec_per_km: row.sign === "+" ? secs : -secs };
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

  const canInstantiate = templateId !== "" && instName.trim() !== "" && startDate !== "" && allResolved;

  async function onInstantiate() {
    setInstantiateLoading(true); setInstantiateError(null);
    try {
      const body: Parameters<typeof api.planTemplates.instantiate>[1] = { name: instName.trim(), start_date: startDate };
      if (raceName.trim() !== "") body.race_name = raceName.trim();
      if (raceDate.trim() !== "") body.race_date = raceDate.trim();

      const overrides: Record<string, string> = {};
      for (const row of policyRows) {
        if (row.anchor === "") continue;
        if (row.mode === "absolute" && row.absoluteValue.trim() !== "") overrides[row.anchor] = row.absoluteValue.trim();
        else if (row.mode === "relative" && row.relativeTo !== "" && row.seconds.trim() !== "") overrides[row.anchor] = `${row.relativeTo}${row.sign}${row.seconds.trim()}`;
      }
      if (hasRacePaceAnchor) {
        if (paceMode === "goalTime") {
          body.goal_time = goalTime.trim();
          body.race_pace_anchor = racePaceAnchor;
          if (distanceM.trim() !== "") body.distance_m = Number(distanceM);
        } else if (anchorOverrideValue.trim() !== "") {
          overrides[racePaceAnchor] = anchorOverrideValue.trim();
        }
      }
      if (Object.keys(overrides).length > 0) body.pace_overrides = overrides;

      if (targetActivityId !== NO_RACE) body.target_activity_id = Number(targetActivityId);
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
          <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("common.loading", "Loading…")}</div>
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
    const raceOptions = [
      { value: NO_RACE, label: t("manage.planInstances.noRace", "No linked race") },
      ...(races ?? []).map(r => ({ value: String(r.id), label: `${r.activity_name ?? r.date_only} (${r.date_only})` })),
    ];
    const racePaceAnchorOptions = [
      ...templateAnchors.map(a => ({ value: a, label: a })),
      { value: NONE_ANCHOR, label: t("manage.planInstances.racePaceAnchorNone", "None") },
    ];
    const usedPolicyAnchors = new Set(policyRows.map(r => r.anchor).filter(a => a !== ""));

    return (
      <Card>
        <div className="hra-block-title" style={{ marginBottom: 12 }}>{t("manage.planInstances.instantiateTitle", "New instance")}</div>

        {/* Row 1 — identity: Template/Name required, Race name/Race date/Race
            link independently optional. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "1 1 200px" }}>
            {t("manage.planInstances.templateLabel", "Template")}
            <div style={{ marginTop: 4 }}>
              <Select
                value={templateId} onValueChange={onTemplateChange}
                options={(templates ?? []).map(tpl => ({ value: String(tpl.id), label: tpl.name }))}
                placeholder={t("manage.planInstances.templatePlaceholder", "Pick a template…")}
              />
            </div>
          </label>
          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "1 1 160px" }}>
            {t("manage.planTemplates.nameLabel", "Name")}
            <input className="hra-border-strong hra-bg-card hra-text-primary" value={instName} onChange={e => setInstName(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 6 }} />
          </label>
          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "1 1 160px" }}>
            {t("manage.planInstances.raceNameLabel", "Race name")}
            <input className="hra-border-strong hra-bg-card hra-text-primary" value={raceName} onChange={e => setRaceName(e.target.value)} placeholder={t("common.optional", "Optional")} style={{ width: "100%", marginTop: 4, padding: 6 }} />
          </label>
          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto" }}>
            {t("manage.planInstances.raceDateLabel", "Race date")}
            <div style={{ marginTop: 4 }}><DatePicker value={raceDate} onChange={onRaceDateChange} /></div>
          </label>
          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "1 1 200px" }}>
            {t("manage.planInstances.linkRaceLabel", "Link a race (optional)")}
            <div style={{ marginTop: 4 }}><Select value={targetActivityId} onValueChange={setTargetActivityId} options={raceOptions} /></div>
          </label>
        </div>

        {/* Row 2 — timing: Start date <-> Days before race, linked once Race
            date is set. Hints always visible, not hover-only. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto" }}>
            {t("manage.planInstances.startDateLabel", "Start date")}
            <div style={{ marginTop: 4 }}><DatePicker value={startDate} onChange={onStartDateChange} /></div>
          </label>
          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto" }}>
            {t("manage.planInstances.daysBeforeRaceLabel", "Days before race")}
            <input
              className="hra-border-strong hra-bg-card hra-text-primary"
              value={daysBeforeRace} onChange={e => onDaysBeforeRaceChange(e.target.value)}
              type="number" disabled={!raceDate}
              placeholder={raceDate ? undefined : t("manage.planInstances.daysBeforeRaceUnavailable", "Set a race date above to use this")}
              style={{ width: raceDate ? 100 : 260, marginTop: 4, padding: 6 }}
            />
          </label>
        </div>
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 14 }}>
          {t("manage.planInstances.timingLinkHint", "🔗 Start date and Days before race are linked once Race date is set — editing either recomputes the other.")}
        </div>

        {/* Row 3 — pace: Race pace anchor + Pace input mode on one line. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24, marginBottom: 6 }}>
          <label className="hra-text-secondary" style={{ fontSize: 12 }}>
            {t("manage.planInstances.racePaceAnchorLabel", "Race pace anchor")}
            <div className="hra-segment" style={{ marginTop: 4 }}>
              {racePaceAnchorOptions.map(opt => (
                <button key={opt.value} className="hra-segment-item" data-active={racePaceAnchor === opt.value} onClick={() => onRacePaceAnchorChange(opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </label>
          <label className="hra-text-secondary" style={{ fontSize: 12 }}>
            {t("manage.planInstances.paceLabel", "Pace input")}
            <div className="hra-segment" style={{ marginTop: 4 }}>
              <button className="hra-segment-item" data-active={paceMode === "goalTime"} disabled={!hasRacePaceAnchor} onClick={() => setPaceMode("goalTime")}>{t("manage.planInstances.goalTimeMode", "Goal time")}</button>
              <button className="hra-segment-item" data-active={paceMode === "anchor"} onClick={() => setPaceMode("anchor")}>{t("manage.planInstances.anchorMode", "Anchor override")}</button>
            </div>
          </label>
        </div>
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 12 }}>
          {t("manage.planInstances.paceModeHint", "Goal time is only selectable while a race pace anchor is chosen — \"None\" forces Anchor override.")}
        </div>

        {hasRacePaceAnchor && (paceMode === "goalTime" ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto" }}>
              {t("manage.planInstances.goalTimeLabel", "Goal time (HH:MM:SS)")}
              <input className="hra-border-strong hra-bg-card hra-text-primary" value={goalTime} onChange={e => setGoalTime(e.target.value)} placeholder="03:30:00" style={{ width: 130, marginTop: 4, padding: 6, fontFamily: "monospace" }} />
            </label>
            {showDistanceOverride && (
              <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto" }}>
                {t("manage.planInstances.distanceLabel", "Distance (m) — optional override, defaults to the template's own distance")}
                <input className="hra-border-strong hra-bg-card hra-text-primary" value={distanceM} onChange={e => setDistanceM(e.target.value)} type="number" style={{ width: 140, marginTop: 4, padding: 6 }} />
              </label>
            )}
          </div>
        ) : (
          <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 14 }}>
            {t("manage.planInstances.anchorValueLabel", "Pace")} ({racePaceAnchor})
            <input className="hra-border-strong hra-bg-card hra-text-primary" value={anchorOverrideValue} onChange={e => setAnchorOverrideValue(e.target.value)} placeholder="6:40/mi" style={{ width: 160, marginTop: 4, padding: 6 }} />
          </label>
        ))}

        <div style={{ marginBottom: 16 }}>
          <div className="hra-text-secondary" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            {t("manage.planInstances.racePolicyTitle", "Race policy — override any other anchor")}
          </div>
          {policyRows.map(row => {
            const anchorOptions = templateAnchors.filter(a => a !== racePaceAnchor && (a === row.anchor || !usedPolicyAnchors.has(a)));
            const relativeToOptions = templateAnchors.filter(a => a !== row.anchor);
            return (
              <div key={row.id} className="hra-row-wrap" style={{ marginBottom: 8, alignItems: "flex-end" }}>
                <label className="hra-text-secondary" style={{ fontSize: 12 }}>
                  {t("manage.planInstances.policyAnchorLabel", "Anchor")}
                  <div style={{ marginTop: 4 }}>
                    <Select value={row.anchor} onValueChange={v => updatePolicyRow(row.id, { anchor: v })} options={anchorOptions.map(a => ({ value: a, label: a }))} placeholder="—" />
                  </div>
                </label>
                <div className="hra-segment" style={{ alignSelf: "flex-end" }}>
                  <button className="hra-segment-item" data-active={row.mode === "absolute"} onClick={() => updatePolicyRow(row.id, { mode: "absolute" })}>{t("manage.planInstances.policyModeAbsolute", "Absolute")}</button>
                  <button className="hra-segment-item" data-active={row.mode === "relative"} onClick={() => updatePolicyRow(row.id, { mode: "relative" })}>{t("manage.planInstances.policyModeRelative", "Relative")}</button>
                </div>
                {row.mode === "absolute" ? (
                  <label className="hra-text-secondary" style={{ fontSize: 12 }}>
                    {t("manage.planInstances.policyAbsoluteLabel", "Absolute pace")}
                    <input className="hra-border-strong hra-bg-card hra-text-primary" value={row.absoluteValue} onChange={e => updatePolicyRow(row.id, { absoluteValue: e.target.value })} placeholder="5:10/km" style={{ width: 100, marginTop: 4, padding: 6 }} />
                  </label>
                ) : (
                  <>
                    <label className="hra-text-secondary" style={{ fontSize: 12 }}>
                      {t("manage.planInstances.policyRelativeToLabel", "Relative to")}
                      <div style={{ marginTop: 4 }}>
                        <Select value={row.relativeTo} onValueChange={v => updatePolicyRow(row.id, { relativeTo: v })} options={relativeToOptions.map(a => ({ value: a, label: a }))} placeholder="—" />
                      </div>
                    </label>
                    <div className="hra-segment" style={{ alignSelf: "flex-end" }}>
                      <button className="hra-segment-item" data-active={row.sign === "+"} onClick={() => updatePolicyRow(row.id, { sign: "+" })}>+</button>
                      <button className="hra-segment-item" data-active={row.sign === "-"} onClick={() => updatePolicyRow(row.id, { sign: "-" })}>−</button>
                    </div>
                    <label className="hra-text-secondary" style={{ fontSize: 12 }}>
                      {t("manage.planInstances.policySecondsLabel", "Seconds")}
                      <input className="hra-border-strong hra-bg-card hra-text-primary" value={row.seconds} onChange={e => updatePolicyRow(row.id, { seconds: e.target.value })} type="number" style={{ width: 80, marginTop: 4, padding: 6 }} />
                    </label>
                  </>
                )}
                <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }} onClick={() => removePolicyRow(row.id)}>
                  {t("common.delete", "Delete")}
                </button>
              </div>
            );
          })}
          <button
            className="hra-border-strong hra-text-secondary"
            style={{ background: "none", border: "1px dashed var(--border-strong)", borderRadius: 6, padding: "8px 14px", fontSize: 12, cursor: "pointer", width: "100%" }}
            onClick={addPolicyRow}
            disabled={templateAnchors.length === 0}
          >
            {t("manage.planInstances.addPolicyRow", "+ Add anchor override")}
          </button>
        </div>

        {/* Row 4 — resolution, read only. */}
        <div className="hra-text-secondary" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
          {t("manage.planInstances.resolutionTitle", "Resolution")}
        </div>
        {resolution.length === 0 ? (
          <div className="hra-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>{t("manage.planInstances.resolutionEmpty", "This template references no symbolic pace anchors — nothing to resolve.")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {resolution.map(r => (
              <div key={r.anchor} className="hra-border-strong" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8 }}>
                <span style={{ width: 64, fontWeight: 600, fontFamily: "monospace" }}>{r.anchor}</span>
                <span className="hra-text-secondary" style={{ flex: 1, fontFamily: "monospace", fontStyle: r.secPerKm == null ? "italic" : undefined }}>
                  {r.secPerKm != null ? formatPaceSecPerKm(r.secPerKm) : t("manage.planInstances.resolutionNotSet", "— not set —")}
                </span>
                <Badge
                  label={r.secPerKm != null ? t("manage.planInstances.resolutionResolved", "Resolved") : t("manage.planInstances.resolutionUnresolved", "Unresolved")}
                  color={r.secPerKm != null ? "var(--accent-green)" : "var(--accent-red)"}
                />
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: unresolvedAnchors.length > 0 ? "var(--accent-red)" : "var(--text-muted)", marginBottom: 14 }}>
          {unresolvedAnchors.length > 0
            ? t("manage.planInstances.resolutionBlockedHint", "{{anchors}} still unresolved — add an override above before you can create the instance.", { anchors: unresolvedAnchors.join(", ") })
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
