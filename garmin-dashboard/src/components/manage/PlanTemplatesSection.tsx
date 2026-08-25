/**
 * PlanTemplatesSection.tsx (HRA-117, accordion-based editing HRA-140)
 * Plans tab card: list/create/edit/approve/delete RunPlan DSL v1 templates
 * (docs/runplan-dsl.md), built on top of the shared accordion (HRA-116) and
 * the plan-templates backend (HRA-111 through HRA-115). This file owns all
 * the state/API wiring HRA-116 deliberately left out of the accordion
 * itself: create via paste/upload, generate-preview, content-anchored
 * dsl_source patching on edit (domain/runplan-patch.ts), save, approve,
 * delete.
 *
 * HRA-140: the earlier `mode: "list" | "editor"` full-screen swap is gone —
 * each list row is now its own `AccordionCard` (ui/AccordionCard.tsx, the
 * same single-expand pattern SettingsTab already uses), expanding in place
 * to reveal the exact same editor fields the old `mode === "editor"` screen
 * showed. Only ONE row's edits live in the "live" editor state at a time
 * (name/event/distanceValue/editor/planWarnings below) — same single-active-
 * editor architecture as before, just keyed by `activeKey` instead of a
 * page-level mode. What's new: collapsing a DIRTY row (or switching to a
 * different row while one is dirty) doesn't discard the edit — it stashes a
 * lightweight snapshot into `drafts` (keyed by template id, or `"new"` for
 * an unsaved template) so re-expanding that same row restores exactly what
 * was there, and a warning icon shows on any collapsed-but-drafted row until
 * it's actually Saved or Restored (Ask #3/#4). Switching rows itself never
 * confirms — nothing is lost, just tucked away; only Restore (an actual
 * discard) does.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { Card, ErrorBanner, Badge, Select, AccordionCard } from "@/components/ui";
import { TrainingPlanAccordion } from "@/components/TrainingPlanAccordion";
import { PlanTemplateHelpModal } from "@/components/manage/PlanTemplateHelpModal";
import { buildTemplateSectionView, type SectionView } from "@/domain/runplan-aggregate";
import { recomposeDayLine, replaceSpan, serializeSectionHeader, serializeWeekHeader, splitNote } from "@/domain/runplan-patch";
import { getUnitSystem } from "@/utils/units";
import { notify } from "@/utils/toast";
import type { PlanTemplate } from "@/types/api";
import type { EventType, ParseWarning } from "@/types/runplan";

interface EditorState { dslSource: string; sections: SectionView[] }

const EMPTY_EDITOR: EditorState = { dslSource: "", sections: [] };

// HRA-120: event is now an explicit, required template field (replacing the
// old DSL-text EVENT line); distance_m is required only for "custom".
const EVENT_OPTIONS: readonly EventType[] = ["5k", "10k", "half", "marathon", "custom"];

// Custom-event distance can be entered in km or mi (a custom event covers
// anything from a 50km ultra to a 100-mile one) — the input holds the raw
// typed value in whichever unit is active; distance_m (what the API wants)
// is only derived at the load/submit boundary, never on every keystroke, so
// switching units mid-typing can't mangle a half-typed decimal.
type DistanceUnit = "km" | "mi";
// Mirrors garmin-stats/src/domain/runplan/parser.ts's M_PER_MILE.
const M_PER_MILE = 1609.34;

// HRA-140: what gets stashed when a dirty row is collapsed or switched away
// from — everything needed to restore the live editor state on reopen
// (`editor.sections` itself isn't stashed; it's cheap to rebuild via
// runGenerate against the stashed dslSource, and stashing a resolved
// SectionView[] tree would be redundant state that could drift from it).
interface Draft { name: string; event: EventType | ""; distanceValue: string; distanceUnit: DistanceUnit; dslSource: string }
// A row's identity: an existing template's real id, or "new" for the
// not-yet-saved draft row. String-keyed in `drafts` (object keys are always
// strings) but kept as this union everywhere else for type safety.
type RowKey = number | "new";

function defaultDistanceUnit(): DistanceUnit {
  return getUnitSystem() === "imperial" ? "mi" : "km";
}

// Mirrors garmin-stats/src/controllers/plan-templates.controller.ts's own
// STANDARD_DISTANCE_M — a known event type's distance is fixed and always
// known upfront, unlike "custom" (no entry here), so the field can be
// filled and locked read-only the moment the event type is picked.
const STANDARD_DISTANCE_M: Partial<Record<EventType, number>> = {
  "5k": 5000, "10k": 10000, half: 21097.5, marathon: 42195,
};

function metersToDistance(meters: number, unit: DistanceUnit): string {
  const value = unit === "km" ? meters / 1000 : meters / M_PER_MILE;
  return String(Math.round(value * 1000) / 1000);
}

function distanceToMeters(value: string, unit: DistanceUnit): number | undefined {
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n)) return undefined;
  return unit === "km" ? n * 1000 : n * M_PER_MILE;
}

// A generated plan's own race day (tagged "[race]", the golden-fixture
// convention documented in docs/runplan-dsl.md) is a strong signal for
// "the event's actual distance" — only trusted when it's a real distance
// literal (day.distance.approximate: false), never one estimated from a
// duration target, since a duration-only plan gives no reliable distance to
// guess from at all.
function findRaceDayDistanceMeters(sections: SectionView[]): number | undefined {
  for (const section of sections) {
    for (const week of section.weeks) {
      for (const day of week.days) {
        if (day.category?.trim().toLowerCase() === "race" && !day.distance.approximate && day.distance.meters > 0) {
          return day.distance.meters;
        }
      }
    }
  }
  return undefined;
}

function hasOutstandingWarnings(editor: EditorState, planWarnings: ParseWarning[]): boolean {
  if (planWarnings.length > 0) return true;
  return editor.sections.some(s => s.weeks.some(w => w.days.some(d => d.needs_review)));
}

// A known event type's distance is always the fixed standard one —
// distance_m is never saved for these (the backend rejects it). For
// "custom", distance_m lives inside the saved parsed_plan's own metadata
// (HRA-120: sourced from the request body at save time, not DSL text) —
// shared by startEdit (fresh load) and reopenExisting (restoring a stashed
// draft), so the "what does this template's own persisted distance read as"
// logic exists in exactly one place.
function resolvePersistedDistanceValue(template: PlanTemplate, tplEvent: EventType | "", unit: DistanceUnit): string {
  const standard = tplEvent !== "" ? STANDARD_DISTANCE_M[tplEvent] : undefined;
  if (standard != null) return metersToDistance(standard, unit);
  try {
    const parsed = JSON.parse(template.parsed_plan) as { metadata?: { distance_m?: number } };
    const distM = parsed.metadata?.distance_m;
    return distM != null ? metersToDistance(distM, unit) : "";
  } catch { return ""; }
}

interface Props {
  // Lifted to PlansTab (not fetched here) so PlanInstancesSection's own
  // template picker/list stays in sync with a save/delete happening in this
  // card — both are siblings mounted on the same tab, each independently
  // fetching its own copy would otherwise go stale the moment the other one
  // changes something.
  templates: PlanTemplate[] | null;
  templatesError: string | null;
  refreshTemplates: () => Promise<void>;
}

export function PlanTemplatesSection({ templates, templatesError, refreshTemplates }: Props) {
  const { t } = useTranslation();

  // HRA-140: which row is expanded — an existing template's id, "new" for
  // the unsaved-draft row, or null (every row collapsed). Replaces the old
  // page-level `mode`; `editingId` is now derived from this, not its own
  // state, since the two could never legitimately disagree.
  const [activeKey, setActiveKey] = useState<RowKey | null>(null);
  const editingId = typeof activeKey === "number" ? activeKey : null;

  const [showHelp, setShowHelp] = useState(false);
  const [savedDslSource, setSavedDslSource] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [event, setEvent] = useState<EventType | "">("");
  const [distanceValue, setDistanceValue] = useState("");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(defaultDistanceUnit());
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [planWarnings, setPlanWarnings] = useState<ParseWarning[]>([]);

  // HRA-140: the active row's own "last saved/loaded" snapshot — what
  // isEditorDirty() below diffs the live fields against. `savedDslSource`
  // above already served this exact role for dslSource (canApprove already
  // relied on it), reused rather than duplicated.
  const [baselineName, setBaselineName] = useState("");
  const [baselineEvent, setBaselineEvent] = useState<EventType | "">("");
  const [baselineDistanceValue, setBaselineDistanceValue] = useState("");

  // HRA-140: rows with unsaved edits that are currently collapsed (or were
  // never the active row to begin with, if a *different* row's live edits
  // just got stashed here). Presence of a key drives the warning icon
  // (Ask #4); an entry is removed on a successful Save or an explicit
  // Restore (Ask #3), never just by reopening the row.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // HRA-140 Ask #3: confirm gate before Restore actually discards — only
  // shown when the active row is genuinely dirty; a clean row restores
  // (closes) immediately.
  const [pendingRestoreConfirm, setPendingRestoreConfirm] = useState(false);

  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [approveLoading, setApproveLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Tracks the dslSource the accordion's *current* preview was generated
  // from — lets the debounced auto-regenerate effect below know whether
  // there's actually anything new to preview, without re-triggering itself
  // off its own setEditor call (which doesn't change dslSource).
  const lastGeneratedRef = useRef<string | null>(null);

  function resetEditorState() {
    setSavedDslSource(null); setName(""); setEvent("");
    setDistanceValue(""); setDistanceUnit(defaultDistanceUnit());
    setEditor(EMPTY_EDITOR);
    setBaselineName(""); setBaselineEvent(""); setBaselineDistanceValue("");
    setPlanWarnings([]); setGenError(null); setPatchError(null); setSaveError(null);
    lastGeneratedRef.current = null;
  }

  // HRA-140: whether the currently-active row's live fields differ from its
  // own last-saved/loaded baseline — the single source of truth for both
  // the Restore confirm gate (Ask #3) and what gets stashed on collapse
  // (Ask #4).
  function isEditorDirty(): boolean {
    return editor.dslSource !== (savedDslSource ?? "")
      || name !== baselineName
      || event !== baselineEvent
      || distanceValue !== baselineDistanceValue;
  }

  // Switches which unit the (already-typed) distance value displays as,
  // converting through meters so the number itself doesn't change — only
  // its presentation does. Read-only outside Custom — a known event's
  // distance/unit are fixed the moment the event type is picked, not
  // user-selectable (the toggle stays visually normal, just inert).
  function switchDistanceUnit(unit: DistanceUnit) {
    if (event !== "custom") return;
    if (unit === distanceUnit) return;
    const meters = distanceToMeters(distanceValue, distanceUnit);
    setDistanceUnit(unit);
    setDistanceValue(meters != null ? metersToDistance(meters, unit) : "");
  }

  // A known event type's distance is fixed and always filled, read-only,
  // the moment it's picked — Custom always resets Distance back to empty
  // (never keeps a stale standard-event number around) and is the only
  // event type where the field/toggle become writable.
  function onEventChange(next: EventType) {
    setEvent(next);
    if (next === "custom") {
      setDistanceValue("");
      return;
    }
    const standard = STANDARD_DISTANCE_M[next];
    if (standard != null) setDistanceValue(metersToDistance(standard, distanceUnit));
  }

  function startCreate() {
    resetEditorState();
  }

  // autoFillDistance defaults to on (fresh create/paste/upload flows) but is
  // explicitly off from startEdit/reopenExisting: a loaded template's own
  // distanceValue is set via setDistanceValue just before runGenerate is
  // called there, and since that setState hasn't been applied to this
  // render's closure yet (state updates aren't visible synchronously within
  // the same callback that queued them), the check below would see the
  // pre-update "" and clobber the just-loaded real distance with a
  // re-guessed one — auto-fill is a create-time nicety only, never a
  // substitute for the template's own saved value.
  async function runGenerate(dslSource: string, opts: { autoFillDistance?: boolean } = {}) {
    const autoFillDistance = opts.autoFillDistance ?? true;
    setGenLoading(true); setGenError(null); setPatchError(null);
    try {
      const { plan, warnings } = await api.planTemplates.generate(dslSource);
      lastGeneratedRef.current = dslSource;
      setPlanWarnings(warnings);
      const sections = plan.sections.map(s => buildTemplateSectionView(s, plan.metadata.pace_policy));
      setEditor({ dslSource, sections });
      // Auto-fill the custom-event distance from the plan's own race day the
      // first time it generates with nothing typed yet — never overwrites a
      // value the user already entered. The DSL's own UNIT declaration is a
      // solid guess for which unit that distance was authored in — "almost
      // sure", per the plan text itself, unless the plan has no real
      // distance day to find at all (duration-only plans).
      if (autoFillDistance && distanceValue.trim() === "") {
        const raceMeters = findRaceDayDistanceMeters(sections);
        if (raceMeters != null) {
          setDistanceUnit(plan.metadata.unit);
          setDistanceValue(metersToDistance(raceMeters, plan.metadata.unit));
        }
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : t("manage.planTemplates.generateFailed", "Failed to parse the DSL text"));
    }
    setGenLoading(false);
  }

  async function startEdit(template: PlanTemplate) {
    resetEditorState();
    const tplEvent = (template.event as EventType | null) ?? "";
    setEvent(tplEvent); setBaselineEvent(tplEvent);
    const unit = defaultDistanceUnit();
    setDistanceUnit(unit);
    const resolvedDistance = resolvePersistedDistanceValue(template, tplEvent, unit);
    setDistanceValue(resolvedDistance); setBaselineDistanceValue(resolvedDistance);
    setName(template.name); setBaselineName(template.name);
    setSavedDslSource(template.dsl_source);
    setEditor({ dslSource: template.dsl_source, sections: [] });
    await runGenerate(template.dsl_source, { autoFillDistance: false });
  }

  // HRA-140: restores a previously-stashed draft's fields into the live
  // editor state, WITHOUT touching the baseline* fields — those must still
  // reflect the template's real persisted values (or the empty defaults for
  // an unsaved "new" draft), never the draft itself, or isEditorDirty()
  // would read false the instant a genuinely-dirty draft reopens.
  async function reopenDraft(draft: Draft, template: PlanTemplate | undefined) {
    setGenError(null); setPatchError(null); setSaveError(null);
    setName(draft.name); setEvent(draft.event);
    setDistanceValue(draft.distanceValue); setDistanceUnit(draft.distanceUnit);
    if (template) {
      setSavedDslSource(template.dsl_source);
      setBaselineName(template.name);
      setBaselineEvent((template.event as EventType | null) ?? "");
      setBaselineDistanceValue(resolvePersistedDistanceValue(template, (template.event as EventType | null) ?? "", draft.distanceUnit));
    } else {
      setSavedDslSource(null);
      setBaselineName(""); setBaselineEvent(""); setBaselineDistanceValue("");
    }
    lastGeneratedRef.current = null;
    await runGenerate(draft.dslSource, { autoFillDistance: false });
  }

  // HRA-140: called before switching away from whatever row is currently
  // active (collapsing it, or opening a different row) — stashes a draft
  // if genuinely dirty, or drops any stale stash if the row turned out
  // clean (e.g. the user typed something then typed it back to the
  // original value before collapsing).
  function stashCurrentIfDirty() {
    if (activeKey == null) return;
    const key = String(activeKey);
    if (isEditorDirty()) {
      setDrafts(prev => ({ ...prev, [key]: { name, event, distanceValue, distanceUnit, dslSource: editor.dslSource } }));
    } else {
      setDrafts(prev => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
    }
  }

  // HRA-140: the single entry point for both the "+ New template" button
  // and every row's own AccordionCard toggle — stashes whatever was
  // previously open (never a discard, see stashCurrentIfDirty), then either
  // collapses everything (re-clicking the already-open row) or opens the
  // requested row, restoring its stashed draft if one exists.
  async function onToggleRow(key: RowKey) {
    // The delete-confirm modal now lives inside the panel it belongs to
    // (review fix, below) — closing or switching away from a row must not
    // leave it staged, or reopening that same row later would pop the
    // confirm modal back up unprompted.
    setDeleteConfirmId(null);
    if (activeKey === key) {
      stashCurrentIfDirty();
      setActiveKey(null);
      return;
    }
    stashCurrentIfDirty();
    setActiveKey(key);
    const draft = drafts[String(key)];
    if (draft) {
      const template = key === "new" ? undefined : templates?.find(tpl => tpl.id === key);
      await reopenDraft(draft, template);
    } else if (key === "new") {
      startCreate();
    } else {
      const template = templates?.find(tpl => tpl.id === key);
      if (template) await startEdit(template);
    }
  }

  async function onFileUpload(file: File) {
    const text = await file.text();
    setEditor({ dslSource: text, sections: [] });
    setPlanWarnings([]);
  }

  // Auto-regenerate the preview a beat after any edit — editing a Section/
  // Week/Day field, pasting fresh text, or uploading a file all change
  // editor.dslSource without themselves calling generate() (see each edit
  // handler below, and onFileUpload/the raw textarea's onChange). Without
  // this, the accordion's totals/warnings and Save's real enabled state
  // stay stale until the user notices and clicks "Generate / refresh
  // preview" themselves — debounced (not per-keystroke) to avoid a request
  // per character typed, per the same reasoning HRA-117 documented for not
  // auto-generating originally; the manual button stays available for an
  // instant refresh.
  useEffect(() => {
    if (activeKey == null) return;
    if (editor.dslSource.trim() === "") return;
    if (editor.dslSource === lastGeneratedRef.current) return;
    const timer = setTimeout(() => { runGenerate(editor.dslSource); }, 700);
    return () => clearTimeout(timer);
  }, [editor.dslSource, activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSectionEdit(sectionIndex: number, patch: { name?: string; notes?: string }) {
    setPatchError(null);
    setEditor(prev => {
      const section = prev.sections[sectionIndex];
      if (section.raw_dsl === "") return prev; // implicit default section — no header line to patch (see HRA-116's own note)
      let newRawDsl: string;
      try { newRawDsl = serializeSectionHeader(section.raw_dsl, patch); } catch (e) {
        setPatchError(e instanceof Error ? e.message : String(e)); return prev;
      }
      const result = replaceSpan(prev.dslSource, section.raw_dsl, newRawDsl);
      if (!result.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }
      const sections = [...prev.sections];
      sections[sectionIndex] = { ...section, name: patch.name ?? section.name, notes: patch.notes ?? section.notes, raw_dsl: newRawDsl };
      return { dslSource: result.source, sections };
    });
  }

  function onWeekEdit(sectionIndex: number, weekIndex: number, patch: { notes?: string }) {
    setPatchError(null);
    setEditor(prev => {
      const section = prev.sections[sectionIndex];
      const week = section.weeks[weekIndex];
      let newRawDsl: string;
      try { newRawDsl = serializeWeekHeader(week.raw_dsl, patch); } catch (e) {
        setPatchError(e instanceof Error ? e.message : String(e)); return prev;
      }
      const result = replaceSpan(prev.dslSource, week.raw_dsl, newRawDsl);
      if (!result.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }
      const weeks = [...section.weeks];
      weeks[weekIndex] = { ...week, notes: patch.notes ?? week.notes, raw_dsl: newRawDsl };
      const sections = [...prev.sections];
      sections[sectionIndex] = { ...section, weeks };
      return { dslSource: result.source, sections };
    });
  }

  function onDayEdit(sectionIndex: number, weekIndex: number, dayIndex: number, patch: { dsl?: string; notes?: string }) {
    setPatchError(null);
    setEditor(prev => {
      const section = prev.sections[sectionIndex];
      const week = section.weeks[weekIndex];
      const day = week.days[dayIndex];
      const newLine = recomposeDayLine(day.dsl, patch);
      const result = replaceSpan(prev.dslSource, day.dsl, newLine);
      if (!result.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }
      const days = [...week.days];
      days[dayIndex] = { ...day, dsl: newLine, notes: splitNote(newLine).note };
      const weeks = [...section.weeks];
      weeks[weekIndex] = { ...week, days };
      const sections = [...prev.sections];
      sections[sectionIndex] = { ...section, weeks };
      return { dslSource: result.source, sections };
    });
  }

  // Fixed width (the longest option in the current language, plus room for
  // the trigger's icon/padding) so picking a shorter/longer event type never
  // shifts the layout — computed from the live-translated labels rather than
  // hardcoded per language.
  const eventOptions = EVENT_OPTIONS.map(v => ({ value: v, label: t(`manage.planTemplates.event.${v}`, v) }));
  const eventPlaceholder = t("manage.planTemplates.eventPlaceholder", "Pick an event type…");
  const eventSelectWidth = Math.max(...eventOptions.map(o => o.label.length), eventPlaceholder.length) + 3;

  const generated = editor.sections.length > 0;
  const isCustomEvent = event === "custom";
  const canSave = generated && !hasOutstandingWarnings(editor, planWarnings) && name.trim() !== ""
    && event !== "" && (!isCustomEvent || distanceValue.trim() !== "");
  const canApprove = editingId != null && savedDslSource === editor.dslSource && !hasOutstandingWarnings(editor, planWarnings);

  async function onSave() {
    if (event === "") return;
    setSaveLoading(true); setSaveError(null);
    try {
      const distance = isCustomEvent ? distanceToMeters(distanceValue, distanceUnit) : undefined;
      const saved = editingId
        ? await api.planTemplates.update(editingId, name, event, editor.dslSource, distance)
        : await api.planTemplates.create(name, event, editor.dslSource, distance);
      // HRA-140: the row this draft belonged to just got persisted — drop
      // its stash (whichever key it was under: "new" the first time, or its
      // own numeric id on a later re-save) and re-baseline everything to
      // what was just saved, so the row reads clean immediately.
      setDrafts(prev => { const key = activeKey != null ? String(activeKey) : null; if (key == null || !(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
      setActiveKey(saved.id);
      setSavedDslSource(saved.dsl_source);
      setBaselineName(name); setBaselineEvent(event); setBaselineDistanceValue(distanceValue);
      await refreshTemplates();
      notify(t("manage.planTemplates.saveSucceeded", "Template saved."));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("manage.planTemplates.saveFailed", "Failed to save template"));
    }
    setSaveLoading(false);
  }

  async function onApprove() {
    if (editingId == null) return;
    setApproveLoading(true);
    try {
      await api.planTemplates.approve(editingId);
      await refreshTemplates();
      notify(t("manage.planTemplates.approveSucceeded", "Template approved."));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("manage.planTemplates.approveFailed", "Failed to approve template"));
    }
    setApproveLoading(false);
  }

  // HRA-140 Ask #3: "Restore" (renamed from Cancel) discards the active
  // row's unsaved edits and collapses it — since the list row itself only
  // ever displays the real persisted `templates` data (never mutated by
  // local typing), simply resetting local state + collapsing IS "reverting
  // to the last-saved values"; there's nothing to re-populate. Gated on a
  // confirm only when genuinely dirty.
  function onRestoreClick() {
    if (isEditorDirty()) { setPendingRestoreConfirm(true); return; }
    doRestore();
  }
  function doRestore() {
    setPendingRestoreConfirm(false);
    if (activeKey != null) {
      const key = String(activeKey);
      setDrafts(prev => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
    }
    resetEditorState();
    setActiveKey(null);
  }
  function cancelRestoreConfirm() { setPendingRestoreConfirm(false); }

  async function onDelete(id: number) {
    setDeleteError(null);
    try {
      await api.planTemplates.remove(id);
      setDeleteConfirmId(null);
      setDrafts(prev => { const key = String(id); if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
      if (activeKey === id) { resetEditorState(); setActiveKey(null); }
      await refreshTemplates();
      notify(t("manage.planTemplates.deleteSucceeded", "Template deleted."));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t("manage.planTemplates.deleteFailed", "Failed to delete template"));
    }
  }

  // HRA-140 Ask #2/#4: a collapsed row's own status hint — a drafted (dirty
  // but collapsed) row gets the warning icon; any other collapsed row gets
  // the plain "Open to edit" hint (this reads correctly for a genuinely
  // never-opened row, and equally correctly for a row that was opened,
  // found clean, and collapsed again — both have nothing pending, so both
  // just invite a click).
  function rowStatusHint(key: RowKey) {
    if (drafts[String(key)]) {
      return (
        <span
          title={t("manage.planTemplates.unsavedChanges", "Unsaved changes")}
          className="hra-text-warning"
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          <AlertTriangle size={14} />
        </span>
      );
    }
    return (
      <span className="hra-text-secondary" style={{ fontSize: 11, fontStyle: "italic" }}>
        {t("manage.planTemplates.openToEditHint", "Open to edit")}
      </span>
    );
  }

  function renderRowTitle(tpl: PlanTemplate) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tpl.name}</span>
        {tpl.event && <span className="hra-text-muted" style={{ fontSize: 11 }}>{t(`manage.planTemplates.event.${tpl.event}`, tpl.event)}</span>}
        <Badge
          label={tpl.approved_at ? t("manage.planTemplates.approved", "Approved") : t("manage.planTemplates.notApproved", "Not approved")}
          color={tpl.approved_at ? "var(--accent-green)" : "var(--text-muted)"}
        />
        {activeKey !== tpl.id && rowStatusHint(tpl.id)}
      </span>
    );
  }

  // Shared by every row's AccordionCard — only ever actually rendered for
  // whichever one is expanded (each call site gates on `activeKey === key`
  // before calling this), since AccordionCard itself only mounts children
  // while `expanded`.
  function renderEditorFields() {
    return (
      <>
        {/* Fixed widths, no flex-grow, on every field (CLAUDE.md's "no moving
            UI" rule). Distance/km-mi stay on screen at all times (not
            conditionally mounted) — only their enabled state depends on
            Event type — so nothing ever appears/disappears in this row. */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 400px" }}>
            {t("manage.planTemplates.nameLabel", "Name")}
            <input
              className="hra-border-strong hra-bg-card hra-text-primary"
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: 6 }}
            />
          </label>

          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto" }}>
            {t("manage.planTemplates.eventLabel", "Event type")}
            <div style={{ marginTop: 4 }}>
              <Select
                value={event}
                onValueChange={v => onEventChange(v as EventType)}
                options={eventOptions}
                placeholder={eventPlaceholder}
                triggerStyle={{ width: `${eventSelectWidth}ch` }}
              />
            </div>
          </label>

          {/* Always shown, always full-opacity ("visually enabled") — a known
              event type's distance is fixed and filled the instant it's
              picked (onEventChange above); readOnly/an inert toggle just mean
              it can be seen and selected/copied but not changed, unlike
              disabled which would also dim it. Only Custom makes both
              writable. */}
          <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto" }}>
            {t("manage.planTemplates.distanceLabel", "Distance")}
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <input
                className="hra-border-strong hra-bg-card hra-text-primary"
                value={distanceValue}
                onChange={e => setDistanceValue(e.target.value)}
                type="number"
                readOnly={!isCustomEvent}
                style={{ width: 100, padding: 6 }}
              />
              <div className="hra-segment">
                <button className="hra-segment-item" data-active={distanceUnit === "km"} onClick={() => switchDistanceUnit("km")}>km</button>
                <button className="hra-segment-item" data-active={distanceUnit === "mi"} onClick={() => switchDistanceUnit("mi")}>mi</button>
              </div>
            </div>
          </label>
        </div>

        <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
          {t("manage.planTemplates.dslSourceLabel", "DSL text")}
          <textarea
            className="hra-border-strong hra-bg-card hra-text-primary"
            value={editor.dslSource}
            onChange={e => setEditor({ dslSource: e.target.value, sections: [] })}
            rows={8}
            style={{ width: "100%", marginTop: 4, fontFamily: "monospace", fontSize: 12, padding: 8 }}
          />
        </label>

        <div className="hra-row-wrap" style={{ marginBottom: 12 }}>
          <label className="hra-btn" style={{ cursor: "pointer" }}>
            {t("manage.planTemplates.uploadFile", "Upload .txt/.csv…")}
            <input
              type="file" accept=".txt,.csv" style={{ display: "none" }}
              onChange={e => { const file = e.target.files?.[0]; if (file) onFileUpload(file); e.target.value = ""; }}
            />
          </label>
          <button className="hra-btn" onClick={() => runGenerate(editor.dslSource)} disabled={genLoading || editor.dslSource.trim() === ""}>
            {genLoading ? t("manage.planTemplates.generating", "Parsing…") : t("manage.planTemplates.generateButton", "Generate / refresh preview")}
          </button>
          <button className="hra-btn" data-variant="green" onClick={onSave} disabled={!canSave || saveLoading}>
            {saveLoading ? t("common.saving", "Saving…") : t("common.save", "Save")}
          </button>
          <button className="hra-btn" onClick={onApprove} disabled={!canApprove || approveLoading}>
            {approveLoading ? t("manage.planTemplates.approving", "Approving…") : t("manage.planTemplates.approveButton", "Approve")}
          </button>
          <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={onRestoreClick}>
            {t("common.restore", "Restore")}
          </button>
          {/* HRA-140 review: Delete lives INSIDE the accordion's own panel now,
              not as a sibling button beside it — AccordionCard.tsx's header is
              a real <button>, so this was never nestable in the collapsed
              header either way; a plain icon button here needs no such
              workaround, and nothing sits outside the accordion anymore. Only
              shown for an existing (already-saved) template — nothing to
              delete yet for a "new" draft. */}
          {editingId != null && (
            <button
              className="hra-btn" data-variant="danger"
              onClick={() => setDeleteConfirmId(editingId)}
              title={t("common.delete", "Delete")}
              aria-label={t("common.delete", "Delete")}
              style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px" }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>

        {genError && <ErrorBanner message={genError} />}
        {patchError && <ErrorBanner message={patchError} />}
        {saveError && <ErrorBanner message={saveError} />}

        {planWarnings.length > 0 && (
          <ul className="hra-text-danger" style={{ fontSize: 12, marginBottom: 12 }}>
            {planWarnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        )}

        {generated && (
          <TrainingPlanAccordion
            ownerName={name || t("manage.planTemplates.untitled", "Untitled plan")}
            sections={editor.sections}
            onSectionEdit={onSectionEdit}
            onWeekEdit={onWeekEdit}
            onDayEdit={onDayEdit}
          />
        )}

        {pendingRestoreConfirm && (
          <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={cancelRestoreConfirm}>
            <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth: 360, padding: 20 }} onClick={e => e.stopPropagation()}>
              <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 16 }}>
                {t("manage.planTemplates.restoreConfirmBody", "You have unsaved changes — discard them?")}
              </div>
              <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
                <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={cancelRestoreConfirm}>
                  {t("common.cancel", "Cancel")}
                </button>
                <button className="hra-btn" data-variant="danger" onClick={doRestore}>
                  {t("common.restore", "Restore")}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteConfirmId != null && deleteConfirmId === editingId && (
          <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={() => setDeleteConfirmId(null)}>
            <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth: 360, padding: 20 }} onClick={e => e.stopPropagation()}>
              <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 16 }}>
                {t("manage.planTemplates.deleteConfirm", "Delete? This also removes every instance derived from it.")}
              </div>
              <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
                <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => setDeleteConfirmId(null)}>
                  {t("common.cancel", "Cancel")}
                </button>
                <button className="hra-btn" data-variant="danger" onClick={() => editingId != null && onDelete(editingId)}>
                  {t("common.yesDelete", "Yes, delete")}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  const newDraftPending = activeKey === "new" || drafts["new"] != null;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="hra-block-title">{t("manage.planTemplates.title", "Training-plan templates")}</div>
        <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }} onClick={() => setShowHelp(true)}>
          {t("manage.planTemplates.howToUse", "How to use it")}
        </button>
      </div>
      <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        {t("manage.planTemplates.description", "Reusable RunPlan DSL v1 templates — paced generically (symbolic anchors like RG), instantiated per race with concrete paces and a start date.")}
      </div>
      {showHelp && <PlanTemplateHelpModal onClose={() => setShowHelp(false)} />}
      {templatesError && <ErrorBanner message={templatesError} />}

      {templates === null ? (
        <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("common.loading", "Loading…")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {newDraftPending && (
            <AccordionCard
              title={
                <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  <span>{name || t("manage.planTemplates.createTitle", "New template")}</span>
                  {activeKey !== "new" && rowStatusHint("new")}
                </span>
              }
              expanded={activeKey === "new"}
              onToggle={() => onToggleRow("new")}
            >
              {activeKey === "new" ? renderEditorFields() : null}
            </AccordionCard>
          )}
          {templates.length === 0 && !newDraftPending ? (
            <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.planTemplates.empty", "No templates saved yet.")}</div>
          ) : (
            templates.map(tpl => (
              <AccordionCard key={tpl.id} title={renderRowTitle(tpl)} expanded={activeKey === tpl.id} onToggle={() => onToggleRow(tpl.id)}>
                {activeKey === tpl.id ? renderEditorFields() : null}
              </AccordionCard>
            ))
          )}
        </div>
      )}
      {deleteError && <ErrorBanner message={deleteError} />}
      <button className="hra-btn" data-variant="accent" onClick={() => onToggleRow("new")} disabled={newDraftPending}>
        {t("manage.planTemplates.newTemplate", "New template")}
      </button>
    </Card>
  );
}
