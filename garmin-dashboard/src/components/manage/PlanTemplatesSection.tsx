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
import { Card, ErrorBanner, Badge } from "@/components/ui";
import { TrainingPlanAccordion } from "@/components/TrainingPlanAccordion";
import { buildTemplateSectionView, type SectionView } from "@/domain/runplan-aggregate";
import { recomposeDayLine, replaceSpan, serializeSectionHeader, serializeWeekHeader, splitNote } from "@/domain/runplan-patch";
import type { PlanTemplate } from "@/types/api";
import type { ParseWarning } from "@/types/runplan";

interface EditorState { dslSource: string; sections: SectionView[] }

const EMPTY_EDITOR: EditorState = { dslSource: "", sections: [] };

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
    setEditingId(null); setSavedDslSource(null); setName(""); setEditor(EMPTY_EDITOR);
    setPlanWarnings([]); setGenError(null); setPatchError(null); setSaveError(null);
    lastGeneratedRef.current = null;
  }

  function startCreate() {
    resetEditorState();
    setMode("editor");
  }

  async function startEdit(template: PlanTemplate) {
    resetEditorState();
    setEditingId(template.id);
    setName(template.name);
    setSavedDslSource(template.dsl_source);
    setEditor({ dslSource: template.dsl_source, sections: [] });
    setMode("editor");
    await runGenerate(template.dsl_source);
  }

  async function onFileUpload(file: File) {
    const text = await file.text();
    setEditor({ dslSource: text, sections: [] });
    setPlanWarnings([]);
  }

  async function runGenerate(dslSource: string) {
    setGenLoading(true); setGenError(null); setPatchError(null);
    try {
      const { plan, warnings } = await api.planTemplates.generate(dslSource);
      lastGeneratedRef.current = dslSource;
      setPlanWarnings(warnings);
      setEditor({ dslSource, sections: plan.sections.map(s => buildTemplateSectionView(s, plan.metadata.pace_policy)) });
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

  const generated = editor.sections.length > 0;
  const canSave = generated && !hasOutstandingWarnings(editor, planWarnings) && name.trim() !== "";
  const canApprove = editingId != null && savedDslSource === editor.dslSource && !hasOutstandingWarnings(editor, planWarnings);

  async function onSave() {
    setSaveLoading(true); setSaveError(null);
    try {
      const saved = editingId
        ? await api.planTemplates.update(editingId, name, editor.dslSource)
        : await api.planTemplates.create(name, editor.dslSource);
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
                {tpl.event && <span className="hra-text-muted" style={{ fontSize: 11 }}>{tpl.event}</span>}
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

      <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
        {t("manage.planTemplates.nameLabel", "Name")}
        <input
          className="hra-border-strong hra-bg-card hra-text-primary"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ width: "100%", marginTop: 4, padding: 6 }}
        />
      </label>

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
