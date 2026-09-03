import type { SectionView } from "@/domain/runplan-aggregate";
import type { RunPlan } from "@/types/runplan";
import { isoToday } from "@/utils/date";
import { anchorRowIsEmpty, type PlanInstanceEditorState } from "./planInstanceEditor.model";

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000);
}

export function addDaysISO(dateISO: string, days: number): string {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function computeK0(plan: RunPlan): number | null {
  let k0: number | null = null;
  for (const section of plan.sections) {
    for (const week of section.weeks) {
      if (week.number !== 1) continue;
      for (const day of week.days) {
        if (k0 === null || day.day < k0) k0 = day.day;
      }
    }
  }
  return k0;
}

export function mondayBasedWeekday(dateISO: string): number {
  return (new Date(`${dateISO}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function editorWeek1AnchorMismatch(sections: SectionView[]): boolean {
  return sections.some(section => section.weeks.some(week => {
    if (week.number !== 1 || week.days.length === 0) return false;
    const k0Day = week.days.reduce((min, day) => (day.day < min.day ? day : min));
    return k0Day.date != null && mondayBasedWeekday(k0Day.date) !== (k0Day.day - 1) % 7;
  }));
}

export function hasEnteredData(state: PlanInstanceEditorState): boolean {
  if (
    state.instName.trim() !== "" ||
    state.raceName.trim() !== "" ||
    state.raceDate !== "" ||
    state.raceUrl.trim() !== ""
  ) return true;
  if (state.startDate !== isoToday()) return true;
  if (state.daysBeforeRace.trim() !== "") return true;
  if (state.restDayLabel.trim() !== "") return true;
  if (state.goalTimeDigits !== "" || state.distanceM.trim() !== "") return true;
  if (state.racePaceAnchor !== "__none__") return true;
  return Object.values(state.anchorRows).some(row => !anchorRowIsEmpty(row));
}

export function manualEditCount(
  sections: SectionView[],
  persistedDsl: Record<string, string>,
  cutover: string,
): number {
  let count = 0;
  sections.forEach(section => section.weeks.forEach(week => week.days.forEach(day => {
    if (
      day.date != null &&
      day.date >= cutover &&
      persistedDsl[day.date] !== undefined &&
      persistedDsl[day.date] !== day.dsl
    ) count++;
  })));
  return count;
}

export interface PlanInstanceDirtyState {
  anchorRowsChanged: boolean;
  goalTimeFieldsChanged: boolean;
  regenerateBucketDirty: boolean;
  anyDayDirty: boolean;
  saveBucketDirty: boolean;
  saveEnabled: boolean;
  regenerateDisabled: boolean;
  isDirty: boolean;
}

function anchorRowsEqual(
  left: PlanInstanceEditorState["anchorRows"],
  right: PlanInstanceEditorState["baseline"]["anchorRows"],
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => {
    const a = left[key];
    const b = right[key];
    return b != null &&
      a.absoluteValue === b.absoluteValue &&
      a.relativeTo === b.relativeTo &&
      a.sign === b.sign &&
      a.seconds === b.seconds;
  });
}

export function selectDirtyState(
  state: PlanInstanceEditorState,
  options: { fieldsLocked: boolean; isApproved: boolean; regenerateLoading: boolean },
): PlanInstanceDirtyState {
  const { baseline } = state;
  const anchorRowsChanged = !anchorRowsEqual(state.anchorRows, baseline.anchorRows);
  const goalTimeFieldsChanged = state.paceMode === "goalTime" && (
    state.goalTimeDigits !== baseline.goalTimeDigits || state.distanceM !== baseline.distanceM
  );

  const regenerateBucketDirty = options.fieldsLocked && !options.isApproved && (
    state.startDate !== baseline.startDate ||
    state.racePaceAnchor !== baseline.racePaceAnchor ||
    state.paceMode !== baseline.paceMode ||
    anchorRowsChanged ||
    goalTimeFieldsChanged
  );

  const anyDayDirty = state.sections.some(section => section.weeks.some(week => week.days.some(day =>
    day.date != null && baseline.persistedDsl[day.date] !== undefined && baseline.persistedDsl[day.date] !== day.dsl,
  )));

  // HRA-249: no longer excludes an approved instance — Save/day-edit are no
  // longer force-disabled once approved (only the top form fields stay
  // locked, via fieldDisabled elsewhere), so a day edit on an approved
  // instance must still be able to enable Save. instName/raceName/raceDate/
  // raceUrl can never actually diverge from baseline while approved (those
  // fields stay disabled), so anyDayDirty is the only term this drops the
  // isApproved guard for in practice.
  const saveBucketDirty = options.fieldsLocked && (
    state.instName.trim() !== baseline.instName ||
    state.raceName.trim() !== baseline.raceName ||
    state.raceDate !== baseline.raceDate ||
    state.raceUrl.trim() !== baseline.raceUrl ||
    anyDayDirty
  );

  const saveEnabled = !regenerateBucketDirty && (saveBucketDirty || state.saveForcedEnabled);
  const regenerateDisabled = options.regenerateLoading || !regenerateBucketDirty || options.isApproved;

  return {
    anchorRowsChanged,
    goalTimeFieldsChanged,
    regenerateBucketDirty,
    anyDayDirty,
    saveBucketDirty,
    saveEnabled,
    regenerateDisabled,
    isDirty: saveBucketDirty || regenerateBucketDirty,
  };
}
