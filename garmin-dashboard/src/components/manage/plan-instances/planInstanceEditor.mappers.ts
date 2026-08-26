import {
  groupResolvedDaysIntoSectionViews,
  reconstructDslFromResolvedDay,
  type SectionView,
} from "@/domain/runplan-aggregate";
import type { ResolvedDay, WorkoutType } from "@/types/runplan";

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
  }));
}

export function apiDaysToSections(days: ApiPlanInstanceDayLike[]): SectionView[] {
  return groupResolvedDaysIntoSectionViews(
    apiDaysToResolvedDays(days).map(d => ({ ...d, dsl: reconstructDslFromResolvedDay(d) })),
  );
}

export function snapshotDsl(sections: SectionView[]): Record<string, string> {
  const map: Record<string, string> = {};
  sections.forEach(section => section.weeks.forEach(week => week.days.forEach(day => {
    if (day.date != null) map[day.date] = day.dsl;
  })));
  return map;
}
