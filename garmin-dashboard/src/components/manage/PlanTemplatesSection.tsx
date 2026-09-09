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
import { useEffect, useRef, useState, type UIEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Save, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { Card, ErrorBanner, Badge, Select, AccordionCard } from "@/components/ui";
import { TrainingPlanAccordion, DAY_PREFIX_RE, type DayRef, type EditedRef } from "@/components/TrainingPlanAccordion";
import { PlanTemplateHelpModal } from "@/components/manage/PlanTemplateHelpModal";
import { PlanTemplateAgendaView } from "@/components/manage/PlanTemplateAgendaView";
import {
  aggregateDayViews, buildTemplateSectionView, summarizeTemplatePlan,
  type AggregateTotals, type DayView, type SectionView,
} from "@/domain/runplan-aggregate";
import { useIsPhone } from "@/hooks/useIsPhone";
import {
  buildRestDayLine, findSectionSpan, findWeekSpan, insertDayLine, recomposeDayLine, replaceSpan, replaceWithinSpan,
  serializeSectionHeader, serializeWeekHeader, splitNote, swapDayContent,
} from "@/domain/runplan-patch";
import { getUnitSystem } from "@/utils/units";
import { notify } from "@/utils/toast";
import type { PlanTemplate } from "@/types/api";
import type { EventType, OffsetUnit, ParseWarning, RunPlan } from "@/types/runplan";
import { useDemoMode } from "@/hooks/useDemoMode";
// HRA-200: frontend-owned copy of docs/utils/template-generator-AI-prompt.txt
// (the already-tested base prompt) — kept in sync manually, see that file's
// own header for the sync-risk note.
import aiPromptTemplate from "@/assets/template-generator-ai-prompt.txt?raw";

interface EditorState { dslSource: string; sections: SectionView[]; offsetUnit: OffsetUnit }

const EMPTY_EDITOR: EditorState = { dslSource: "", sections: [], offsetUnit: "s/km" };

// HRA-238: default open/collapsed state for the three-stage Plan text ->
// Conversion prompt -> Workout DSL authoring pipeline, computed once
// whenever a row is opened (startCreate/startEdit/reopenDraft) — never
// recomputed reactively as the user types, so opening a section by hand
// is never fought by this logic. DSL presence wins over text presence
// (an existing template's own case, since a loaded template never carries
// stashed-only originalText/generatedPrompt — HRA-200 fields are never
// persisted): the DSL section opens, text/prompt collapse but stay
// reachable. Otherwise text presence decides, mirroring a fresh/in-progress
// authoring session's own natural point of focus.
interface PipelineExpansion { text: boolean; prompt: boolean; dsl: boolean }
function computeDefaultExpansion(hasText: boolean, hasPrompt: boolean, hasDsl: boolean): PipelineExpansion {
  if (hasDsl) return { text: false, prompt: false, dsl: true };
  if (hasText) return { text: true, prompt: hasPrompt, dsl: false };
  return { text: true, prompt: false, dsl: false };
}

// HRA-200: split+join, not String.replace(pattern, value) — replace() treats
// "$" sequences in the replacement string specially (e.g. "$&", "$1"), which
// pasted training-plan text could easily contain unintentionally.
function fillAiPromptTemplate(
  originalText: string, language: string, eventType: string, eventName: string, unit: string,
): string {
  return aiPromptTemplate
    .split("{{TRAINING_PLAN}}").join(originalText)
    .split("{{LANGUAGE_OPTIONAL}}").join(language)
    .split("{{EVENT_TYPE_OPTIONAL}}").join(eventType)
    .split("{{EVENT_NAME_OPTIONAL}}").join(eventName)
    .split("{{UNIT_OPTIONAL}}").join(unit);
}

// The prompt's own <training_plan> placeholder, used verbatim in place of
// pasted text when the user intends to attach the source document itself to
// the AI conversation instead — the AI is expected to read the attached file
// rather than the prompt body for the actual plan content.
const ATTACHMENT_PLACEHOLDER = "use the attached document";

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
// HRA-200: originalText/language/generatedPrompt join the stash the same way
// every other unsaved field does — never persisted with the template (see
// onSave below, which never reads them).
interface Draft {
  name: string; event: EventType | ""; distanceValue: string; distanceUnit: DistanceUnit; dslSource: string;
  originalText: string; language: string; generatedPrompt: string | null;
}
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

// HRA-297: mobile read-only preview — a small type for the t() shape the
// helpers below need, so they stay plain functions (not hooks) callable from
// the render function further down without threading react-i18next's own
// generic TFunction type through this file.
type MobileT = (key: string, defaultValue: string, options?: Record<string, unknown>) => string;

type MobileDslState = "valid" | "invalid" | "missing";

// A saved template only ever reaches the record with zero warnings (Save is
// disabled until generate() succeeds — see canSave above), so in practice
// this almost always resolves "valid"; invalid/missing are defensive reads
// of a stale or hand-edited record, per this Story's own explicit AC to
// cover all three states rather than assume "valid" always.
function mobileTemplateDslState(tpl: PlanTemplate): MobileDslState {
  if (!tpl.dsl_source || tpl.dsl_source.trim() === "") return "missing";
  try {
    const plan = JSON.parse(tpl.parsed_plan) as RunPlan;
    return Array.isArray(plan?.sections) ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

function buildMobilePreviewSections(plan: RunPlan): SectionView[] {
  return plan.sections.map(section => buildTemplateSectionView(section, plan.metadata.pace_policy));
}

function sumAggregateTotals(sections: SectionView[]): AggregateTotals {
  return sections.reduce<AggregateTotals>((acc, s) => ({
    totalDays: acc.totalDays + s.totals.totalDays,
    activeDays: acc.activeDays + s.totals.activeDays,
    runningDays: acc.runningDays + s.totals.runningDays,
    restDays: acc.restDays + s.totals.restDays,
    otherDays: acc.otherDays + s.totals.otherDays,
    distance: {
      meters: acc.distance.meters + s.totals.distance.meters,
      approximate: acc.distance.approximate || s.totals.distance.approximate,
    },
  }), { totalDays: 0, activeDays: 0, runningDays: 0, restDays: 0, otherDays: 0, distance: { meters: 0, approximate: false } });
}

// AC5: never show a duration-derived ("invented") distance conversion — only
// a total built entirely from real distance targets is shown at all; a plan
// mixing in any duration-only work simply omits this line rather than
// silently including an invented figure. Deliberately narrower than the
// desktop accordion's own compactTotals/fmtDistance (TrainingPlanAccordion.tsx),
// which shows an approximate total with a "~" prefix — this Story's own AC
// asks for the stricter mobile-only behavior, not a change to desktop.
function mobileDistanceLabel(totals: AggregateTotals, t: MobileT): string | null {
  if (totals.distance.approximate || totals.distance.meters <= 0) return null;
  const km = (totals.distance.meters / 1000).toFixed(1);
  return t("runplan.accordion.distance", `${km} km`, { km });
}

// Same label precedence PlanInstanceCalendar.tsx's RibbonDay uses for its own
// compact day row (the "existing mobile Agenda day-row treatment" this
// Story's own description says to reuse rather than reimplement) — notes
// first, then a type-specific label, then the DSL text itself for a real
// workout. Template days have no TrainingLoadCategory (that needs a resolved
// instance's pace data), so there's no category-label fallback here.
function mobileDayPresentation(day: DayView, t: MobileT): { label: string; dslLines: string[] } {
  const isTimedWorkout = day.workout_type === "run" || day.workout_type === "cross" || day.workout_type === "strength";
  let label = "";
  if (day.notes) label = day.notes;
  else if (day.workout_type === "todo") label = t("runplan.accordion.stateTodoLabel", "Not yet planned");
  else if (day.workout_type === "other") label = t("runplan.accordion.stateOtherLabel", "Other");
  else if (day.workout_type === "rest") label = t("runplan.accordion.stateRestLabel", "Rest day");
  else if (day.workout_type === "cross") label = t("manage.planInstances.category.crossTraining", "Cross training");
  else if (day.workout_type === "strength") label = t("manage.planTemplates.mobilePreview.workoutTypeStrength", "Strength");
  const stripped = day.dsl.replace(DAY_PREFIX_RE, "");
  const dslLines = isTimedWorkout
    ? stripped.split(";").map(s => s.trim()).filter(Boolean).filter(line => !(day.notes && line.startsWith("#")))
    : [];
  return { label, dslLines };
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
  const demoMode = useDemoMode();
  const isPhone = useIsPhone();

  // HRA-296: which row's compact mobile card is expanded — entirely separate
  // from `activeKey`/the desktop editor below. Templates are strictly
  // read-only on mobile (HRA-294's mobile boundary), so a mobile row must
  // never route into the authoring AccordionCard `renderEditorFields()`
  // opens on desktop; expanding just reveals the one static
  // desktop-only-editing notice. HRA-297 owns building the real read-only
  // preview this will eventually show instead.
  const [mobileExpandedId, setMobileExpandedId] = useState<number | null>(null);
  // HRA-297: progressive disclosure inside the mobile preview — which
  // section index is open (revealing its weeks) and which week (a
  // "sectionIndex-weekIndex" key) is open (revealing its days). Reset
  // together whenever the row itself opens/closes (see onToggle below) so a
  // freshly opened row always shows exactly one meaningful level, never a
  // stale expansion left over from a previously viewed template.
  const [mobileExpandedSection, setMobileExpandedSection] = useState<number | null>(null);
  const [mobileExpandedWeek, setMobileExpandedWeek] = useState<string | null>(null);

  // HRA-140: which row is expanded — an existing template's id, "new" for
  // the unsaved-draft row, or null (every row collapsed). Replaces the old
  // page-level `mode`; `editingId` is now derived from this, not its own
  // state, since the two could never legitimately disagree.
  const [activeKey, setActiveKey] = useState<RowKey | null>(null);
  const editingId = typeof activeKey === "number" ? activeKey : null;

  // HRA-283/HRA-285: the per-template editor's List/Agenda toggle — mirrors
  // PlanInstancesSection's own List/Agenda toggle, same name and same
  // big-calendar library. A display preference, not edited data, so it's
  // plain local state (not part of Draft/dirty-tracking) and always resets
  // to List whenever a row opens (onToggleRow below).
  const [viewMode, setViewMode] = useState<"list" | "agenda">("list");

  const [showHelp, setShowHelp] = useState(false);
  const [savedDslSource, setSavedDslSource] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [event, setEvent] = useState<EventType | "">("");
  const [distanceValue, setDistanceValue] = useState("");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(defaultDistanceUnit());
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [planWarnings, setPlanWarnings] = useState<ParseWarning[]>([]);

  // HRA-200: source text for the AI-transcription prompt — never persisted
  // with the template (out of scope, see the Story), only ever stashed like
  // any other unsaved field (Draft above).
  const [originalText, setOriginalText] = useState("");
  const [language, setLanguage] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);

  // HRA-238: independent open/collapsed state for the three pipeline
  // sections (Plan text / Conversion prompt / Workout DSL) — NOT a
  // single-expand accordion like the outer template row: the user may need
  // to compare artifacts, so more than one section can be open at once.
  // Defaults are (re)computed only when a row opens (computeDefaultExpansion
  // below), never reactively as the user edits.
  const [textExpanded, setTextExpanded] = useState(true);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [dslExpanded, setDslExpanded] = useState(false);

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

  // The exact line text most recently written into editor.dslSource by a
  // structured Section/Week/Day edit (never by typing directly into the DSL
  // textarea — that line is already visible under the user's own cursor) —
  // used to momentarily highlight that one line in the DSL textarea, in
  // sync with the row-title dirty highlight. Cleared on row switch, direct
  // textarea edits, Save, and Restore so a stale highlight never survives
  // past the state it described.
  const [lastPatchedLine, setLastPatchedLine] = useState<string | null>(null);
  // The Section/Week/Day that patch touched, structurally — same lifetime/
  // clearing points as lastPatchedLine above, threaded to TrainingPlanAccordion
  // so it can highlight that one row's own AccordionCard in sync with the DSL
  // textarea's line highlight.
  const [lastEditedRef, setLastEditedRef] = useState<EditedRef | null>(null);

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
  // Scroll-syncs the DSL highlight backdrop (renderDslTextarea) to the real
  // textarea it sits under.
  const dslBackdropRef = useRef<HTMLPreElement>(null);

  function resetEditorState() {
    setSavedDslSource(null); setName(""); setEvent("");
    setDistanceValue(""); setDistanceUnit(defaultDistanceUnit());
    setEditor(EMPTY_EDITOR);
    setBaselineName(""); setBaselineEvent(""); setBaselineDistanceValue("");
    setPlanWarnings([]); setGenError(null); setPatchError(null); setSaveError(null);
    setOriginalText(""); setLanguage(""); setGeneratedPrompt(null);
    setLastPatchedLine(null); setLastEditedRef(null);
    // HRA-238: a reset row is always blank (no text, no prompt, no DSL) —
    // the "new empty template" default: Plan text expanded, the other two
    // collapsed but visible.
    const exp = computeDefaultExpansion(false, false, false);
    setTextExpanded(exp.text); setPromptExpanded(exp.prompt); setDslExpanded(exp.dsl);
    lastGeneratedRef.current = null;
  }

  // HRA-238 AC4: a DSL parse/preview error forces Workout DSL open
  // regardless of whatever the row's other two sections are doing —
  // "remains expanded... do not automatically open or alter Plan text and
  // Conversion prompt." Reacts to genError itself (set by runGenerate's
  // catch, including the debounced auto-regenerate path), not just the
  // initial open, so a later edit that turns out invalid also re-exposes it.
  useEffect(() => {
    if (genError) setDslExpanded(true);
  }, [genError]);

  // Warn before a refresh/tab close discards unsaved edits — either the
  // active row's own live fields (isEditorDirty) or any other row's stashed
  // draft. Re-registered every render (no dep array) since isEditorDirty
  // reads several pieces of state; the listener itself is cheap to attach.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (Object.keys(drafts).length > 0 || (activeKey != null && isEditorDirty())) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  });

  // HRA-140: whether the currently-active row's live fields differ from its
  // own last-saved/loaded baseline — the single source of truth for both
  // the Restore confirm gate (Ask #3) and what gets stashed on collapse
  // (Ask #4).
  function isEditorDirty(): boolean {
    return editor.dslSource !== (savedDslSource ?? "")
      || name !== baselineName
      || event !== baselineEvent
      || distanceValue !== baselineDistanceValue
      // HRA-200: never persisted, so their "baseline" is always empty/unset.
      || originalText.trim() !== "" || language.trim() !== "" || generatedPrompt != null;
  }

  // Whether a given row (active or collapsed) currently has anything
  // pending — the active row reads its live isEditorDirty(), a collapsed
  // one reads whether it has a stashed draft. Drives both the row-title
  // highlight (renderRowTitle/the "new" row title) and rowStatusHint below,
  // so the two never disagree about which rows show as dirty.
  function isRowDirty(key: RowKey): boolean {
    return key === activeKey ? isEditorDirty() : drafts[String(key)] != null;
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
    setGenError(null); setPatchError(null);
    try {
      const { plan, warnings } = await api.planTemplates.generate(dslSource);
      lastGeneratedRef.current = dslSource;
      setPlanWarnings(warnings);
      const sections = plan.sections.map(s => buildTemplateSectionView(s, plan.metadata.pace_policy));
      setEditor({ dslSource, sections, offsetUnit: plan.metadata.offset_unit });
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
    setEditor({ dslSource: template.dsl_source, sections: [], offsetUnit: "s/km" });
    // HRA-238: an existing template's originalText/generatedPrompt are
    // never persisted (HRA-200), so this is always the "template containing
    // DSL" case — Workout DSL opens, Plan text/Conversion prompt collapse
    // (but stay reachable).
    const exp = computeDefaultExpansion(false, false, template.dsl_source.trim() !== "");
    setTextExpanded(exp.text); setPromptExpanded(exp.prompt); setDslExpanded(exp.dsl);
    await runGenerate(template.dsl_source, { autoFillDistance: false });
  }

  // HRA-140: restores a previously-stashed draft's fields into the live
  // editor state, WITHOUT touching the baseline* fields — those must still
  // reflect the template's real persisted values (or the empty defaults for
  // an unsaved "new" draft), never the draft itself, or isEditorDirty()
  // would read false the instant a genuinely-dirty draft reopens.
  async function reopenDraft(draft: Draft, template: PlanTemplate | undefined) {
    setGenError(null); setPatchError(null); setSaveError(null);
    setLastPatchedLine(null); setLastEditedRef(null);
    setName(draft.name); setEvent(draft.event);
    setDistanceValue(draft.distanceValue); setDistanceUnit(draft.distanceUnit);
    setOriginalText(draft.originalText); setLanguage(draft.language); setGeneratedPrompt(draft.generatedPrompt);
    // HRA-238: a stashed draft carries its own text/prompt/DSL state,
    // unlike startEdit's always-blank text/prompt — recompute defaults from
    // what this specific draft actually holds.
    const exp = computeDefaultExpansion(draft.originalText.trim() !== "", draft.generatedPrompt != null, draft.dslSource.trim() !== "");
    setTextExpanded(exp.text); setPromptExpanded(exp.prompt); setDslExpanded(exp.dsl);
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
      setDrafts(prev => ({ ...prev, [key]: { name, event, distanceValue, distanceUnit, dslSource: editor.dslSource, originalText, language, generatedPrompt } }));
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
    if (activeKey === key) {
      stashCurrentIfDirty();
      setActiveKey(null);
      return;
    }
    stashCurrentIfDirty();
    setActiveKey(key);
    setViewMode("list");
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
    setEditor({ dslSource: text, sections: [], offsetUnit: "s/km" });
    setPlanWarnings([]);
    setLastPatchedLine(null); setLastEditedRef(null);
  }

  // HRA-200: fills the base AI-transcription prompt from the pasted plan
  // text + optional language, for the user to copy and run externally
  // against an LLM — this app never calls an LLM API itself.
  function onGeneratePrompt() {
    setGeneratedPrompt(fillAiPromptTemplate(originalText, language, event, name, distanceUnit));
    setPromptExpanded(true);
  }

  // Same prompt, but with the <training_plan> body replaced by a fixed
  // placeholder — for when the source is a document the user will attach
  // directly to the AI conversation rather than paste as text. Never needs
  // Original text filled in, since the AI is meant to read the attachment.
  function onGeneratePromptForAttachment() {
    setGeneratedPrompt(fillAiPromptTemplate(ATTACHMENT_PLACEHOLDER, language, event, name, distanceUnit));
    setPromptExpanded(true);
  }

  async function onCopyPrompt() {
    if (generatedPrompt == null) return;
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      notify(t("manage.planTemplates.aiPrompt.copySucceeded", "Prompt copied to clipboard."));
    } catch {
      notify(t("manage.planTemplates.aiPrompt.copyFailed", "Failed to copy prompt to clipboard."), "error");
    }
  }

  // Save-as alternative to Copy — some LLM front ends reject a pasted prompt
  // past a certain length but accept the same text as an uploaded file. Same
  // Blob -> <a download> mechanism as onExportDayFit/downloadScopeFitZip in
  // PlanInstancesSection.tsx (HRA-202/203) — plain browser download, no File
  // System Access API.
  function onSaveAsPrompt() {
    if (generatedPrompt == null) return;
    const blob = new Blob([generatedPrompt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plan-template-prompt.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
      setLastPatchedLine(newRawDsl);
      setLastEditedRef({ kind: "section", sectionIndex });
      const sections = [...prev.sections];
      sections[sectionIndex] = { ...section, name: patch.name ?? section.name, notes: patch.notes ?? section.notes, raw_dsl: newRawDsl };
      return { dslSource: result.source, sections, offsetUnit: prev.offsetUnit };
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
      // Scoped to the enclosing section — plans commonly restart week
      // numbering per section, so an identical "WEEK 1" header can recur
      // verbatim elsewhere in the same dsl_source (see runplan-patch.ts's
      // findSectionSpan comment).
      const sectionSpan = findSectionSpan(prev.dslSource, prev.sections, sectionIndex);
      const result = replaceWithinSpan(prev.dslSource, sectionSpan, week.raw_dsl, newRawDsl);
      if (!result.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }
      setLastPatchedLine(newRawDsl);
      setLastEditedRef({ kind: "week", sectionIndex, weekIndex });
      const weeks = [...section.weeks];
      weeks[weekIndex] = { ...week, notes: patch.notes ?? week.notes, raw_dsl: newRawDsl };
      const sections = [...prev.sections];
      sections[sectionIndex] = { ...section, weeks };
      return { dslSource: result.source, sections, offsetUnit: prev.offsetUnit };
    });
  }

  function onDayEdit(sectionIndex: number, weekIndex: number, dayIndex: number, patch: { dsl?: string; notes?: string }) {
    setPatchError(null);
    setEditor(prev => {
      const section = prev.sections[sectionIndex];
      const week = section.weeks[weekIndex];
      const day = week.days[dayIndex];
      const newLine = recomposeDayLine(day.dsl, patch);
      // Scoped to the enclosing week — the same day line (e.g. a rest day
      // or a repeated easy-run line) very commonly recurs verbatim across
      // other weeks, which would otherwise make a whole-document search
      // ambiguous for a perfectly legitimate edit (see runplan-patch.ts's
      // findWeekSpan comment).
      const weekSpan = findWeekSpan(prev.dslSource, prev.sections, sectionIndex, weekIndex);
      const result = replaceWithinSpan(prev.dslSource, weekSpan, day.dsl, newLine);
      if (!result.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }
      setLastPatchedLine(newLine);
      setLastEditedRef({ kind: "day", sectionIndex, weekIndex, dayIndex });
      const days = [...week.days];
      days[dayIndex] = { ...day, dsl: newLine, notes: splitNote(newLine).note };
      const weeks = [...section.weeks];
      weeks[weekIndex] = { ...week, days };
      const sections = [...prev.sections];
      sections[sectionIndex] = { ...section, weeks };
      return { dslSource: result.source, sections, offsetUnit: prev.offsetUnit };
    });
  }

  // HRA-283/HRA-285: the Agenda view's own drag-and-drop day swap — templates
  // never had one before HRA-283 (the List view stays exactly as it was, per
  // that Story's own explicit scope). Reuses swapDayContent verbatim (no new
  // swap logic), then content-anchor-patches both touched D-lines the same
  // way onSectionEdit/onWeekEdit/onDayEdit above already patch a single one —
  // recomputing each span fresh from the just-updated source, since a
  // header's own text (what findWeekSpan anchors on) is untouched by a day
  // line's own length changing.
  function onWeekViewDaySwap(a: DayRef, b: DayRef) {
    setPatchError(null);
    setEditor(prev => {
      const dayA = prev.sections[a.sectionIndex]?.weeks[a.weekIndex]?.days[a.dayIndex];
      const dayB = prev.sections[b.sectionIndex]?.weeks[b.weekIndex]?.days[b.dayIndex];
      if (!dayA || !dayB) return prev;
      const [newA, newB] = swapDayContent(dayA.dsl, dayB.dsl);

      const spanA = findWeekSpan(prev.dslSource, prev.sections, a.sectionIndex, a.weekIndex);
      const rA = replaceWithinSpan(prev.dslSource, spanA, dayA.dsl, newA);
      if (!rA.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }
      const spanB = findWeekSpan(rA.source, prev.sections, b.sectionIndex, b.weekIndex);
      const rB = replaceWithinSpan(rA.source, spanB, dayB.dsl, newB);
      if (!rB.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }

      const sections = prev.sections.map(s => ({ ...s, weeks: s.weeks.map(w => ({ ...w, days: [...w.days] })) }));
      sections[a.sectionIndex].weeks[a.weekIndex].days[a.dayIndex] = { ...dayB, dsl: newA, notes: splitNote(newA).note, day: dayA.day, suffix: dayA.suffix, category: dayA.category };
      sections[b.sectionIndex].weeks[b.weekIndex].days[b.dayIndex] = { ...dayA, dsl: newB, notes: splitNote(newB).note, day: dayB.day, suffix: dayB.suffix, category: dayB.category };
      sections[a.sectionIndex].weeks[a.weekIndex].totals = aggregateDayViews(sections[a.sectionIndex].weeks[a.weekIndex].days);
      sections[a.sectionIndex].totals = aggregateDayViews(sections[a.sectionIndex].weeks.flatMap(w => w.days));
      if (b.sectionIndex !== a.sectionIndex) sections[b.sectionIndex].totals = aggregateDayViews(sections[b.sectionIndex].weeks.flatMap(w => w.days));
      if (b.sectionIndex !== a.sectionIndex || b.weekIndex !== a.weekIndex) {
        sections[b.sectionIndex].weeks[b.weekIndex].totals = aggregateDayViews(sections[b.sectionIndex].weeks[b.weekIndex].days);
      }
      setLastPatchedLine(newB);
      setLastEditedRef({ kind: "day", sectionIndex: b.sectionIndex, weekIndex: b.weekIndex, dayIndex: b.dayIndex });
      return { dslSource: rB.source, sections, offsetUnit: prev.offsetUnit };
    });
  }

  // HRA-283: materializes an undeclared D-number into a real `D<n>: REST`
  // line — the Agenda view's own first-interaction rule (AC5). `swapWith`,
  // when supplied (a drop landing on this slot, not a plain click-to-open),
  // folds the usual swapDayContent exchange into the SAME update: the
  // dragged day's content moves onto the newly-real day, and REST is left
  // behind at the drag's own origin — no separate "move" primitive, this is
  // exactly what exchanging content with a REST day already produces.
  function onMaterializeDay(sectionIndex: number, weekIndex: number, dayNumber: number, swapWith?: DayRef) {
    setPatchError(null);
    setEditor(prev => {
      const section = prev.sections[sectionIndex];
      const week = section.weeks[weekIndex];
      if (week.days.some(d => d.day === dayNumber)) return prev; // already declared — nothing to do
      const weekSpan = findWeekSpan(prev.dslSource, prev.sections, sectionIndex, weekIndex);
      if (!weekSpan) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }

      const restLine = buildRestDayLine(dayNumber);
      const insertResult = insertDayLine(
        prev.dslSource, weekSpan, week.raw_dsl, week.days.map(d => ({ day: d.day, raw_dsl: d.dsl })), dayNumber, restLine,
      );
      if (!insertResult.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }
      let dslSource = insertResult.source;

      const materializedDay: DayView = {
        day: dayNumber, workout_type: "rest", dsl: restLine, needs_review: false, warnings: [],
        distance: { meters: 0, approximate: false }, segments: undefined,
      };
      const sourceDay = swapWith ? week.days[swapWith.dayIndex] : undefined;
      const insertAt = week.days.findIndex(d => d.day > dayNumber);
      const workingDays = [...week.days];
      workingDays.splice(insertAt === -1 ? workingDays.length : insertAt, 0, materializedDay);
      let highlightDayIndex = workingDays.indexOf(materializedDay);
      let highlightLine = restLine;

      // The Agenda view only ever renders one week's 7 slots at once, so a
      // drop's source day is always this same week's own — swapWith never
      // crosses section/week boundaries in practice.
      if (sourceDay) {
        const [newSourceLine, newTargetLine] = swapDayContent(sourceDay.dsl, materializedDay.dsl);
        const sourceIdxAfter = workingDays.indexOf(sourceDay);
        const targetIdxAfter = workingDays.indexOf(materializedDay);

        const targetSpan = findWeekSpan(dslSource, prev.sections, sectionIndex, weekIndex);
        const rTarget = replaceWithinSpan(dslSource, targetSpan, materializedDay.dsl, newTargetLine);
        if (!rTarget.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }
        dslSource = rTarget.source;
        const sourceSpan = findWeekSpan(dslSource, prev.sections, sectionIndex, weekIndex);
        const rSource = replaceWithinSpan(dslSource, sourceSpan, sourceDay.dsl, newSourceLine);
        if (!rSource.ok) { setPatchError(t("manage.planTemplates.patchFailed", "Could not apply this edit — the underlying text may have changed unexpectedly.")); return prev; }
        dslSource = rSource.source;

        workingDays[targetIdxAfter] = { ...sourceDay, dsl: newTargetLine, notes: splitNote(newTargetLine).note, day: materializedDay.day, suffix: materializedDay.suffix, category: materializedDay.category };
        workingDays[sourceIdxAfter] = { ...materializedDay, dsl: newSourceLine, notes: splitNote(newSourceLine).note, day: sourceDay.day, suffix: sourceDay.suffix, category: sourceDay.category };
        highlightDayIndex = targetIdxAfter;
        highlightLine = newTargetLine;
      }

      const newWeek = { ...week, days: workingDays, totals: aggregateDayViews(workingDays) };
      const weeks = [...section.weeks];
      weeks[weekIndex] = newWeek;
      const newSection = { ...section, weeks, totals: aggregateDayViews(weeks.flatMap(w => w.days)) };
      const sections = [...prev.sections];
      sections[sectionIndex] = newSection;

      setLastPatchedLine(highlightLine);
      setLastEditedRef({ kind: "day", sectionIndex, weekIndex, dayIndex: highlightDayIndex });
      return { dslSource, sections, offsetUnit: prev.offsetUnit };
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
  // HRA-287: both gates now also require isEditorDirty() — previously Save
  // was clickable the instant an existing template opened, with zero edits,
  // and Activate only checked dslSource (a name/event/distance-only edit
  // left it enabled with a pending change it wouldn't actually persist).
  // genError == null guards the OTHER HRA-287 fix: onDslTextareaChange no
  // longer wipes `sections` to `[]` on every keystroke (see its own
  // comment), so `generated` alone can no longer be trusted to reflect the
  // live dslSource — a known/reported parse failure must still block Save.
  const canSave = generated && genError == null && !hasOutstandingWarnings(editor, planWarnings) && name.trim() !== ""
    && event !== "" && (!isCustomEvent || distanceValue.trim() !== "") && isEditorDirty();
  const canApprove = editingId != null && genError == null && !isEditorDirty() && !hasOutstandingWarnings(editor, planWarnings);

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
      setLastPatchedLine(null); setLastEditedRef(null);
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
      notify(t("manage.planTemplates.approveSucceeded", "Template activated."));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("manage.planTemplates.approveFailed", "Failed to activate template"));
    }
    setApproveLoading(false);
  }

  // HRA-140 Ask #3: "Clear pending changes" discards the active row's
  // unsaved edits and collapses it — since the list row itself only ever
  // displays the real persisted `templates` data (never mutated by local
  // typing), simply resetting local state + collapsing IS "reverting to the
  // last-saved values"; there's nothing to re-populate. The button itself is
  // disabled whenever the row is clean (nothing to clear), so this is only
  // ever reached genuinely dirty — always gated on a confirm.
  function onRestoreClick() {
    if (isEditorDirty()) { setPendingRestoreConfirm(true); return; }
    doRestore();
  }
  // HRA-?: restores the active row's fields to their last-saved/loaded
  // baseline WITHOUT collapsing it — activeKey is deliberately never
  // touched here, so whichever row was open stays open.
  async function doRestore() {
    setPendingRestoreConfirm(false);
    if (activeKey == null) return;
    const key = String(activeKey);
    setDrafts(prev => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
    if (activeKey === "new") {
      resetEditorState();
    } else {
      const template = templates?.find(tpl => tpl.id === activeKey);
      if (template) await startEdit(template);
    }
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

  // HRA-140 Ask #2/#4: a row's own status hint — a dirty row (whether
  // that's a stashed draft while collapsed, or the live editor while this
  // row is the active/open one — isRowDirty covers both) gets the warning
  // icon; a collapsed-and-clean row gets the plain "Open and edit" hint; an
  // active-and-clean row gets nothing (already open, nothing pending — the
  // hint would just be noise).
  function rowStatusHint(key: RowKey) {
    if (isRowDirty(key)) {
      return (
        <span className="inline-flex items-center gap-1">
          <AlertTriangle size={14} className="hra-text-warning shrink-0" />
          <span className="hra-text-secondary text-meta">{t("manage.planTemplates.unsavedChanges", "There are pending changes")}</span>
        </span>
      );
    }
    if (key === activeKey) return null;
    return (
      <span className="hra-text-secondary text-meta italic" >
        {t("manage.planTemplates.openToEditHint", "Open and edit")}
      </span>
    );
  }

  // HRA-238: short, derivable-only-from-existing-data status labels for
  // each pipeline section's header. "Modified" (Conversion prompt) is
  // deliberately not implemented, per the Story's own caveat — there is no
  // stored baseline for generatedPrompt to diff against (unlike dslSource's
  // savedDslSource), and adding one would be a new persistence model.
  function planTextStateLabel(): string {
    if (originalText.trim() === "") return t("manage.planTemplates.pipeline.stateNotProvided", "Not provided");
    if (generatedPrompt != null) return t("manage.planTemplates.pipeline.statePromptGenerated", "Prompt generated");
    return t("manage.planTemplates.pipeline.stateReady", "Ready");
  }
  function conversionPromptStateLabel(): string {
    return generatedPrompt != null
      ? t("manage.planTemplates.pipeline.stateGenerated", "Generated")
      : t("manage.planTemplates.pipeline.stateNotGenerated", "Not generated");
  }
  function workoutDslStateLabel(): string {
    if (editor.dslSource.trim() === "") return t("manage.planTemplates.pipeline.stateEmpty", "Empty");
    if (!generated) return t("manage.planTemplates.pipeline.stateReadyToPreview", "Ready to preview");
    if (genError || hasOutstandingWarnings(editor, planWarnings)) return t("manage.planTemplates.pipeline.stateNeedsReview", "Needs review");
    return t("manage.planTemplates.pipeline.stateValid", "Valid");
  }

  // HRA-238: one pipeline section's header — the order+title baked into the
  // translated header string itself (e.g. "1 · Plan text") on the left, a
  // short status on the right; `AccordionCard` appends the ▲/▼ chevron and
  // owns `aria-expanded`. Order/title/status/expanded-state are all real
  // text or a real ARIA attribute — never color alone (accessibility
  // requirement).
  function pipelineSectionTitle(header: string, status: string) {
    return (
      <span className="flex items-center justify-between flex-1 min-w-0 gap-2">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{header}</span>
        <span className="hra-text-secondary text-meta shrink-0">{status}</span>
      </span>
    );
  }

  function renderRowTitle(tpl: PlanTemplate) {
    const dirty = isRowDirty(tpl.id);
    return (
      <span className="flex items-center gap-2 flex-1 min-w-0">
        <span className={`overflow-hidden text-ellipsis whitespace-nowrap ${dirty ? "hra-text-warning" : ""}`}>{tpl.name}</span>
        {tpl.event && <span className="hra-text-muted text-meta" >{t(`manage.planTemplates.event.${tpl.event}`, tpl.event)}</span>}
        <Badge
          label={tpl.approved_at ? t("manage.planTemplates.approved", "Activated") : t("manage.planTemplates.notApproved", "Not activated")}
          color={tpl.approved_at ? "var(--accent-green)" : "var(--text-muted)"}
        />
        {rowStatusHint(tpl.id)}
      </span>
    );
  }

  // HRA-287: keeps the previous (now-stale) sections instead of wiping them
  // to `[]` — the debounced auto-regenerate effect below re-parses ~700ms
  // after the user stops typing, and until then `generated`
  // (editor.sections.length > 0) is what gates Save/Activate. Resetting to
  // `[]` on every keystroke meant Save silently went disabled for that whole
  // debounce+network window after EVERY edit — a click landing inside it was
  // a no-op, which read as "my edit didn't save" (HRA-287's reported bug).
  // canSave's own genError == null check covers the case where the live
  // text is actually broken while these stale sections still look valid.
  function onDslTextareaChange(value: string) {
    setEditor(prev => ({ dslSource: value, sections: prev.sections, offsetUnit: prev.offsetUnit }));
    setLastPatchedLine(null); setLastEditedRef(null);
  }

  function onDslTextareaScroll(e: UIEvent<HTMLTextAreaElement>) {
    if (dslBackdropRef.current) {
      dslBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
      dslBackdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }

  // Renders the Workout DSL textarea plain when there's nothing to
  // highlight, or layered over a backdrop rendering the same text with the
  // most-recently-patched line marked, when lastPatchedLine still names a
  // findable span in the current dslSource (a later unrelated edit could
  // make it disappear — treated the same as "nothing to highlight"). The
  // textarea's own text is fully transparent in that case (only its caret
  // shows) so the backdrop's colored copy is what the user actually sees —
  // the two share the same font/padding classes so they line up.
  function renderDslTextarea() {
    const offset = lastPatchedLine ? editor.dslSource.indexOf(lastPatchedLine) : -1;
    if (!lastPatchedLine || offset === -1) {
      return (
        <textarea
          className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 font-mono text-meta p-2"
          value={editor.dslSource}
          onChange={e => onDslTextareaChange(e.target.value)}
          rows={8}
        />
      );
    }
    const before = editor.dslSource.slice(0, offset);
    const after = editor.dslSource.slice(offset + lastPatchedLine.length);
    return (
      <div className="hra-dsl-editor-wrap hra-border-strong hra-bg-card w-full mt-1">
        <pre ref={dslBackdropRef} aria-hidden="true" className="hra-dsl-editor-backdrop hra-text-primary font-mono text-meta p-2">
          {before}<mark>{lastPatchedLine}</mark>{after}
        </pre>
        <textarea
          className="hra-dsl-editor-textarea font-mono text-meta p-2"
          value={editor.dslSource}
          onChange={e => onDslTextareaChange(e.target.value)}
          onScroll={onDslTextareaScroll}
          rows={8}
        />
      </div>
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
        <div className="hra-plan-instance-section-gap flex items-start gap-2.5 flex-wrap">
          <label className="hra-template-name-field hra-text-secondary text-meta">
            {t("manage.planTemplates.nameLabel", "Name")}<span className="hra-text-danger"> *</span>
            <input
              className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 p-1.5"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </label>

          <label className="shrink-0 hra-text-secondary text-meta">
            {t("manage.planTemplates.eventLabel", "Event type")}<span className="hra-text-danger"> *</span>
            <div className="mt-1">
              <Select
                value={event}
                onValueChange={v => onEventChange(v as EventType)}
                options={eventOptions}
                placeholder={eventPlaceholder}
                triggerWidth={`${eventSelectWidth}ch`}
              />
            </div>
          </label>

          {/* Always shown, always full-opacity ("visually enabled") — a known
              event type's distance is fixed and filled the instant it's
              picked (onEventChange above); readOnly/an inert toggle just mean
              it can be seen and selected/copied but not changed, unlike
              disabled which would also dim it. Only Custom makes both
              writable. The required marker only applies while Custom is
              selected (canSave only requires distanceValue in that case) —
              for the four standard events, Distance is filled in
              automatically and can't be left empty. */}
          <label className="shrink-0 hra-text-secondary text-meta">
            {t("manage.planTemplates.distanceLabel", "Distance")}{isCustomEvent && <span className="hra-text-danger"> *</span>}
            <div className="flex gap-1.5 mt-1">
              <input
                className="hra-template-distance-input hra-border-strong hra-bg-card hra-text-primary p-1.5"
                value={distanceValue}
                onChange={e => setDistanceValue(e.target.value)}
                type="number"
                readOnly={!isCustomEvent}
              />
              <div className="hra-segment">
                <button className="hra-segment-item" data-active={distanceUnit === "km"} onClick={() => switchDistanceUnit("km")}>km</button>
                <button className="hra-segment-item" data-active={distanceUnit === "mi"} onClick={() => switchDistanceUnit("mi")}>mi</button>
              </div>
            </div>
          </label>
        </div>
        <div className="hra-text-muted hra-plan-instance-section-gap text-meta">
          <span className="hra-text-danger">*</span> {t("manage.planInstances.requiredLegend", "required")}
        </div>

        {/* HRA-238: Plan text -> Conversion prompt -> Workout DSL authoring
            pipeline — three INDEPENDENTLY collapsible sections, not a
            single-expand accordion (the user may need to compare artifacts,
            so more than one can be open at once). The ordering communicates
            the normal transformation flow without enforcing it — every
            section opens directly at any time (AC2's direct-DSL path).
            Default open/collapsed state is computed once when the row opens
            (computeDefaultExpansion, called from startCreate/startEdit/
            reopenDraft), never reactively as the user types. */}
        <div className="hra-plan-instance-section-gap flex flex-col gap-2">
          <AccordionCard
            title={pipelineSectionTitle(t("manage.planTemplates.pipeline.planTextHeader", "1 · Plan text"), planTextStateLabel())}
            expanded={textExpanded} onToggle={() => setTextExpanded(v => !v)}
          >
            {/* HRA-200: paste a messy real-world plan, generate a
                ready-to-copy LLM prompt (built from the tested base prompt),
                run it externally, then paste the returned DSL into Workout
                DSL below — this app never calls an LLM API itself. The
                language field belongs here (it describes the source text),
                per this Story's own explicit placement. */}
            <div className="flex flex-col gap-2.5">
              <p className="hra-text-secondary text-meta m-0">
                {t("manage.planTemplates.pipeline.planTextDescription", "Paste the original training plan in any readable format or language.")}
              </p>
              <label className="hra-text-secondary text-meta block" >
                {t("manage.planTemplates.aiPrompt.originalTextLabel", "Original text")}
                <textarea
                  className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 text-meta p-2"
                  value={originalText}
                  onChange={e => setOriginalText(e.target.value)}
                  placeholder={t("manage.planTemplates.aiPrompt.originalTextPlaceholder", "Paste the raw training plan text here (PDF/prose, any language)…")}
                  rows={4}
                />
              </label>

              <div className="flex items-start gap-2.5 flex-wrap">
                <label className="hra-template-name-field hra-text-secondary text-meta">
                  {t("manage.planTemplates.aiPrompt.languageLabel", "Language (optional)")}
                  <input
                    className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 p-1.5"
                    value={language}
                    onChange={e => setLanguage(e.target.value)}
                    placeholder={t("manage.planTemplates.aiPrompt.languagePlaceholder", "e.g. Italian")}
                  />
                </label>
                <button
                  className="hra-btn self-end"
                  onClick={onGeneratePrompt}
                  disabled={originalText.trim() === ""}
                >
                  {t("manage.planTemplates.aiPrompt.generateButton", "Generate full prompt")}
                </button>
                <button
                  className="hra-btn self-end"
                  onClick={onGeneratePromptForAttachment}
                >
                  {t("manage.planTemplates.aiPrompt.generateForAttachmentButton", "Generate prompt for an attached document")}
                </button>
              </div>
              <p className="hra-text-secondary text-meta m-0">
                {t(
                  "manage.planTemplates.aiPrompt.attachmentHint",
                  "Prefer attaching the original document instead of pasting text? Click \"Generate prompt for an attached document\" above, then upload both the generated prompt and the document to your preferred AI (e.g. Qwen3 8B works well).",
                )}
              </p>
            </div>
          </AccordionCard>

          <AccordionCard
            title={pipelineSectionTitle(t("manage.planTemplates.pipeline.conversionPromptHeader", "2 · Conversion prompt"), conversionPromptStateLabel())}
            expanded={promptExpanded} onToggle={() => setPromptExpanded(v => !v)}
          >
            <div className="flex flex-col gap-2.5">
              <p className="hra-text-secondary text-meta m-0">
                {t("manage.planTemplates.pipeline.conversionPromptDescription", "Use this prompt with your preferred AI, then paste the resulting plan into Workout DSL.")}
              </p>
              <label className="hra-text-secondary text-meta block" >
                {t("manage.planTemplates.aiPrompt.generatedLabel", "Generated prompt")}
                <div className="flex items-start gap-2.5 mt-1">
                  <textarea
                    className="hra-border-strong hra-bg-card hra-text-primary w-full font-mono text-meta p-2"
                    value={generatedPrompt ?? ""}
                    readOnly
                    placeholder={generatedPrompt == null ? t("manage.planTemplates.pipeline.conversionPromptEmpty", "Generate a prompt from the plan text, or paste an existing prompt here.") : undefined}
                    rows={4}
                  />
                  <div className="flex flex-col gap-2.5 shrink-0">
                    <button className="hra-btn" onClick={onCopyPrompt} disabled={generatedPrompt == null}>
                      {t("manage.planTemplates.aiPrompt.copyButton", "Copy prompt")}
                    </button>
                    <button className="hra-btn" onClick={onSaveAsPrompt} disabled={generatedPrompt == null}>
                      {t("manage.planTemplates.aiPrompt.saveAsButton", "Save prompt as…")}
                    </button>
                  </div>
                </div>
              </label>
            </div>
          </AccordionCard>

          <AccordionCard
            title={pipelineSectionTitle(t("manage.planTemplates.pipeline.workoutDslHeader", "3 · Workout DSL"), workoutDslStateLabel())}
            expanded={dslExpanded} onToggle={() => setDslExpanded(v => !v)}
          >
            <div className="flex flex-col gap-2.5">
              <p className="hra-text-secondary text-meta m-0">
                {t("manage.planTemplates.pipeline.workoutDslDescription", "Source of truth for the structured plan.")}
              </p>
              <label className="hra-text-secondary text-meta block" >
                {t("manage.planTemplates.dslSourceLabel", "Workout plan text")}
                {renderDslTextarea()}
              </label>
              <div className="hra-row-wrap" >
                <label className="hra-btn cursor-pointer" >
                  {t("manage.planTemplates.uploadFile", "Upload .txt/.csv…")}
                  <input
                    type="file" accept=".txt,.csv" className="hidden"
                    onChange={e => { const file = e.target.files?.[0]; if (file) onFileUpload(file); e.target.value = ""; }}
                  />
                </label>
              </div>
              {genError && <ErrorBanner message={genError} />}
            </div>
          </AccordionCard>
        </div>

        {/* HRA-238 AC6: Save/Approve/Restore stay global template-lifecycle
            actions, in one shared bar OUTSIDE the three-stage pipeline —
            never presented as a fourth authoring step. Gating rules
            (canSave/canApprove/onRestoreClick) are byte-identical to before
            this Story. */}
        <div className="hra-plan-instance-section-gap hra-row-wrap" >
          <button
            className="hra-btn hra-btn-icon-label" data-variant="green" onClick={onSave} disabled={!canSave || saveLoading}
            aria-label={saveLoading ? t("common.saving", "Saving…") : t("common.save", "Save")}
          >
            <Save size={14} />
            <span className="hra-btn-label">{saveLoading ? t("common.saving", "Saving…") : t("common.save", "Save")}</span>
          </button>
          <button
            className="hra-btn" onClick={onApprove} disabled={!canApprove || approveLoading || demoMode}
            title={demoMode ? t("common.demoModeHint", "Not available for demo") : undefined}
          >
            {approveLoading ? t("manage.planTemplates.approving", "Activating…") : t("manage.planTemplates.approveButton", "Activate")}
          </button>
          <button className="hra-btn" onClick={onRestoreClick} disabled={!isEditorDirty()}>
            {t("manage.planTemplates.clearPendingChangesButton", "Clear pending changes")}
          </button>
        </div>

        {patchError && <ErrorBanner message={patchError} />}
        {saveError && <ErrorBanner message={saveError} />}

        {planWarnings.length > 0 && (
          <ul className="hra-text-danger text-meta mb-3" >
            {planWarnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        )}

        {generated && (
          <>
            {/* HRA-283/HRA-285: mirrors PlanInstancesSection's own List/Agenda
                toggle — same name, same shadcn-big-calendar library. Defaults
                to List, switching never touches dslSource/the current
                preview (both views render the same editor.sections). */}
            <div className="hra-segment self-start hra-plan-instance-section-gap">
              <button className="hra-segment-item" data-active={viewMode === "list"} onClick={() => setViewMode("list")}>
                {t("manage.planTemplates.viewList", "List")}
              </button>
              <button className="hra-segment-item" data-active={viewMode === "agenda"} onClick={() => setViewMode("agenda")}>
                {t("manage.planTemplates.viewAgenda", "Agenda")}
              </button>
            </div>
            {viewMode === "list" ? (
              <TrainingPlanAccordion
                ownerName={name || t("manage.planTemplates.untitled", "Untitled plan")}
                sections={editor.sections}
                onSectionEdit={onSectionEdit}
                onWeekEdit={onWeekEdit}
                onDayEdit={onDayEdit}
                offsetUnit={editor.offsetUnit}
                highlightedRef={lastEditedRef ?? undefined}
              />
            ) : (
              <PlanTemplateAgendaView
                ownerName={name || t("manage.planTemplates.untitled", "Untitled plan")}
                sections={editor.sections}
                onDayEdit={onDayEdit}
                onDaySwap={onWeekViewDaySwap}
                onMaterializeDay={onMaterializeDay}
                offsetUnit={editor.offsetUnit}
                highlightedRef={lastEditedRef ?? undefined}
              />
            )}
          </>
        )}

        {pendingRestoreConfirm && (
          <div className="hra-modal-layer hra-modal-backdrop fixed inset-0 flex items-center justify-center p-6" onClick={cancelRestoreConfirm}>
            <div className="hra-bg-surface hra-border rounded-xl w-full max-w-90 p-5"  onClick={e => e.stopPropagation()}>
              <div className="hra-text-primary text-label font-semibold leading-normal mb-4" >
                {t("manage.planTemplates.restoreConfirmBody", "You have unsaved changes — discard them?")}
              </div>
              <div className="hra-row-wrap justify-end" >
                <button className="hra-border-strong hra-text-secondary bg-transparent rounded-md py-1.5 px-3.5 text-meta cursor-pointer"  onClick={cancelRestoreConfirm}>
                  {t("common.cancel", "Cancel")}
                </button>
                <button className="hra-btn" data-variant="danger" onClick={doRestore}>
                  {t("manage.planTemplates.clearPendingChangesButton", "Clear pending changes")}
                </button>
              </div>
            </div>
          </div>
        )}

      </>
    );
  }

  const newDraftPending = activeKey === "new" || drafts["new"] != null;

  // HRA-297: the mobile row's own read-only progressive-disclosure preview —
  // built from the same SectionView tree buildTemplateSectionView already
  // produces for the desktop editor (Section -> Week -> Day, each carrying
  // its own AggregateTotals), so the counts/distance math here is identical
  // to the desktop accordion's, never a second implementation of it. Name,
  // active/inactive status, race type and unit already render in the row's
  // own (always-visible) title above — see the title span this replaces the
  // body of, just below — so this only covers what the title doesn't.
  function renderMobileTemplatePreview(tpl: PlanTemplate) {
    const dslState = mobileTemplateDslState(tpl);
    if (dslState !== "valid") {
      return (
        <div className="flex flex-col gap-3">
          <div className="hra-text-secondary text-meta">
            {dslState === "missing"
              ? t("manage.planTemplates.mobilePreview.dslMissing", "No plan text has been generated for this template yet.")
              : t("manage.planTemplates.mobilePreview.dslInvalid", "This template's plan text could not be read.")}
          </div>
          <div className="hra-text-secondary text-meta">
            {t("manage.plans.advancedEditingDesktopOnly", "Advanced editing is available from desktop.")}
          </div>
        </div>
      );
    }

    // mobileTemplateDslState already confirmed this parses to a real RunPlan
    // with a sections array — safe to parse again rather than threading the
    // parsed value back out of that check.
    const plan = JSON.parse(tpl.parsed_plan) as RunPlan;
    const sections = buildMobilePreviewSections(plan);
    const weekCount = sections.reduce((sum, s) => sum + s.weeks.length, 0);
    const totals = sumAggregateTotals(sections);
    const distanceLabel = mobileDistanceLabel(totals, t);

    return (
      <div className="flex flex-col gap-3">
        <div className="hra-text-secondary text-meta flex flex-col gap-0.5">
          <span>
            {t("runplan.accordion.totalDays", totals.totalDays === 1 ? "1 day" : `${totals.totalDays} days`, { count: totals.totalDays })}
            {" · "}
            {t("manage.planTemplates.mobilePreview.sectionCount", sections.length === 1 ? "1 section" : `${sections.length} sections`, { count: sections.length })}
            {" · "}
            {t("manage.planTemplates.mobileWeekCount", weekCount === 1 ? "1 week" : `${weekCount} weeks`, { count: weekCount })}
          </span>
          <span>
            {t("runplan.accordion.runningDays", `${totals.runningDays} running`, { n: totals.runningDays })}
            {" · "}
            {t("runplan.accordion.restDays", `${totals.restDays} rest`, { n: totals.restDays })}
            {totals.otherDays > 0 && <> · {t("runplan.accordion.otherDays", `${totals.otherDays} other`, { n: totals.otherDays })}</>}
            {" · "}
            {t("runplan.accordion.activeDays", `${totals.activeDays} active`, { n: totals.activeDays })}
          </span>
          {distanceLabel && (
            <span>{t("manage.planTemplates.mobilePreview.estimatedDistance", `Estimated distance: ${distanceLabel}`, { distance: distanceLabel })}</span>
          )}
          <span>{t("manage.planTemplates.mobilePreview.dslStatusValid", "Plan text is valid.")}</span>
        </div>

        {sections.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {sections.map((section, sectionIndex) => {
              const sectionExpanded = mobileExpandedSection === sectionIndex;
              return (
                <AccordionCard
                  key={sectionIndex}
                  title={
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="hra-text-primary text-body font-semibold overflow-hidden text-ellipsis">{section.name}</span>
                      <span className="hra-text-secondary text-meta">
                        {t("manage.planTemplates.mobileWeekCount", section.weeks.length === 1 ? "1 week" : `${section.weeks.length} weeks`, { count: section.weeks.length })}
                      </span>
                    </span>
                  }
                  expanded={sectionExpanded}
                  onToggle={() => {
                    setMobileExpandedSection(sectionExpanded ? null : sectionIndex);
                    setMobileExpandedWeek(null);
                  }}
                >
                  <div className="flex flex-col gap-1.5">
                    {section.weeks.map((week, weekIndex) => {
                      const weekKey = `${sectionIndex}-${weekIndex}`;
                      const weekExpanded = mobileExpandedWeek === weekKey;
                      return (
                        <AccordionCard
                          key={weekKey}
                          title={
                            <span className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="hra-text-primary text-body">{t("runplan.accordion.weekTitle", `Week ${week.number}`, { n: week.number })}</span>
                              <span className="hra-text-secondary text-meta">
                                {t("runplan.accordion.runningDays", `${week.totals.runningDays} running`, { n: week.totals.runningDays })}
                                {" · "}
                                {t("runplan.accordion.restDays", `${week.totals.restDays} rest`, { n: week.totals.restDays })}
                              </span>
                            </span>
                          }
                          expanded={weekExpanded}
                          onToggle={() => setMobileExpandedWeek(weekExpanded ? null : weekKey)}
                        >
                          {/* Reuses PlanInstanceCalendar.tsx's RibbonDay CSS
                              classes (the "existing mobile Agenda day-row
                              treatment" this Story's own description says to
                              reuse) — same compact label/dsl-line/wrap
                              behavior, just keyed by day-of-plan (D<n>) here
                              rather than a real calendar date. */}
                          <ol className="hra-agenda-ribbon" aria-label={t("manage.planTemplates.mobilePreview.workoutsLabel", "Workouts")}>
                            {week.days.map((day, dayIndex) => {
                              const { label, dslLines } = mobileDayPresentation(day, t);
                              return (
                                <li key={dayIndex} className="hra-agenda-ribbon-day">
                                  <span className="hra-agenda-ribbon-date">
                                    <span className="hra-agenda-ribbon-dow">{t("manage.planTemplates.mobilePreview.dayAbbrev", "Day")}</span>
                                    <span className="hra-agenda-ribbon-num">{day.day}{day.suffix ?? ""}</span>
                                  </span>
                                  <span className="hra-agenda-ribbon-body">
                                    <span className="hra-agenda-ribbon-label">
                                      {label && <span className="hra-agenda-ribbon-label-text">{label}</span>}
                                      {day.needs_review && (
                                        <span title={t("runplan.accordion.needsReviewBadge", "Needs review")} className="hra-text-warning inline-flex items-center shrink-0">
                                          <AlertTriangle size={12} />
                                        </span>
                                      )}
                                    </span>
                                    {dslLines.length > 0 && (
                                      <span className="hra-agenda-ribbon-dsl">
                                        {dslLines.map((line, i) => <span key={i} className="hra-agenda-ribbon-dsl-line">{line}</span>)}
                                      </span>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                          </ol>
                        </AccordionCard>
                      );
                    })}
                  </div>
                </AccordionCard>
              );
            })}
          </div>
        )}

        {/* AC6/AC7: HRA-302 (the simplified race-creation contract this
            button hands off into) doesn't exist yet — feature-gated as
            disabled rather than omitted, so the row still communicates the
            action exists, without opening any broken/partial/desktop-shaped
            flow in the meantime. */}
        <button
          type="button"
          className="hra-btn"
          data-variant="accent"
          disabled
          title={t("manage.planTemplates.mobilePreview.useForRaceComingSoon", "Race-plan creation from a template isn't available yet.")}
        >
          {t("manage.planTemplates.mobilePreview.useForRace", "Use for a race")}
        </button>

        <div className="hra-text-secondary text-meta">
          {t("manage.plans.advancedEditingDesktopOnly", "Advanced editing is available from desktop.")}
        </div>
      </div>
    );
  }

  // HRA-296: on phone, the whole authoring card (title/description/"How to
  // use it"/"New template"/AccordionCard editor/Delete overlay) is replaced
  // by a flat list of read-only summary rows — PlansTab.tsx owns the shared
  // segmented Modelli/Piani gara control and page-level contextual help this
  // card's own header used to carry. Desktop's return below is untouched.
  if (isPhone) {
    return (
      <div className="flex flex-col gap-2">
        {templatesError && <ErrorBanner message={templatesError} />}
        {templates === null ? (
          <div className="hra-text-muted text-meta">{t("common.loading", "Loading…")}</div>
        ) : templates.length === 0 ? (
          <div className="hra-text-muted text-meta">{t("manage.planTemplates.empty", "No templates saved yet.")}</div>
        ) : (
          templates.map(tpl => {
            const summary = summarizeTemplatePlan(tpl.parsed_plan);
            const expanded = mobileExpandedId === tpl.id;
            return (
              <AccordionCard
                key={tpl.id}
                title={
                  <span className="flex flex-col gap-0.5 flex-1 min-w-0 py-0.5 text-left">
                    <span className="overflow-hidden text-ellipsis text-wrap break-words hra-text-primary text-body font-semibold">
                      {tpl.name}
                    </span>
                    <span className="flex items-center gap-2 flex-wrap">
                      {tpl.event && <span className="hra-text-secondary text-meta">{t(`manage.planTemplates.event.${tpl.event}`, tpl.event)}</span>}
                      {summary && (
                        <span className="hra-text-secondary text-meta">
                          {t(
                            "manage.planTemplates.mobileWeekCount",
                            summary.weekCount === 1 ? "1 week" : `${summary.weekCount} weeks`,
                            { count: summary.weekCount },
                          )}
                        </span>
                      )}
                      {summary && <span className="hra-text-secondary text-meta">{summary.unit}</span>}
                      <Badge
                        label={tpl.approved_at ? t("manage.planTemplates.approved", "Activated") : t("manage.planTemplates.notApproved", "Not activated")}
                        color={tpl.approved_at ? "var(--accent-green)" : "var(--text-muted)"}
                      />
                    </span>
                  </span>
                }
                expanded={expanded}
                onToggle={() => {
                  const next = expanded ? null : tpl.id;
                  setMobileExpandedId(next);
                  // Reset progressive disclosure on every open/close so a
                  // freshly opened row never inherits a stale section/week
                  // expansion left over from a previously viewed template —
                  // opening reveals exactly one meaningful level (the first
                  // section) by default, per this Story's own AC.
                  setMobileExpandedSection(next != null ? 0 : null);
                  setMobileExpandedWeek(null);
                }}
              >
                {expanded ? renderMobileTemplatePreview(tpl) : null}
              </AccordionCard>
            );
          })
        )}
      </div>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <div className="hra-block-title">{t("manage.planTemplates.title", "Plan templates")}</div>
        <button className="hra-border-strong hra-text-secondary bg-transparent rounded-md py-1 px-2.5 text-meta cursor-pointer"  onClick={() => setShowHelp(true)}>
          {t("manage.planTemplates.howToUse", "How to use it")}
        </button>
      </div>
      <div className="hra-text-secondary text-meta mb-3" >
        {t("manage.planTemplates.description", "Reusable RunPlan DSL v1 templates — paced generically (symbolic anchors like RG), instantiated per race with concrete paces and a start date.")}
      </div>
      {showHelp && <PlanTemplateHelpModal onClose={() => setShowHelp(false)} />}
      {templatesError && <ErrorBanner message={templatesError} />}

      {templates === null ? (
        <div className="hra-text-muted text-meta" >{t("common.loading", "Loading…")}</div>
      ) : (
        <div className="flex flex-col gap-2 mb-3">
          {newDraftPending && (
            <AccordionCard
              title={
                <span className="flex items-center gap-2 flex-1 min-w-0">
                  <span className={isRowDirty("new") ? "hra-text-warning" : ""}>{name || t("manage.planTemplates.createTitle", "New template")}</span>
                  {rowStatusHint("new")}
                </span>
              }
              expanded={activeKey === "new"}
              onToggle={() => onToggleRow("new")}
            >
              {activeKey === "new" ? renderEditorFields() : null}
            </AccordionCard>
          )}
          {templates.length === 0 && !newDraftPending ? (
            <div className="hra-text-muted text-meta" >{t("manage.planTemplates.empty", "No templates saved yet.")}</div>
          ) : (
            templates.map(tpl => (
              // HRA-140 review, round 2: Delete is a real DOM SIBLING of the
              // AccordionCard (never nested inside its own header <button> —
              // still invalid HTML otherwise), just visually overlaid on top
              // of it via position:absolute + z-index, positioned left of the
              // chevron. This is what makes it clickable independent of the
              // header's own onToggle (the two elements don't overlap in the
              // DOM, only on screen) while reading as "inside the accordion"
              // rather than a separate column beside it — and, as a bonus
              // over the round-1 fix, works whether the row is expanded or
              // collapsed, same as before this Story touched it at all.
              <div key={tpl.id} className="relative">
                <AccordionCard title={renderRowTitle(tpl)} expanded={activeKey === tpl.id} onToggle={() => onToggleRow(tpl.id)}>
                  {activeKey === tpl.id ? renderEditorFields() : null}
                </AccordionCard>
                <button
                  className="hra-card-delete-action hra-btn absolute py-1 px-2 inline-flex items-center" data-variant="danger"
                  onClick={() => setDeleteConfirmId(tpl.id)}
                  disabled={demoMode}
                  title={demoMode ? t("common.demoModeHint", "Not available for demo") : t("common.delete", "Delete")}
                  aria-label={t("common.delete", "Delete")}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
      {deleteError && <ErrorBanner message={deleteError} />}
      <button className="hra-btn" data-variant="accent" onClick={() => onToggleRow("new")} disabled={newDraftPending}>
        {t("manage.planTemplates.newTemplate", "New template")}
      </button>

      {/* One shared confirm modal (not per-row) — deleteConfirmId already
          uniquely identifies the target, and only one can ever be pending
          at a time. */}
      {deleteConfirmId != null && (
        <div className="hra-modal-layer hra-modal-backdrop fixed inset-0 flex items-center justify-center p-6" onClick={() => setDeleteConfirmId(null)}>
          <div className="hra-bg-surface hra-border rounded-xl w-full max-w-90 p-5"  onClick={e => e.stopPropagation()}>
            <div className="hra-text-primary text-label font-semibold leading-normal mb-4" >
              {t("manage.planTemplates.deleteConfirm", "Delete? This also removes every instance derived from it.")}
            </div>
            <div className="hra-row-wrap justify-end" >
              <button className="hra-border-strong hra-text-secondary bg-transparent rounded-md py-1.5 px-3.5 text-meta cursor-pointer"  onClick={() => setDeleteConfirmId(null)}>
                {t("common.cancel", "Cancel")}
              </button>
              <button
                className="hra-btn hra-btn-icon-label" data-variant="danger" onClick={() => onDelete(deleteConfirmId)}
                aria-label={t("common.yesDelete", "Yes, delete")}
              >
                <Trash2 size={14} />
                <span className="hra-btn-label">{t("common.yesDelete", "Yes, delete")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
