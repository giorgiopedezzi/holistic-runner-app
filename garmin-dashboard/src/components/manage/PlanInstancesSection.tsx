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
  groupResolvedDaysIntoSectionViews, reconstructDslFromResolvedDay, type SectionView,
} from "@/domain/runplan-aggregate";
import { recomposeDayLine, splitNote } from "@/domain/runplan-patch";
import type { PlanTemplate, PlanInstance, RaceActivity } from "@/types/api";
import type { ResolvedDay, WorkoutType } from "@/types/runplan";
import { isoToday } from "@/utils/date";

const NO_RACE = "__no_race__";
const ULTRA_CUSTOM_EVENTS = new Set(["ultra", "custom"]);

export function PlanInstancesSection() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<PlanTemplate[] | null>(null);
  const [instances, setInstances] = useState<PlanInstance[] | null>(null);
  const [races, setRaces] = useState<RaceActivity[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [mode, setMode] = useState<"list" | "instantiate" | "editor">("list");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // instantiate form
  const [templateId, setTemplateId] = useState("");
  const [instName, setInstName] = useState("");
  const [startDate, setStartDate] = useState(isoToday());
  const [paceMode, setPaceMode] = useState<"anchor" | "goalTime">("goalTime");
  const [anchorName, setAnchorName] = useState("RG");
  const [anchorValue, setAnchorValue] = useState("");
  const [goalTime, setGoalTime] = useState("");
  const [distanceM, setDistanceM] = useState("");
  const [targetActivityId, setTargetActivityId] = useState(NO_RACE);
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
    api.planTemplates.list().then(setTemplates).catch(() => setTemplates([]));
    api.garmin.races().then(setRaces).catch(() => setRaces([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function resetInstantiateForm() {
    setTemplateId(""); setInstName(""); setStartDate(isoToday());
    setPaceMode("goalTime"); setAnchorName("RG"); setAnchorValue("");
    setGoalTime(""); setDistanceM(""); setTargetActivityId(NO_RACE);
    setInstantiateError(null);
  }

  function resetEditor() {
    setEditingId(null); setEditName(""); setSections([]); setEditError(null);
  }

  const selectedTemplate = templates?.find(tpl => String(tpl.id) === templateId);
  const needsDistance = paceMode === "goalTime" && !!selectedTemplate?.event && ULTRA_CUSTOM_EVENTS.has(selectedTemplate.event);
  const canInstantiate = templateId !== "" && instName.trim() !== "" && startDate !== ""
    && (paceMode === "anchor" ? anchorName.trim() !== "" && anchorValue.trim() !== "" : goalTime.trim() !== "" && (!needsDistance || distanceM.trim() !== ""));

  async function onInstantiate() {
    setInstantiateLoading(true); setInstantiateError(null);
    try {
      const body: Parameters<typeof api.planTemplates.instantiate>[1] = { name: instName.trim(), start_date: startDate };
      if (paceMode === "anchor") body.pace_overrides = { [anchorName.trim()]: anchorValue.trim() };
      else {
        body.goal_time = goalTime.trim();
        if (distanceM.trim() !== "") body.distance_m = Number(distanceM);
      }
      if (targetActivityId !== NO_RACE) body.target_activity_id = Number(targetActivityId);
      await api.planTemplates.instantiate(Number(templateId), body);
      await refreshInstances();
      resetInstantiateForm();
      setMode("list");
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
                {inst.event && <span className="hra-text-muted" style={{ fontSize: 11 }}>{inst.event}</span>}
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
    return (
      <Card>
        <div className="hra-block-title" style={{ marginBottom: 12 }}>{t("manage.planInstances.instantiateTitle", "New instance")}</div>

        <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
          {t("manage.planInstances.templateLabel", "Template")}
          <Select
            value={templateId} onValueChange={setTemplateId}
            options={(templates ?? []).map(tpl => ({ value: String(tpl.id), label: tpl.name }))}
            placeholder={t("manage.planInstances.templatePlaceholder", "Pick a template…")}
          />
        </label>

        <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
          {t("manage.planTemplates.nameLabel", "Name")}
          <input className="hra-border-strong hra-bg-card hra-text-primary" value={instName} onChange={e => setInstName(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 6 }} />
        </label>

        <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
          {t("manage.planInstances.startDateLabel", "Start date")}
          <div style={{ marginTop: 4 }}><DatePicker value={startDate} onChange={setStartDate} /></div>
        </label>

        <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 6 }}>{t("manage.planInstances.paceLabel", "Pace")}</div>
        <div className="hra-row-wrap" style={{ marginBottom: 10 }}>
          <button className="hra-toggle-pill" data-active={paceMode === "goalTime"} onClick={() => setPaceMode("goalTime")}>{t("manage.planInstances.goalTimeMode", "Goal time")}</button>
          <button className="hra-toggle-pill" data-active={paceMode === "anchor"} onClick={() => setPaceMode("anchor")}>{t("manage.planInstances.anchorMode", "Anchor override")}</button>
        </div>

        {paceMode === "goalTime" ? (
          <>
            <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
              {t("manage.planInstances.goalTimeLabel", "Goal time (HH:MM:SS)")}
              <input className="hra-border-strong hra-bg-card hra-text-primary" value={goalTime} onChange={e => setGoalTime(e.target.value)} placeholder="03:30:00" style={{ width: "100%", marginTop: 4, padding: 6 }} />
            </label>
            {needsDistance && (
              <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
                {t("manage.planInstances.distanceLabel", "Distance (m) — required for ultra/custom events")}
                <input className="hra-border-strong hra-bg-card hra-text-primary" value={distanceM} onChange={e => setDistanceM(e.target.value)} type="number" style={{ width: "100%", marginTop: 4, padding: 6 }} />
              </label>
            )}
          </>
        ) : (
          <div className="hra-row-wrap" style={{ marginBottom: 10 }}>
            <label className="hra-text-secondary" style={{ fontSize: 12 }}>
              {t("manage.planInstances.anchorNameLabel", "Anchor")}
              <input className="hra-border-strong hra-bg-card hra-text-primary" value={anchorName} onChange={e => setAnchorName(e.target.value)} style={{ marginTop: 4, padding: 6, width: 100 }} />
            </label>
            <label className="hra-text-secondary" style={{ fontSize: 12 }}>
              {t("manage.planInstances.anchorValueLabel", "Pace")}
              <input className="hra-border-strong hra-bg-card hra-text-primary" value={anchorValue} onChange={e => setAnchorValue(e.target.value)} placeholder="6:40/mi" style={{ marginTop: 4, padding: 6 }} />
            </label>
          </div>
        )}

        <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
          {t("manage.planInstances.linkRaceLabel", "Link a race (optional)")}
          <Select value={targetActivityId} onValueChange={setTargetActivityId} options={raceOptions} />
        </label>

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
