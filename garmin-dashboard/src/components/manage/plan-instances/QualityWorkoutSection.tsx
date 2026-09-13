/**
 * QualityWorkoutSection.tsx (HRA-342)
 * Structured quality-workout comparison for the single-workout report —
 * repetitions/intervals, threshold/cruise, tempo, and progressive workouts,
 * backed by WorkoutReport.structuredQualityEvidence
 * (garmin-stats/src/domain/reporting/{quality-workout,quality-evidence}.ts).
 * This component does no calculation of its own (same guardrail as
 * WorkoutReportModal.tsx's own top-of-file comment) — it only renders the
 * already-computed canonical structure + aligned evidence, and lets the
 * runner confirm/correct/replace/remove a manual segment alignment (the only
 * reliable-evidence tier this app currently persists — executed-step/lap
 * ingestion doesn't exist yet, see quality-evidence.ts).
 *
 * Mobile-first progressive disclosure (AC15): a concise work summary is
 * always visible; the per-repetition/block table sits behind an
 * AccordionCard, collapsed by default.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/api/client";
import { fmtDuration, fmtKm, fmtPace } from "@/utils/fmt";
import { AccordionCard, Empty, Select } from "@/components/ui";
import { notify } from "@/utils/toast";
import type { AlignedWorkSegment, WorkoutActualEvidence, WorkoutStructuredQualityEvidence } from "@/types/api";

interface Props {
  instanceId: number;
  workoutId: string;
  structuredQualityEvidence: WorkoutStructuredQualityEvidence;
  acceptedEvidence: WorkoutActualEvidence[];
  onChanged: () => void;
}

function kindLabel(t: (k: string, d: string) => string, kind: string): string {
  if (kind === "repetition") return t("qualityWorkout.kind.repetition", "Repetitions");
  if (kind === "threshold") return t("qualityWorkout.kind.threshold", "Threshold");
  if (kind === "tempo") return t("qualityWorkout.kind.tempo", "Tempo");
  return t("qualityWorkout.kind.progressive", "Progressive");
}

function provenanceLabel(t: (k: string, d: string) => string, provenance: string): string {
  if (provenance === "executed_step") return t("qualityWorkout.provenance.executedStep", "Device step");
  if (provenance === "lap") return t("qualityWorkout.provenance.lap", "Lap");
  if (provenance === "manual") return t("qualityWorkout.provenance.manual", "Manual");
  return t("qualityWorkout.provenance.unavailable", "Unavailable");
}

function paceCell(secPerKm: number | null): string {
  return secPerKm != null ? `${fmtPace(secPerKm / 60)}/km` : "—";
}

function AlignmentForm({
  instanceId, workoutId, segmentIndex, acceptedEvidence, existing, onDone,
}: {
  instanceId: number; workoutId: string; segmentIndex: number;
  acceptedEvidence: WorkoutActualEvidence[]; existing: AlignedWorkSegment["actual"]; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [activityId, setActivityId] = useState<number | "">(existing.activityId ?? (acceptedEvidence[0]?.activityId ?? ""));
  const [distanceM, setDistanceM] = useState(existing.distanceM != null ? String(existing.distanceM) : "");
  const [durationSec, setDurationSec] = useState(existing.durationSec != null ? String(existing.durationSec) : "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (activityId === "") { notify(t("qualityWorkout.errorNoActivity", "Select an activity first."), "error"); return; }
    setSaving(true);
    try {
      await api.planInstances.setQualityAlignment(
        instanceId, workoutId, segmentIndex, activityId,
        distanceM.trim() === "" ? null : Number(distanceM), durationSec.trim() === "" ? null : Number(durationSec),
      );
      notify(t("qualityWorkout.saved", "Alignment saved."));
      onDone();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("qualityWorkout.saveFailed", "Could not save alignment."), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api.planInstances.removeQualityAlignment(instanceId, workoutId, segmentIndex);
      notify(t("qualityWorkout.removed", "Alignment removed."));
      onDone();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("qualityWorkout.removeFailed", "Could not remove alignment."), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-2 hra-border rounded-lg">
      <label className="hra-text-secondary text-meta flex flex-col gap-1">
        {t("qualityWorkout.form.activity", "Activity")}
        <Select
          value={activityId === "" ? "" : String(activityId)}
          onValueChange={v => setActivityId(v === "" ? "" : Number(v))}
          options={acceptedEvidence.map(a => ({ value: String(a.activityId), label: `#${a.activityId}` }))}
          placeholder={t("qualityWorkout.form.noActivity", "No accepted activity yet")}
          disabled={acceptedEvidence.length === 0}
          ariaLabel={t("qualityWorkout.form.activity", "Activity")}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="hra-text-secondary text-meta flex flex-col gap-1">
          {t("qualityWorkout.form.distanceM", "Distance (m)")}
          <input
            type="number" inputMode="decimal" value={distanceM} onChange={e => setDistanceM(e.target.value)}
            className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 text-body p-2 rounded-lg"
            aria-label={t("qualityWorkout.form.distanceM", "Distance (m)")}
          />
        </label>
        <label className="hra-text-secondary text-meta flex flex-col gap-1">
          {t("qualityWorkout.form.durationSec", "Duration (s)")}
          <input
            type="number" inputMode="decimal" value={durationSec} onChange={e => setDurationSec(e.target.value)}
            className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 text-body p-2 rounded-lg"
            aria-label={t("qualityWorkout.form.durationSec", "Duration (s)")}
          />
        </label>
      </div>
      <div className="flex gap-2 justify-end">
        {existing.provenance === "manual" && (
          <button type="button" className="hra-btn" data-variant="outline" disabled={saving} onClick={remove}>
            {t("qualityWorkout.form.remove", "Remove")}
          </button>
        )}
        <button type="button" className="hra-btn" data-variant="accent" disabled={saving || acceptedEvidence.length === 0} onClick={save}>
          {t("qualityWorkout.form.save", "Save")}
        </button>
      </div>
    </div>
  );
}

function SegmentRow({
  row, instanceId, workoutId, acceptedEvidence, onChanged,
}: {
  row: AlignedWorkSegment; instanceId: number; workoutId: string; acceptedEvidence: WorkoutActualEvidence[]; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const { segment, actual } = row;
  const isRecovery = segment.role === "recovery";

  return (
    <>
      <tr className={isRecovery ? "hra-text-muted" : "hra-text-primary"}>
        <td className="text-meta">{segment.index + 1}</td>
        <td className="text-meta">{isRecovery ? t("qualityWorkout.table.recovery", "Recovery") : t("qualityWorkout.table.work", "Work")}</td>
        <td className="text-body">{fmtKm(segment.targetDistanceM)}</td>
        <td className="text-body">
          {paceCell(segment.targetPaceSecPerKm)}
          {segment.targetPaceSecPerKmEnd != null && segment.targetPaceSecPerKmEnd !== segment.targetPaceSecPerKm
            ? ` → ${paceCell(segment.targetPaceSecPerKmEnd)}` : ""}
        </td>
        <td className="text-body">{actual.distanceM != null ? fmtKm(actual.distanceM) : "—"}</td>
        <td className="text-body">{paceCell(actual.paceSecPerKm)}</td>
        <td className="text-meta">{provenanceLabel(t, actual.provenance)}</td>
        <td>
          {!isRecovery && (
            // Label-in-Name (WCAG 2.5.3): the accessible name must contain the
            // visible text, so the row number goes in a visually-hidden
            // SUFFIX rather than a wholly different aria-label overriding it.
            <button type="button" className="hra-btn text-meta" data-variant="outline" onClick={() => setEditing(v => !v)}>
              {actual.provenance === "manual" ? t("qualityWorkout.table.edit", "Edit") : t("qualityWorkout.table.align", "Align")}
              <span className="sr-only">
                {t("qualityWorkout.table.editAriaSuffix", ` for work segment ${segment.index + 1}`, { n: segment.index + 1 })}
              </span>
            </button>
          )}
        </td>
      </tr>
      {editing && !isRecovery && (
        <tr>
          <td colSpan={8}>
            <AlignmentForm
              instanceId={instanceId} workoutId={workoutId} segmentIndex={segment.index}
              acceptedEvidence={acceptedEvidence} existing={actual}
              onDone={() => { setEditing(false); onChanged(); }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export function QualityWorkoutSection({ instanceId, workoutId, structuredQualityEvidence, acceptedEvidence, onChanged }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (!("kind" in structuredQualityEvidence)) return null; // not_applicable — a plain non-quality day, nothing to show

  const sqe = structuredQualityEvidence;
  const { totals } = sqe;

  return (
    <div className="hra-border-strong rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="hra-text-primary text-label font-semibold">
          {t("qualityWorkout.title", `Structured comparison — ${kindLabel(t, sqe.kind)}`, { kind: kindLabel(t, sqe.kind) })}
        </span>
        <span className="hra-text-muted text-meta">
          {t("qualityWorkout.coverage", `${totals.coverage.alignedWorkSegments} of ${totals.coverage.totalWorkSegments} aligned`,
            { aligned: totals.coverage.alignedWorkSegments, total: totals.coverage.totalWorkSegments })}
        </span>
      </div>

      {!sqe.available && (
        <Empty message={t("qualityWorkout.unavailable", "Structured execution isn't reliably available yet — showing planned targets and the existing pace-band chart only.")} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="hra-text-secondary text-meta font-semibold">{t("qualityWorkout.planned", "Planned work")}</span>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.distance", "Distance")}</span>
            <span className="hra-text-primary text-body">{fmtKm(totals.plannedWorkDistanceM)}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.duration", "Duration")}</span>
            <span className="hra-text-primary text-body">{fmtDuration(totals.plannedWorkDurationSec)}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="hra-text-secondary text-meta font-semibold">{t("qualityWorkout.actual", "Actual work (aligned only)")}</span>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.distance", "Distance")}</span>
            <span className="hra-text-primary text-body">{sqe.available ? fmtKm(totals.actualWorkDistanceM) : "—"}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.pace", "Pace")}</span>
            <span className="hra-text-primary text-body">{paceCell(totals.weightedActualPaceSecPerKm)}</span>
          </div>
          {totals.paceSpreadSecPerKm && (
            <div className="hra-fact-row">
              <span className="hra-text-muted text-meta">{t("qualityWorkout.spread", "Fastest–slowest")}</span>
              <span className="hra-text-primary text-body">{paceCell(totals.paceSpreadSecPerKm.fastest)} – {paceCell(totals.paceSpreadSecPerKm.slowest)}</span>
            </div>
          )}
          {totals.progressivelyFaster != null && (
            <div className="hra-fact-row">
              <span className="hra-text-muted text-meta">{t("qualityWorkout.progression", "Got progressively faster")}</span>
              <span className="hra-text-primary text-body">
                {totals.progressivelyFaster ? t("qualityWorkout.progressionYes", "Yes") : t("qualityWorkout.progressionNo", "No")}
              </span>
            </div>
          )}
        </div>
      </div>

      {sqe.wholeSessionPaceSecPerKm != null && (
        <span className="hra-text-muted text-meta">
          {t("qualityWorkout.wholeSessionContext", `Whole-session average pace (context only, not adherence): ${paceCell(sqe.wholeSessionPaceSecPerKm)}`, { pace: paceCell(sqe.wholeSessionPaceSecPerKm) })}
        </span>
      )}

      <AccordionCard title={t("qualityWorkout.detailTitle", "Repetitions / blocks")} expanded={expanded} onToggle={() => setExpanded(v => !v)}>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{t("qualityWorkout.tableCaption", "Every planned and aligned repetition, block, or phase for this workout")}</caption>
            <thead>
              <tr className="hra-text-muted text-meta">
                <th scope="col">{t("qualityWorkout.table.n", "#")}</th>
                <th scope="col">{t("qualityWorkout.table.role", "Role")}</th>
                <th scope="col">{t("qualityWorkout.table.plannedDistance", "Planned dist.")}</th>
                <th scope="col">{t("qualityWorkout.table.plannedPace", "Planned pace")}</th>
                <th scope="col">{t("qualityWorkout.table.actualDistance", "Actual dist.")}</th>
                <th scope="col">{t("qualityWorkout.table.actualPace", "Actual pace")}</th>
                <th scope="col">{t("qualityWorkout.table.source", "Source")}</th>
                <th scope="col"><span className="sr-only">{t("qualityWorkout.table.actions", "Actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {sqe.segments.map(row => (
                <SegmentRow
                  key={row.segment.index} row={row} instanceId={instanceId} workoutId={workoutId}
                  acceptedEvidence={acceptedEvidence} onChanged={onChanged}
                />
              ))}
            </tbody>
          </table>
        </div>
      </AccordionCard>
    </div>
  );
}
