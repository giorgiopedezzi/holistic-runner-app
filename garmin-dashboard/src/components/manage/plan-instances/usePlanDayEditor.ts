import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { TFunction } from "i18next";
import { api } from "@/api/client";
import { DAY_PREFIX_RE, type DayRef, type WeekRef, type WorkoutTypeSwitchValue } from "@/components/TrainingPlanAccordion";
import {
  aggregateDayViews,
  computeResolvedDayDistance,
  type DayView,
  type SectionView,
  type WeekView,
} from "@/domain/runplan-aggregate";
import { recomposeDayLine, splitNote, swapDayContent } from "@/domain/runplan-patch";
import type { WorkoutType } from "@/types/runplan";
import { notify } from "@/utils/toast";

export interface WorkoutTypeChange {
  sectionIndex: number;
  weekIndex: number;
  dayIndex: number;
  workoutType: WorkoutTypeSwitchValue;
}

interface UsePlanDayEditorArgs {
  editingId: number | null;
  sections: SectionView[];
  setSections: Dispatch<SetStateAction<SectionView[]>> | ((value: SetStateAction<SectionView[]>) => void);
  t: TFunction;
}

function recomputeTotals(
  sections: SectionView[],
  sectionIndex: number,
  weekIndex: number,
): SectionView[] {
  const next = [...sections];
  const section = { ...next[sectionIndex] };
  const weeks = [...section.weeks];
  weeks[weekIndex] = { ...weeks[weekIndex], totals: aggregateDayViews(weeks[weekIndex].days) };
  section.weeks = weeks;
  section.totals = aggregateDayViews(weeks.flatMap(week => week.days));
  next[sectionIndex] = section;
  return next;
}

export function usePlanDayEditor({ editingId, sections, setSections, t }: UsePlanDayEditorArgs) {
  const sectionsRef = useRef(sections);
  const validateTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  useEffect(() => () => {
    Object.values(validateTimers.current).forEach(clearTimeout);
  }, []);

  function patchLocalDayResolved(
    sectionIndex: number,
    weekIndex: number,
    dayIndex: number,
    patch: Partial<DayView>,
  ) {
    setSections(prev => {
      const next = [...prev];
      const section = { ...next[sectionIndex] };
      const weeks = [...section.weeks];
      const days = [...weeks[weekIndex].days];
      days[dayIndex] = { ...days[dayIndex], ...patch };
      weeks[weekIndex] = { ...weeks[weekIndex], days };
      section.weeks = weeks;
      next[sectionIndex] = section;
      return recomputeTotals(next, sectionIndex, weekIndex);
    });
  }

  function scheduleLiveValidate(
    sectionIndex: number,
    weekIndex: number,
    dayIndex: number,
    dayId: number,
    dsl: string,
  ) {
    clearTimeout(validateTimers.current[dayId]);
    validateTimers.current[dayId] = setTimeout(() => {
      delete validateTimers.current[dayId];
      if (editingId == null) return;

      api.planInstances.validateDay(editingId, dayId, dsl)
        .then(result => {
          const liveDay = sectionsRef.current[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
          if (!liveDay || liveDay.id !== dayId || liveDay.dsl !== dsl) return;

          const patch: Partial<DayView> = {
            needs_review: result.needs_review,
            warnings: result.warnings,
          };
          if (result.workout_type !== undefined && result.segments !== undefined) {
            patch.workout_type = result.workout_type;
            patch.distance = computeResolvedDayDistance({
              section_name: "",
              week_number: 0,
              date: liveDay.date ?? "",
              day: liveDay.day,
              suffix: liveDay.suffix,
              category: liveDay.category,
              workout_type: result.workout_type,
              segments: result.segments,
              activity_target: result.activity_target ?? undefined,
              activity_description: result.activity_description ?? undefined,
              notes: liveDay.notes,
              needs_review: result.needs_review,
            });
          }
          patchLocalDayResolved(sectionIndex, weekIndex, dayIndex, patch);
        })
        .catch(() => {});
    }, 400);
  }

  function onDayEdit(
    sectionIndex: number,
    weekIndex: number,
    dayIndex: number,
    patch: { dsl?: string; notes?: string },
  ) {
    const day = sections[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
    if (!day) return;
    const newLine = recomposeDayLine(day.dsl, patch);

    setSections(prev => {
      const next = [...prev];
      const section = { ...next[sectionIndex] };
      const weeks = [...section.weeks];
      const week = { ...weeks[weekIndex] };
      const days = [...week.days];
      days[dayIndex] = { ...days[dayIndex], dsl: newLine, notes: splitNote(newLine).note };
      week.days = days;
      weeks[weekIndex] = week;
      section.weeks = weeks;
      next[sectionIndex] = section;
      return next;
    });

    if (patch.dsl !== undefined && day.id != null) {
      scheduleLiveValidate(sectionIndex, weekIndex, dayIndex, day.id, newLine);
    }
  }

  function dayStateAt(sectionIndex: number, weekIndex: number, dayIndex: number) {
    return sections[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
  }

  function patchLocalDayScheduledTime(
    sectionIndex: number,
    weekIndex: number,
    dayIndex: number,
    scheduledTime: string | null | undefined,
  ) {
    setSections(prev => {
      const next = [...prev];
      const section = { ...next[sectionIndex] };
      const weeks = [...section.weeks];
      const week = { ...weeks[weekIndex] };
      const days = [...week.days];
      days[dayIndex] = { ...days[dayIndex], scheduled_time: scheduledTime };
      week.days = days;
      weeks[weekIndex] = week;
      section.weeks = weeks;
      next[sectionIndex] = section;
      return next;
    });
  }

  async function onScheduledTimeEdit(
    sectionIndex: number,
    weekIndex: number,
    dayIndex: number,
    scheduledTime: string | null,
  ) {
    if (editingId == null) return;
    const day = dayStateAt(sectionIndex, weekIndex, dayIndex);
    if (day?.id == null) return;
    const previous = day.scheduled_time;
    patchLocalDayScheduledTime(sectionIndex, weekIndex, dayIndex, scheduledTime);

    try {
      const updated = await api.planInstances.patchDay(editingId, day.id, { scheduled_time: scheduledTime });
      patchLocalDayScheduledTime(sectionIndex, weekIndex, dayIndex, updated.scheduled_time);
    } catch (error) {
      patchLocalDayScheduledTime(sectionIndex, weekIndex, dayIndex, previous);
      notify(error instanceof Error ? error.message : t("manage.planInstances.scheduledTimeFailed", "Failed to save scheduled time"), "error");
    }
  }

  function findDayIndicesById(dayId: number): DayRef | null {
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      for (let weekIndex = 0; weekIndex < sections[sectionIndex].weeks.length; weekIndex++) {
        const dayIndex = sections[sectionIndex].weeks[weekIndex].days.findIndex(day => day.id === dayId);
        if (dayIndex !== -1) return { sectionIndex, weekIndex, dayIndex };
      }
    }
    return null;
  }

  function onScheduledTimeEditByDayId(dayId: number, scheduledTime: string | null) {
    const ref = findDayIndicesById(dayId);
    if (!ref) return;
    void onScheduledTimeEdit(ref.sectionIndex, ref.weekIndex, ref.dayIndex, scheduledTime);
  }

  function applyWorkoutTypeChange(change: WorkoutTypeChange) {
    const { sectionIndex, weekIndex, dayIndex, workoutType } = change;
    const day = sections[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
    if (!day) return;

    const dayPrefix = day.dsl.match(DAY_PREFIX_RE)?.[0] ?? "";
    const newBody = workoutType === "rest" ? "REST" : workoutType === "other" ? "OTHER" : "";
    const newDsl = recomposeDayLine(`${dayPrefix}${newBody}`, { notes: day.notes });
    onDayEdit(sectionIndex, weekIndex, dayIndex, { dsl: newDsl });
    patchLocalDayResolved(sectionIndex, weekIndex, dayIndex, {
      workout_type: workoutType as WorkoutType,
      distance: { meters: 0, approximate: false },
    });
    notify(t("manage.planInstances.workoutTypeChanged", "Day type updated — remember to Save."));
  }

  async function persistSwappedScheduledTimes(
    pairs: { day: DayView; newScheduledTime: string | null | undefined }[],
  ) {
    if (editingId == null) return;
    const instanceId = editingId;
    const results = await Promise.allSettled(
      pairs
        .filter((pair): pair is { day: DayView & { id: number }; newScheduledTime: string | null | undefined } => pair.day.id != null)
        .map(({ day, newScheduledTime }) => api.planInstances.patchDay(instanceId, day.id, { scheduled_time: newScheduledTime ?? null })),
    );
    if (results.some(result => result.status === "rejected")) {
      notify(t("manage.planInstances.scheduledTimeFailed", "Failed to save scheduled time"), "error");
    }
  }

  function swapDaysByRef(a: DayRef, b: DayRef) {
    const dayA = sections[a.sectionIndex]?.weeks[a.weekIndex]?.days[a.dayIndex];
    const dayB = sections[b.sectionIndex]?.weeks[b.weekIndex]?.days[b.dayIndex];
    if (!dayA || !dayB) return;

    const [newA, newB] = swapDayContent(dayA.dsl, dayB.dsl);
    const newTimeA = dayB.scheduled_time;
    const newTimeB = dayA.scheduled_time;

    setSections(prev => {
      const next = prev.map(section => ({
        ...section,
        weeks: section.weeks.map(week => ({
          ...week,
          days: week.days.map(day => ({ ...day })),
        })),
      }));

      next[a.sectionIndex].weeks[a.weekIndex].days[a.dayIndex] = {
        ...dayB,
        dsl: newA,
        notes: splitNote(newA).note,
        scheduled_time: newTimeA,
        day: dayA.day,
        suffix: dayA.suffix,
        category: dayA.category,
        date: dayA.date,
        id: dayA.id,
      };
      next[b.sectionIndex].weeks[b.weekIndex].days[b.dayIndex] = {
        ...dayA,
        dsl: newB,
        notes: splitNote(newB).note,
        scheduled_time: newTimeB,
        day: dayB.day,
        suffix: dayB.suffix,
        category: dayB.category,
        date: dayB.date,
        id: dayB.id,
      };

      return recomputeTotals(
        recomputeTotals(next, a.sectionIndex, a.weekIndex),
        b.sectionIndex,
        b.weekIndex,
      );
    });

    void persistSwappedScheduledTimes([
      { day: dayA, newScheduledTime: newTimeA },
      { day: dayB, newScheduledTime: newTimeB },
    ]);
  }

  function swapWeeksByRef(a: WeekRef, b: WeekRef) {
    const timePairs: { day: DayView; newScheduledTime: string | null | undefined }[] = [];

    setSections(prev => {
      const next = prev.map(section => ({
        ...section,
        weeks: section.weeks.map(week => ({
          ...week,
          days: week.days.map(day => ({ ...day })),
        })),
      }));
      const weekA = next[a.sectionIndex].weeks[a.weekIndex];
      const weekB = next[b.sectionIndex].weeks[b.weekIndex];

      for (const dayB of weekB.days) {
        const dayA = weekA.days.find(day => day.day === dayB.day);
        if (!dayA) continue;

        const [newA, newB] = swapDayContent(dayA.dsl, dayB.dsl);
        const newTimeA = dayB.scheduled_time;
        const newTimeB = dayA.scheduled_time;
        const originalA = { ...dayA };
        const originalB = { ...dayB };

        timePairs.push(
          { day: originalA, newScheduledTime: newTimeA },
          { day: originalB, newScheduledTime: newTimeB },
        );

        Object.assign(dayA, originalB, {
          dsl: newA,
          notes: splitNote(newA).note,
          scheduled_time: newTimeA,
          day: originalA.day,
          suffix: originalA.suffix,
          category: originalA.category,
          date: originalA.date,
          id: originalA.id,
        });
        Object.assign(dayB, originalA, {
          dsl: newB,
          notes: splitNote(newB).note,
          scheduled_time: newTimeB,
          day: originalB.day,
          suffix: originalB.suffix,
          category: originalB.category,
          date: originalB.date,
          id: originalB.id,
        });
      }

      return recomputeTotals(
        recomputeTotals(next, a.sectionIndex, a.weekIndex),
        b.sectionIndex,
        b.weekIndex,
      );
    });

    void persistSwappedScheduledTimes(timePairs);
  }

  function dayByRef(ref: DayRef): DayView | undefined {
    return sections[ref.sectionIndex]?.weeks[ref.weekIndex]?.days[ref.dayIndex];
  }

  function weekByRef(ref: WeekRef): WeekView | undefined {
    return sections[ref.sectionIndex]?.weeks[ref.weekIndex];
  }

  return {
    onDayEdit,
    onScheduledTimeEdit,
    onScheduledTimeEditByDayId,
    applyWorkoutTypeChange,
    findDayIndicesById,
    swapDaysByRef,
    swapWeeksByRef,
    dayByRef,
    weekByRef,
  };
}
