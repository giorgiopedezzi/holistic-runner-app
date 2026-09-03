/**
 * Plans tab card for creating, editing, approving, regenerating and deleting
 * plan instances. Editor data/baselines are centralized in
 * usePlanInstanceEditorState; day mutation/validation lives in usePlanDayEditor;
 * pure dirty/mapping/pace logic and confirmation rendering live in sibling modules.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/api/client";
import { Card, ErrorBanner, WarningBanner } from "@/components/ui";
import { TrainingPlanAccordion, type DayRef, type EditedRef, type WeekRef, type WorkoutTypeSwitchValue } from "@/components/TrainingPlanAccordion";
import { PlanInstanceCalendar, CategoryLegend } from "@/components/manage/PlanInstanceCalendar";
import { PlanInstanceAnchorTable } from "@/components/manage/PlanInstanceAnchorTable";
import { PlanInstanceFormFields } from "@/components/manage/PlanInstanceFormFields";
import { PlanInstanceEditorActions } from "@/components/manage/PlanInstanceEditorActions";
import { PlanInstanceRow } from "@/components/manage/PlanInstanceRow";
import { collectPlanAnchors, resolveIntensityPaceSecPerKm, type DayView, type SectionView, type WeekView } from "@/domain/runplan-aggregate";
import { notify } from "@/utils/toast";
import { useUrlState } from "@/hooks/useUrlState";
import type { PlanTemplate, PlanInstance } from "@/types/api";
import type { EventType, OffsetUnit, PacePolicy, RunPlan } from "@/types/runplan";
import { isoToday } from "@/utils/date";
import {
  NONE_ANCHOR, emptyAnchorRow, usePlanInstanceEditorState,
  type AnchorRowState, type PlanInstanceDraft,
} from "@/components/manage/plan-instances/planInstanceEditor.model";
import {
  formatGoalTimeDigits, formatGoalTimeFromSec, formatPaceSecPerKm, goalTimeToSec, pad2,
  parsePaceOverrideInput, paceValueToAnchorRow, sanitizeGoalTimeInput, STANDARD_DISTANCE_M,
} from "@/components/manage/plan-instances/planInstancePace";
import { apiDaysToSections, snapshotDsl } from "@/components/manage/plan-instances/planInstanceEditor.mappers";
import {
  addDaysISO, computeK0, daysBetween, editorWeek1AnchorMismatch, hasEnteredData, manualEditCount,
  mondayBasedWeekday, selectDirtyState,
} from "@/components/manage/plan-instances/planInstanceEditor.selectors";
import { usePlanDayEditor } from "@/components/manage/plan-instances/usePlanDayEditor";
import {
  PlanInstanceConfirmations, type PlanInstanceConfirmation,
} from "@/components/manage/plan-instances/PlanInstanceConfirmations";

export { NONE_ANCHOR };
export type { AnchorRowState };

export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="hra-field-label">
        {label}{required && <span className="hra-text-danger"> *</span>}
      </span>
      {children}
    </div>
  );
}

type RowKey = number | "new";

interface Props {
  templates: PlanTemplate[] | null;
}

export function PlanInstancesSection({ templates }: Props) {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<PlanInstance[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<RowKey | null>(null);
  const editingId = typeof activeKey === "number" ? activeKey : null;
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PlanInstanceDraft>>({});
  const [confirmation, setConfirmation] = useState<PlanInstanceConfirmation>(null);
  // HRA-249: the just-edited day, for TrainingPlanAccordion's
  // hra-edited-row-highlight — same role as PlanTemplatesSection.tsx's own
  // lastEditedRef, extended here since the instance editor previously never
  // set one (readOnlyDays used to be tied to approval instead).
  const [highlightedRef, setHighlightedRef] = useState<EditedRef | null>(null);

  const editor = usePlanInstanceEditorState();
  const {
    templateId, instName, raceName, raceDate, raceUrl, startDate, daysBeforeRace, restDayLabel,
    racePaceAnchor, paceMode, goalTimeDigits, distanceM, anchorRows, sections, effectiveFrom,
    editApprovedAt, baseline,
  } = editor.state;
  const { instName: baselineInstName, persistedDsl } = baseline;

  const setTemplateId = editor.setter("templateId");
  const setInstName = editor.setter("instName");
  const setRaceName = editor.setter("raceName");
  const setRaceDate = editor.setter("raceDate");
  const setRaceUrl = editor.setter("raceUrl");
  const setStartDate = editor.setter("startDate");
  const setDaysBeforeRace = editor.setter("daysBeforeRace");
  const setRestDayLabel = editor.setter("restDayLabel");
  const setRacePaceAnchor = editor.setter("racePaceAnchor");
  const setPaceMode = editor.setter("paceMode");
  const setGoalTimeDigits = editor.setter("goalTimeDigits");
  const setDistanceM = editor.setter("distanceM");
  const setAnchorRows = editor.setter("anchorRows");
  const setSections = editor.setter("sections");
  const setEffectiveFrom = editor.setter("effectiveFrom");
  const setEditApprovedAt = editor.setter("editApprovedAt");
  const setSaveForcedEnabled = editor.setter("saveForcedEnabled");
  const setBaselineStartDate = editor.baselineSetter("startDate");
  const setBaselineAnchorRows = editor.baselineSetter("anchorRows");
  const setBaselineRacePaceAnchor = editor.baselineSetter("racePaceAnchor");
  const setBaselinePaceMode = editor.baselineSetter("paceMode");
  const setBaselineGoalTimeDigits = editor.baselineSetter("goalTimeDigits");
  const setBaselineDistanceM = editor.baselineSetter("distanceM");
  const setBaselineInstName = editor.baselineSetter("instName");
  const setBaselineRaceName = editor.baselineSetter("raceName");
  const setBaselineRaceDate = editor.baselineSetter("raceDate");
  const setBaselineRaceUrl = editor.baselineSetter("raceUrl");
  const setPersistedDsl = editor.baselineSetter("persistedDsl");

  const goalH = goalTimeDigits.slice(0, 2);
  const goalM = goalTimeDigits.slice(2, 4);
  const goalS = goalTimeDigits.slice(4, 6);

  const [instantiateLoading, setInstantiateLoading] = useState(false);
  const [instantiateError, setInstantiateError] = useState<string | null>(null);
  // Backed by the URL's `planViewMode` param (HRA-195, reusing HRA-193's
  // useUrlState) so a refresh keeps the last-picked list/agenda view.
  const [rawViewMode, setRawViewMode] = useUrlState("planViewMode", "list");
  const viewMode: "list" | "agenda" = rawViewMode === "agenda" ? "agenda" : "list";
  const setViewMode = (mode: "list" | "agenda") => setRawViewMode(mode);
  const [editError, setEditError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);
  const [regenerateLoading, setRegenerateLoading] = useState(false);

  const minEffectiveFrom = startDate > isoToday() ? startDate : isoToday();
  useEffect(() => {
    if (effectiveFrom < minEffectiveFrom) setEffectiveFrom(minEffectiveFrom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minEffectiveFrom]);

  function refreshInstances() {
    return api.planInstances.list().then(setInstances).catch(e => setListError(e instanceof Error ? e.message : t("manage.planInstances.loadFailed", "Failed to load instances")));
  }

  useEffect(() => { refreshInstances(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // HRA-133: the unified "plan" screen's own reset — both the shared top
  // fields and the editor's own day-level state, since they now render
  // together. Used whenever leaving the screen entirely (Restore, back to
  // list) or starting completely fresh (New instance).
  function resetPlanScreen() {
    editor.reset();
    setInstantiateError(null);
    setEditError(null);
    setHighlightedRef(null);
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
    if (templateId !== "" && id !== templateId && hasEnteredData(editor.state)) {
      setConfirmation({ type: "switch-template", templateId: id });
      return;
    }
    applyTemplateChange(id);
  }
  // Goal time is only selectable while a race pace anchor is chosen — with
  // NONE_ANCHOR there's no anchor for it to convert to, so switching to
  // NONE_ANCHOR while Goal time was active forces Anchor override instead.
  function onRacePaceAnchorChange(v: string) {
    setRacePaceAnchor(v);
    if (v === NONE_ANCHOR && paceMode === "goalTime") setPaceMode("anchor");
  }

  // The Goal time input is read-only while paceMode is "anchor" (it shows a
  // computed equivalent, see equivalentGoalTimeSec below) — this guard was
  // previously inline in the input's own onChange.
  function onGoalTimeInput(raw: string) {
    if (paceMode === "goalTime") setGoalTimeDigits(sanitizeGoalTimeInput(raw));
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
      const built = apiDaysToSections(created.days);
      setSections(built);
      setPersistedDsl(snapshotDsl(built));
      notify(t("manage.planInstances.instantiateSucceeded", "Plan created from template."));
    } catch (e) {
      setInstantiateError(e instanceof Error ? e.message : t("manage.planInstances.instantiateFailed", "Failed to create plan from template"));
    }
    setInstantiateLoading(false);
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
      const built = apiDaysToSections(full.days);
      setSections(built);
      setPersistedDsl(snapshotDsl(built));
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t("manage.planInstances.loadInstanceFailed", "Failed to load instance"));
    }
  }

  function captureDraft(): PlanInstanceDraft {
    return editor.snapshot();
  }

  function restoreDraft(draft: PlanInstanceDraft) {
    editor.replace(draft);
    setInstantiateError(null);
    setEditError(null);
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

  const dayEditor = usePlanDayEditor({ editingId, sections, setSections, t, setHighlightedRef });

  function onWorkoutTypeEdit(sectionIndex: number, weekIndex: number, dayIndex: number, workoutType: WorkoutTypeSwitchValue) {
    setConfirmation({
      type: "workout-type",
      change: { sectionIndex, weekIndex, dayIndex, workoutType },
    });
  }

  function onDayDragSwap(a: DayRef, b: DayRef) {
    setConfirmation({ type: "day-swap", a, b });
  }

  function onDayDragSwapByDayId(aDayId: number, bDayId: number) {
    const a = dayEditor.findDayIndicesById(aDayId);
    const b = dayEditor.findDayIndicesById(bDayId);
    if (a && b) setConfirmation({ type: "day-swap", a, b });
  }

  function onWeekDragSwap(a: WeekRef, b: WeekRef) {
    setConfirmation({ type: "week-swap", a, b });
  }

  // HRA-202: the date-pill button's export action — fetch -> Blob -> <a
  // download>, the plain-browser-download mechanism this Story establishes
  // for the whole Epic (no File System Access API). day.id is only ever set
  // for an already-persisted plan_instance_days row (see DayView's own doc
  // comment, HRA-149) — undefined here would mean the button rendered for a
  // draft that was never instantiated, which InstanceDayRow's caller (this
  // component) never does. The backend rejects (422) exactly the day states
  // toGarminWorkoutFit itself rejects (needs_review, or a workout_type other
  // than run/rest) — its problem+json `detail` surfaces as the toast text via
  // ApiError, the same error-toast pattern every other CTA in this file uses.
  async function onExportDayFit(day: DayView) {
    if (editingId == null || day.id == null) return;
    try {
      const { blob, filename } = await api.planInstances.downloadDayFit(editingId, day.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(e instanceof Error ? e.message : t("manage.planInstances.exportFitFailed", "Could not export this workout."), "error");
    }
  }

  // HRA-203: Section/Week title row's own "Generate fit" button — same
  // fetch -> Blob -> <a download> mechanism as onExportDayFit above, bundled
  // into a zip server-side instead of a single .fit. Non-exportable days
  // within the scope are skipped server-side rather than failing the whole
  // request (Story AC3); when any were, a toast names how many, using the
  // response's own X-Export-* counts rather than recomputing them
  // client-side. A scope with zero exportable days throws (422) before any
  // blob exists, so the catch below both covers "real" failures and this
  // "nothing to export" case with the same error-toast pattern every other
  // CTA here uses.
  async function downloadScopeFitZip(sectionName: string, weekNumber?: number) {
    if (editingId == null) return;
    try {
      const { blob, filename, total, included, skipped } = await api.planInstances.downloadScopeFit(editingId, sectionName, weekNumber);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (skipped > 0) {
        notify(
          t("manage.planInstances.exportScopeFitPartial", `${included} of ${total} days exported — ${skipped} skipped: needs review`, { included, total, skipped }),
          "success",
        );
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : t("manage.planInstances.exportScopeFitFailed", "Could not export these workouts."), "error");
    }
  }
  function onExportSectionFit(section: SectionView) {
    void downloadScopeFitZip(section.name);
  }
  function onExportWeekFit(section: SectionView, week: WeekView) {
    void downloadScopeFitZip(section.name, week.number);
  }

  const onDayEdit = dayEditor.onDayEdit;
  const onScheduledTimeEdit = dayEditor.onScheduledTimeEdit;
  const onScheduledTimeEditByDayId = dayEditor.onScheduledTimeEditByDayId;

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
      const built = apiDaysToSections(updated.days);
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

  // Save is gated on a confirmation only when the persisted name changes.
  function onSaveClick() {
    if (instName.trim() !== baselineInstName) { setConfirmation({ type: "rename" }); return; }
    onSave();
  }

  async function onApprove() {
    if (editingId == null) return;
    setApproveLoading(true);
    try {
      const approved = await api.planInstances.approve(editingId);
      setEditApprovedAt(approved.approved_at);
      await refreshInstances();
      notify(t("manage.planInstances.approveSucceeded", "Race plan activated."));
    } catch (e) {
      // HRA-249: an overlap conflict (409, structured on e.overlaps) gets its
      // own single-acknowledgement warning instead of the generic error
      // banner — no "Activate anyway" override exists, so there's nothing
      // for the confirmation's "confirm" action to do beyond dismissing.
      // Replaces any earlier conflict warning rather than stacking (AC8: no
      // duplicate warning entries on repeated attempts against the same
      // conflict).
      if (e instanceof ApiError && e.status === 409 && e.overlaps) {
        setConfirmation({ type: "activation-conflict", overlaps: e.overlaps });
      } else {
        setEditError(e instanceof Error ? e.message : t("manage.planInstances.approveFailed", "Failed to activate race plan"));
      }
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
  async function doRegenerate() {
    if (editingId == null) return;
    setRegenerateLoading(true); setEditError(null);
    try {
      const updated = await api.planInstances.regenerate(editingId, {
        start_date: startDate,
        pace_overrides: buildPaceOverridesForRegenerate(),
        effective_from: effectiveFrom,
      });
      const built = apiDaysToSections(updated.days);
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

  // Warn before regeneration discards manually edited days on/after the cutover.
  function onRegenerateClick() {
    const count = manualEditCount(sections, persistedDsl, effectiveFrom);
    if (count > 0) { setConfirmation({ type: "regenerate", manualEditCount: count }); return; }
    doRegenerate();
  }

  // HRA-141 Ask #3, amended HRA-249: "Restore" discards the active row's
  // unsaved edits WITHOUT collapsing it — for an existing instance that
  // means re-populating from its actual persisted values (startEdit()
  // re-fetches + rebuilds baselines, exactly what opening the row fresh
  // does), not wiping to resetPlanScreen()'s blank defaults, which is what
  // this used to do (the amendment's "Restore collapsing the row instead of
  // just resetting it" / discarding real persisted data instead of only the
  // unsaved edits). The "new" (never-instantiated) draft row has nothing
  // persisted to restore to, so it still resets to blank — just without
  // collapsing. Gated on a confirm only when genuinely dirty (either
  // bucket, HRA-136's own union — HRA-249 extends "dirty" to cover day
  // edits on an approved row too, see selectDirtyState).
  function onRestoreClick(dirty: boolean) {
    if (dirty) { setConfirmation({ type: "restore" }); return; }
    void doRestore();
  }
  async function doRestore() {
    if (activeKey == null) return;
    const key = String(activeKey);
    setDrafts(prev => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
    if (activeKey === "new") {
      resetPlanScreen();
      return;
    }
    const instance = instances?.find(inst => inst.id === activeKey);
    if (instance) await startEdit(instance);
  }

  async function onDelete(id: number) {
    setDeleteError(null);
    try {
      await api.planInstances.remove(id);
      setConfirmation(null);
      setDrafts(prev => { const key = String(id); if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
      if (activeKey === id) { resetPlanScreen(); setActiveKey(null); }
      await refreshInstances();
      notify(t("manage.planInstances.deleteSucceeded", "Instance deleted."));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t("manage.planInstances.deleteFailed", "Failed to delete instance"));
    }
  }

  function confirmPendingAction() {
    if (!confirmation) return;

    switch (confirmation.type) {
      case "switch-template":
        applyTemplateChange(confirmation.templateId);
        setConfirmation(null);
        break;
      case "rename":
        setConfirmation(null);
        void onSave();
        break;
      case "regenerate":
        setConfirmation(null);
        void doRegenerate();
        break;
      case "restore":
        setConfirmation(null);
        void doRestore();
        break;
      case "workout-type":
        dayEditor.applyWorkoutTypeChange(confirmation.change);
        setConfirmation(null);
        break;
      case "day-swap":
        dayEditor.swapDaysByRef(confirmation.a, confirmation.b);
        notify(t("manage.planInstances.daySwapped", "Days swapped — remember to Save."));
        setConfirmation(null);
        break;
      case "week-swap":
        dayEditor.swapWeeksByRef(confirmation.a, confirmation.b);
        notify(t("manage.planInstances.weekSwapped", "Weeks swapped — remember to Save."));
        setConfirmation(null);
        break;
      case "delete":
        void onDelete(confirmation.instanceId);
        break;
      // HRA-249: single acknowledgement, nothing to confirm — the overlap
      // block has no "Activate anyway" override, so this just dismisses.
      case "activation-conflict":
        setConfirmation(null);
        break;
    }
  }

  // HRA-126, amended HRA-249: once approved, only the top form fields
  // (fieldDisabled below) stay locked — Save/day-edit/Approve no longer
  // force-disable, replaced by a persistent WarningBanner in
  // renderEditorFields(). Activation itself stays hard-gated, but by the
  // backend's own overlap check (onApprove above), not by this flag.
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
  // Never true before an instance exists (fieldsLocked false); regenerateBucketDirty
  // stays forced false once approved (Regenerate is unchanged, still locked by
  // HRA-126 — out of this Story's scope), but saveBucketDirty (folded into
  // isDirty) now also reflects a day edit on an approved row (HRA-249).
  const {
    regenerateBucketDirty, saveEnabled, regenerateDisabled, isDirty,
  } = selectDirtyState(editor.state, { fieldsLocked, isApproved, regenerateLoading });
  // HRA-249: Restore's own "is there anything to discard" check — isDirty
  // above is always false before an instance exists (fieldsLocked false),
  // so the "new" draft row instead asks whether anything was typed into it
  // at all (same hasEnteredData the template-switch confirm already uses).
  const restoreDirty = fieldsLocked ? isDirty : hasEnteredData(editor.state);

  // HRA-141: everything that used to render as the whole `mode === "plan"`
  // screen (minus the outer Card/title-badge header, which the accordion's
  // own row title now covers) — shared by every row's AccordionCard, only
  // ever actually rendered for whichever one is expanded (each call site
  // gates on `activeKey === key` before calling this).
  function renderEditorFields() {
    return (
      <>
        <PlanInstanceFormFields
          templates={templates}
          templateId={templateId}
          onTemplateSelectChange={onTemplateSelectChange}
          fieldsLocked={fieldsLocked}
          instName={instName}
          setInstName={setInstName}
          raceName={raceName}
          setRaceName={setRaceName}
          raceDate={raceDate}
          onRaceDateChange={onRaceDateChange}
          raceUrl={raceUrl}
          setRaceUrl={setRaceUrl}
          fieldDisabled={fieldDisabled}
          formEnabled={formEnabled}
          startDate={startDate}
          onStartDateChange={onStartDateChange}
          daysBeforeRace={daysBeforeRace}
          onDaysBeforeRaceChange={onDaysBeforeRaceChange}
          restDayLabel={restDayLabel}
          setRestDayLabel={setRestDayLabel}
          showWeek1AnchorWarning={showWeek1AnchorWarning}
          racePaceAnchor={racePaceAnchor}
          onRacePaceAnchorChange={onRacePaceAnchorChange}
          templateAnchors={templateAnchors}
          paceMode={paceMode}
          setPaceMode={setPaceMode}
          hasRacePaceAnchor={hasRacePaceAnchor}
          goalTimeDisplayValue={goalTimeDisplayValue}
          onGoalTimeInput={onGoalTimeInput}
          equivalentGoalTimeSec={equivalentGoalTimeSec}
          showDistanceOverride={showDistanceOverride}
          distanceM={distanceM}
          setDistanceM={setDistanceM}
        />

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
        {/* HRA-249: replaces the old hard lock on Save/day-edit/Approve —
            editing an already-active plan is now allowed, this just says so. */}
        {fieldsLocked && isApproved && (
          <WarningBanner message={t("manage.planInstances.approvedEditWarning", "This race plan is already active — you can still make changes here.")} />
        )}

        <PlanInstanceEditorActions
          fieldsLocked={fieldsLocked}
          instantiateLoading={instantiateLoading}
          canInstantiate={canInstantiate}
          onInstantiate={onInstantiate}
          saveLoading={saveLoading}
          hasSections={sections.length > 0}
          isApproved={isApproved}
          saveEnabled={saveEnabled}
          onSaveClick={onSaveClick}
          approveLoading={approveLoading}
          editingId={editingId}
          onApprove={onApprove}
          regenerateLoading={regenerateLoading}
          regenerateDisabled={regenerateDisabled}
          regenerateBucketDirty={regenerateBucketDirty}
          onRegenerateClick={onRegenerateClick}
          effectiveFrom={effectiveFrom}
          setEffectiveFrom={setEffectiveFrom}
          minEffectiveFrom={minEffectiveFrom}
          isDirty={restoreDirty}
          onRestoreClick={onRestoreClick}
          viewMode={viewMode}
          setViewMode={setViewMode}
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
            <div className="hra-plan-instance-section-gap">
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
                // HRA-249: no longer tied to approval — editing an active
                // plan is allowed (WarningBanner above says so instead).
                readOnlyDays={false}
                onDaySwap={onDayDragSwap}
                onWeekSwap={onWeekDragSwap}
                onScheduledTimeEdit={onScheduledTimeEdit}
                onWorkoutTypeEdit={onWorkoutTypeEdit}
                isDayDirty={day => day.date != null && persistedDsl[day.date] !== undefined && persistedDsl[day.date] !== day.dsl}
                onExportDayFit={onExportDayFit}
                onExportSectionFit={onExportSectionFit}
                onExportWeekFit={onExportWeekFit}
                highlightedRef={highlightedRef ?? undefined}
              />
            ) : (
              <PlanInstanceCalendar
                sections={sections} readOnlyDays={false}
                onScheduledTimeEdit={onScheduledTimeEditByDayId} onDaySwap={onDayDragSwapByDayId}
              />
            )}
          </>
        )}

      </>
    );
  }

  const newDraftPending = activeKey === "new" || drafts["new"] != null;

  return (
    <Card className="hra-instantiate-form">
      <div className="hra-block-title mb-1" >{t("manage.planInstances.title", "Race plans")}</div>
      <div className="hra-text-secondary text-meta mb-3" >
        {t("manage.planInstances.description", "A concrete race plan generated from a plan template for one race — resolved paces, a start date, and (optionally) a linked race activity.")}
      </div>
      {listError && <ErrorBanner message={listError} />}

      {instances === null ? (
        <div className="hra-text-muted text-meta" >{t("manage.planInstances.loading", "Loading…")}</div>
      ) : (
        <div className="flex flex-col gap-2 mb-3">
          {newDraftPending && (
            <PlanInstanceRow
              instance={null}
              newInstanceName={instName}
              expanded={activeKey === "new"}
              hasDraft={drafts["new"] != null}
              onToggle={() => onToggleRow("new", isDirty)}
            >
              {activeKey === "new" ? renderEditorFields() : null}
            </PlanInstanceRow>
          )}
          {instances.length === 0 && !newDraftPending ? (
            <div className="hra-text-muted text-meta" >{t("manage.planInstances.empty", "No instances created yet.")}</div>
          ) : (
            instances.map(inst => (
              <PlanInstanceRow
                key={inst.id}
                instance={inst}
                expanded={activeKey === inst.id}
                hasDraft={drafts[String(inst.id)] != null}
                onToggle={() => onToggleRow(inst.id, isDirty)}
                onDeleteClick={id => setConfirmation({ type: "delete", instanceId: id })}
              >
                {activeKey === inst.id ? renderEditorFields() : null}
              </PlanInstanceRow>
            ))
          )}
        </div>
      )}
      {deleteError && <ErrorBanner message={deleteError} />}
      <button className="hra-btn" data-variant="accent" onClick={() => onToggleRow("new", isDirty)} disabled={newDraftPending || !templates || templates.length === 0}>
        {t("manage.planInstances.newInstance", "Create race plan")}
      </button>
      {templates && templates.length === 0 && (
        <div className="hra-text-muted text-meta mt-1.5" >{t("manage.planInstances.noTemplates", "Save a plan template first — a race plan is always created from one.")}</div>
      )}

      <PlanInstanceConfirmations
        confirmation={confirmation}
        sections={sections}
        onConfirm={confirmPendingAction}
        onCancel={() => setConfirmation(null)}
      />
    </Card>
  );
}
