/**
 * PlanTemplatesSection.tsx (HRA-117)
 * Data & Sync card: list/create/edit/approve/delete RunPlan DSL v1 templates
 * (docs/runplan-dsl.md), built on top of the shared accordion (HRA-116) and
 * the plan-templates backend (HRA-111 through HRA-115). This file owns all
 * the state/API wiring HRA-116 deliberately left out of the accordion
 * itself: create via paste/upload, generate-preview, content-anchored
 * dsl_source patching on edit (domain/runplan-patch.ts), save, approve,
 * delete.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Card, ErrorBanner, Badge, Select } from "@/components/ui";
import { TrainingPlanAccordion } from "@/components/TrainingPlanAccordion";
import { buildTemplateSectionView, type SectionView } from "@/domain/runplan-aggregate";
import { recomposeDayLine, replaceSpan, serializeSectionHeader, serializeWeekHeader, splitNote } from "@/domain/runplan-patch";
import { getUnitSystem } from "@/utils/units";
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

function defaultDistanceUnit(): DistanceUnit {
  return getUnitSystem() === "imperial" ? "mi" : "km";
}

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

export function PlanTemplatesSection() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<PlanTemplate[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [mode, setMode] = useState<"list" | "editor">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savedDslSource, setSavedDslSource] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [event, setEvent] = useState<EventType | "">("");
  const [distanceValue, setDistanceValue] = useState("");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(defaultDistanceUnit());
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [planWarnings, setPlanWarnings] = useState<ParseWarning[]>([]);

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

  function refreshList() {
    return api.planTemplates.list().then(setTemplates).catch(e => setListError(e instanceof Error ? e.message : t("manage.planTemplates.loadFailed", "Failed to load templates")));
  }

  useEffect(() => { refreshList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function resetEditorState() {
    setEditingId(null); setSavedDslSource(null); setName(""); setEvent("");
    setDistanceValue(""); setDistanceUnit(defaultDistanceUnit());
    setEditor(EMPTY_EDITOR);
    setPlanWarnings([]); setGenError(null); setPatchError(null); setSaveError(null);
    lastGeneratedRef.current = null;
  }

  // Switches which unit the (already-typed) distance value displays as,
  // converting through meters so the number itself doesn't change — only
  // its presentation does.
  function switchDistanceUnit(unit: DistanceUnit) {
    if (unit === distanceUnit) return;
    const meters = distanceToMeters(distanceValue, distanceUnit);
    setDistanceUnit(unit);
    setDistanceValue(meters != null ? metersToDistance(meters, unit) : "");
  }

  function startCreate() {
    resetEditorState();
    setMode("editor");
  }

  async function startEdit(template: PlanTemplate) {
    resetEditorState();
    setEditingId(template.id);
    setName(template.name);
    setEvent((template.event as EventType | null) ?? "");
    // distance_m isn't a top-level template field — it lives inside the
    // saved parsed_plan's metadata (HRA-120: sourced from the request body
    // at save time, not DSL text).
    try {
      const parsed = JSON.parse(template.parsed_plan) as { metadata?: { distance_m?: number } };
      const distM = parsed.metadata?.distance_m;
      const unit = defaultDistanceUnit();
      setDistanceUnit(unit);
      setDistanceValue(distM != null ? metersToDistance(distM, unit) : "");
    } catch { setDistanceValue(""); }
    setSavedDslSource(template.dsl_source);
    setEditor({ dslSource: template.dsl_source, sections: [] });
    setMode("editor");
    await runGenerate(template.dsl_source, { autoFillDistance: false });
  }

  async function onFileUpload(file: File) {
    const text = await file.text();
    setEditor({ dslSource: text, sections: [] });
    setPlanWarnings([]);
  }

  // autoFillDistance defaults to on (fresh create/paste/upload flows) but is
  // explicitly off from startEdit: a saved template's distanceValue is set
  // via setDistanceValue just before runGenerate is called there, and since
  // that setState hasn't been applied to this render's closure yet (state
  // updates aren't visible synchronously within the same callback that
  // queued them), the check below would see the pre-update "" and clobber
  // the just-loaded real distance with a re-guessed one — auto-fill is a
  // create-time nicety only, never a substitute for the template's own
  // saved value.
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
    if (mode !== "editor") return;
    if (editor.dslSource.trim() === "") return;
    if (editor.dslSource === lastGeneratedRef.current) return;
    const timer = setTimeout(() => { runGenerate(editor.dslSource); }, 700);
    return () => clearTimeout(timer);
  }, [editor.dslSource, mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setEditingId(saved.id);
      setSavedDslSource(saved.dsl_source);
      await refreshList();
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
      await refreshList();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("manage.planTemplates.approveFailed", "Failed to approve template"));
    }
    setApproveLoading(false);
  }

  async function onDelete(id: number) {
    setDeleteError(null);
    try {
      await api.planTemplates.remove(id);
      setDeleteConfirmId(null);
      if (editingId === id) { resetEditorState(); setMode("list"); }
      await refreshList();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t("manage.planTemplates.deleteFailed", "Failed to delete template"));
    }
  }

  if (mode === "list") {
    return (
      <Card>
        <div className="hra-block-title" style={{ marginBottom: 4 }}>{t("manage.planTemplates.title", "Training-plan templates")}</div>
        <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          {t("manage.planTemplates.description", "Reusable RunPlan DSL v1 templates — paced generically (symbolic anchors like RG), instantiated per race with concrete paces and a start date.")}
        </div>
        {listError && <ErrorBanner message={listError} />}
        {templates === null ? (
          <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("common.loading", "Loading…")}</div>
        ) : templates.length === 0 ? (
          <div className="hra-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>{t("manage.planTemplates.empty", "No templates saved yet.")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {templates.map(tpl => (
              <div key={tpl.id} className="hra-border-strong" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8 }}>
                <span className="hra-text-primary" style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{tpl.name}</span>
                {tpl.event && <span className="hra-text-muted" style={{ fontSize: 11 }}>{t(`manage.planTemplates.event.${tpl.event}`, tpl.event)}</span>}
                <Badge
                  label={tpl.approved_at ? t("manage.planTemplates.approved", "Approved") : t("manage.planTemplates.notApproved", "Not approved")}
                  color={tpl.approved_at ? "var(--accent-green)" : "var(--text-muted)"}
                />
                <button className="hra-btn" onClick={() => startEdit(tpl)}>{t("common.edit", "Edit")}</button>
                {deleteConfirmId === tpl.id ? (
                  <>
                    <span className="hra-text-danger" style={{ fontSize: 12 }}>
                      {t("manage.planTemplates.deleteConfirm", "Delete? This also removes every instance derived from it.")}
                    </span>
                    <button className="hra-btn" data-variant="danger" onClick={() => onDelete(tpl.id)}>{t("common.yesDelete", "Yes, delete")}</button>
                    <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => setDeleteConfirmId(null)}>{t("common.cancel", "Cancel")}</button>
                  </>
                ) : (
                  <button className="hra-btn" data-variant="danger" onClick={() => setDeleteConfirmId(tpl.id)}>{t("common.delete", "Delete")}</button>
                )}
              </div>
            ))}
          </div>
        )}
        {deleteError && <ErrorBanner message={deleteError} />}
        <button className="hra-btn" data-variant="accent" onClick={startCreate}>{t("manage.planTemplates.newTemplate", "New template")}</button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="hra-block-title" style={{ marginBottom: 12 }}>
        {editingId == null ? t("manage.planTemplates.createTitle", "New template") : t("manage.planTemplates.editTitle", "Edit template")}
      </div>

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
              onValueChange={v => setEvent(v as EventType)}
              options={eventOptions}
              placeholder={eventPlaceholder}
              triggerStyle={{ width: `${eventSelectWidth}ch` }}
            />
          </div>
        </label>

        <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto", opacity: isCustomEvent ? 1 : 0.5 }}>
          {t("manage.planTemplates.distanceLabel", "Distance")}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input
              className="hra-border-strong hra-bg-card hra-text-primary"
              value={distanceValue}
              onChange={e => setDistanceValue(e.target.value)}
              type="number"
              disabled={!isCustomEvent}
              style={{ width: 100, padding: 6 }}
            />
            <div className="hra-segment">
              <button className="hra-segment-item" data-active={distanceUnit === "km"} disabled={!isCustomEvent} onClick={() => switchDistanceUnit("km")}>km</button>
              <button className="hra-segment-item" data-active={distanceUnit === "mi"} disabled={!isCustomEvent} onClick={() => switchDistanceUnit("mi")}>mi</button>
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
        <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => { resetEditorState(); setMode("list"); }}>
          {t("common.cancel", "Cancel")}
        </button>
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
    </Card>
  );
}
