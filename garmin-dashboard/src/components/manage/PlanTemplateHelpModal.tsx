/**
 * PlanTemplateHelpModal.tsx (follow-up to HRA-120)
 * "How to use it" reference for the RunPlan DSL v1 template editor —
 * grammar, workout syntax, pace anchors, placeholders, a worked example, and
 * the Save-vs-Approve distinction (docs/runplan-dsl.md, docs/schema.md).
 * Triggered from PlanTemplatesSection's list view.
 *
 * Explanatory prose is localized via t(). The DSL syntax reference and the
 * worked example block are deliberately NOT translated — they're literal
 * syntax the parser expects verbatim regardless of locale (the same
 * exemption class as a date/unit format hint, and docs/runplan-dsl.md's own
 * convention of keeping DSL keywords in English).
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  onClose: () => void;
}

const SEGMENT_SYNTAX = `10km @ RG                                # continuous: target @ intensity
4x1000m @ RG-20 r:400m @ EASY            # interval: reps x target @ intensity, optional r: rest leg
10km PROG FL->RG                         # progression: target PROG start-intensity -> end-intensity
15km @ FL ; 8x100m @ STRIDE r:1min walk  # multi-segment day, ; separated`;

const WORKED_EXAMPLE = `SECTION "Base" WEEKS 1-2
PACE RG=4:16/km
PACE FL=RG+45s/km

WEEK 1
D1 [easy]: 10km @ FL
D2 [interval]: 4x1000m @ RG-10 r:400m @ FL
D3: REST
D4 [cross]: CROSS 45min bike
D5 [progression]: 10km PROG FL->RG
D6 [long]: 18km @ FL
D7: REST

WEEK 2
PACE RG=4:14/km
D1 [easy]: 10km @ FL
D2 [strides]: 30min @ FL ; 8x100m @ STRIDE r:1min walk
D3: TODO
D4 [race]: 21.1km @ RG`;

export function PlanTemplateHelpModal({ onClose }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const sections: { heading: string; body: string; code?: string }[] = [
    {
      heading: t("manage.planTemplates.help.overview.heading", "What a template is"),
      body: t(
        "manage.planTemplates.help.overview.body",
        "A template describes the reusable structure of a training plan — weeks, days, and workouts — without committing to a race date or concrete pace numbers. Pace anchors like RG (race goal) or FL (fartlek/easy) stay symbolic. A template is later instantiated into a concrete instance for one specific race, where paces get resolved to real numbers and days get real calendar dates.",
      ),
    },
    {
      heading: t("manage.planTemplates.help.fields.heading", "Name, Event type, Distance"),
      body: t(
        "manage.planTemplates.help.fields.body",
        "Name is just a label. Event type is required — one of 5K, 10K, Half-Marathon, Marathon, or Custom. For the four standard events, Distance is filled in automatically with that event's official distance and can't be edited, since overriding a marathon's distance wouldn't mean anything. Choosing Custom clears Distance and makes it — and the km/mi switch next to it — editable, because a custom event has no fixed distance of its own.",
      ),
    },
    {
      heading: t("manage.planTemplates.help.aiPrompt.heading", "Transcribing a messy plan with AI"),
      body: t(
        "manage.planTemplates.help.aiPrompt.body",
        "Have a plan as a PDF, prose, or another language? Paste it into \"Original text\" and click \"Generate full prompt\" to get a ready-to-copy LLM prompt (optionally telling it which language to use for notes). Copy that prompt and run it externally against an LLM — this app doesn't call one itself — then paste the DSL it returns into the DSL text field below to continue as usual.",
      ),
    },
    {
      heading: t("manage.planTemplates.help.headerLines.heading", "The DSL text — header lines are optional"),
      body: t(
        "manage.planTemplates.help.headerLines.body",
        "You almost never need to write anything before the first SECTION, WEEK, or DAY line. PLAN, NAME, EVENT, DISTANCE, GOAL, and a plan-level START used to be required or meaningful in older versions of this format — they no longer are. If you paste a plan that still has them, they're recognized and silently ignored: no warning, nothing saved from them. Event type and Distance now always come from the two fields above the text box, never from the DSL text.",
      ),
    },
    {
      heading: t("manage.planTemplates.help.structure.heading", "Structure: sections, weeks, days"),
      body: t(
        "manage.planTemplates.help.structure.body",
        "SECTION \"<name>\" WEEKS <range> groups weeks into a labeled phase (Base, Build, Taper…) — optional; a plan with no SECTION line at all gets one implicit section using the template's own name. WEEK <n> [START <date>] starts a new week — the START date is only useful for a template meant to be instantiated with weeks pinned to fixed calendar dates, and is otherwise unnecessary, since the real start date is always supplied when you instantiate. Each day is one line: D<1-7><a/b?> [tag]: <workout> — D1 through D7, an optional a/b suffix for two sessions the same day, and an optional [tag] like [interval] or [race] shown in the review view. A trailing \"# note\" on a SECTION/WEEK/DAY line is kept as a note.",
      ),
    },
    {
      heading: t("manage.planTemplates.help.paceAnchors.heading", "Pace anchors — RG, FL, and friends"),
      body: t(
        "manage.planTemplates.help.paceAnchors.body",
        "PACE <ANCHOR>=<value> defines a named pace, e.g. PACE RG=4:16/km or PACE FL=RG+45s/km (an anchor can be defined relative to another one). Where the line sits matters: before any SECTION/WEEK it applies to the whole plan; inside a SECTION but before a WEEK, to that section; inside a WEEK, to just that week — the more specific one always wins for the same anchor name. You don't have to define every anchor you use: one with no PACE line at all is simply treated as symbolic and gets filled in later, at instantiate time, from a goal time or an explicit override. This never blocks saving the template.",
      ),
    },
    {
      heading: t("manage.planTemplates.help.workouts.heading", "Writing a workout"),
      body: t(
        "manage.planTemplates.help.workouts.body",
        "After the colon, a day is one of: REST (a rest day); TODO (not planned yet); CROSS <description> or STRENGTH <description> (no target needed, just a description — e.g. \"CROSS 45min bike\"); or one or more real running segments, separated by \";\" when there's more than one in the same day.",
      ),
      code: SEGMENT_SYNTAX,
    },
    {
      heading: t("manage.planTemplates.help.targets.heading", "Targets and paces"),
      body: t(
        "manage.planTemplates.help.targets.body",
        "A target is a distance (500m, 3km, 1mi) or a duration (30s, 5min, 30', 2h). An intensity is a pace anchor (RG), an anchor with a +/- offset in seconds per km or mile (RG-20 is 20 seconds/km faster than RG; RG+25s/mi is 25 seconds/mile slower), or an absolute pace (4:16/km, 6:55/mi).",
      ),
    },
    {
      heading: t("manage.planTemplates.help.placeholders.heading", "When you don't know something yet"),
      body: t(
        "manage.planTemplates.help.placeholders.body",
        "Use ? anywhere a target, intensity, or rep count is expected but not decided yet — \"8x? @ ?\" is valid and gets flagged for review, without blocking anything else on that day. Use TODO for a whole day that isn't planned at all. Use PACE X=TBD to mark a pace anchor as \"not decided yet\" explicitly — it documents intent, but is functionally the same as just not defining that anchor at all.",
      ),
    },
    {
      heading: t("manage.planTemplates.help.saveApprove.heading", "Save vs Approve"),
      body: t(
        "manage.planTemplates.help.saveApprove.body",
        "Save persists the template — but only if the DSL parses and has no outstanding warnings anywhere in it; that's an automatic gate. Approve is a separate, deliberate step: a human sign-off on the exact version that's currently saved. It only becomes available once the template is saved with nothing unsaved pending, and any further edit — even one that saves cleanly again — clears the approval, because it was a sign-off on one specific version, not a general \"this is fine\".",
      ),
    },
    {
      heading: t("manage.planTemplates.help.example.heading", "A worked example"),
      body: t(
        "manage.planTemplates.help.example.body",
        "A short two-week block: a base-phase section, plan-level paces overridden for week 2, an interval day, a cross-training day, a progression, rest days, an undecided day, and a race day.",
      ),
      code: WORKED_EXAMPLE,
    },
  ];

  return (
    <div
      className="hra-modal-layer hra-modal-backdrop fixed inset-0 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="hra-help-modal hra-bg-surface hra-border rounded-2xl w-full max-w-160 overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="hra-block-title">{t("manage.planTemplates.help.title", "How to write a template")}</div>
          <button
            onClick={onClose}
            aria-label={t("common.close", "Close")}
            className="hra-tight-action hra-border-strong hra-text-secondary bg-transparent rounded-md text-meta cursor-pointer"
          >
            {t("common.close", "Close")}
          </button>
        </div>

        {sections.map((section, i) => (
          <div key={i} className="hra-help-section">
            <div className="hra-text-primary text-label font-semibold mb-1.5" >{section.heading}</div>
            <div className="hra-help-copy hra-text-secondary text-meta">{section.body}</div>
            {section.code && (
              <pre
                className="hra-border-strong hra-bg-card mt-2 p-2.5 rounded-lg font-mono text-meta overflow-x-auto whitespace-pre"
              >
                {section.code}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
