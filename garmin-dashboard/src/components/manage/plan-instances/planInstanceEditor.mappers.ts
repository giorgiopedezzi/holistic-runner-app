import {
  groupResolvedDaysIntoSectionViews,
  reconstructDslFromResolvedDay,
  type RacePaceReference,
  type SectionView,
} from "@/domain/runplan-aggregate";
import type { EventType, ResolvedDay, RunPlan, WorkoutType } from "@/types/runplan";

const standardDistanceM: Partial<Record<EventType, number>> = { "5k": 5000, "10k": 10000, half: 21097.5, marathon: 42195 };

/**
 * The classification is deliberately render-time only. A target time on the
 * current plan supplies its canonical race pace; no category is written back
 * to an instance day.
 */
export function racePaceReferenceFromPlan(plan: RunPlan | null | undefined): RacePaceReference | null {
  const goalTime = plan?.metadata.goal_time_sec;
  const distanceM = plan?.metadata.distance_m ?? (plan?.metadata.event ? standardDistanceM[plan.metadata.event] : undefined);
  return goalTime != null && distanceM != null && goalTime > 0 && distanceM > 0
    ? { paceSecPerKm: goalTime / (distanceM / 1000), distanceM }
    : null;
}

export interface ApiPlanInstanceDayLike {
  section_name: string;
  week_number: number;
  date: string;
  day: number;
  suffix?: string | null;
  category?: string | null;
  workout_type: string;
  segments: string;
  activity_target?: string | null;
  activity_description?: string | null;
  notes?: string | null;
  needs_review: number | boolean;
  id?: number | null;
  scheduled_time?: string | null;
  customized_at?: string | null;
  workout_id?: string | null;
}

export function apiDaysToResolvedDays(days: ApiPlanInstanceDayLike[]): ResolvedDay[] {
  return days.map(d => ({
    section_name: d.section_name,
    week_number: d.week_number,
    date: d.date,
    day: d.day,
    suffix: d.suffix ?? undefined,
    category: d.category ?? undefined,
    workout_type: d.workout_type as WorkoutType,
    segments: JSON.parse(d.segments),
    activity_target: d.activity_target ? JSON.parse(d.activity_target) : undefined,
    activity_description: d.activity_description ?? undefined,
    notes: d.notes ?? undefined,
    needs_review: d.needs_review === true || d.needs_review === 1,
    id: d.id ?? undefined,
    scheduled_time: d.scheduled_time,
    customized_at: d.customized_at,
    workout_id: d.workout_id ?? undefined,
  }));
}

export function apiDaysToSections(days: ApiPlanInstanceDayLike[], racePaceReference: RacePaceReference | null = null): SectionView[] {
  return groupResolvedDaysIntoSectionViews(
    apiDaysToResolvedDays(days).map(d => ({ ...d, dsl: reconstructDslFromResolvedDay(d) })),
    racePaceReference,
  );
}

export function snapshotDsl(sections: SectionView[]): Record<string, string> {
  const map: Record<string, string> = {};
  sections.forEach(section => section.weeks.forEach(week => week.days.forEach(day => {
    if (day.date != null) map[day.date] = day.dsl;
  })));
  return map;
}
