import type { PlanInstanceDayRow } from "../db.ts";
import type { Queryable } from "../db/query.ts";

const DF = "d.id,d.instance_id,w.section_name,w.week_number,d.date,w.day,w.suffix,w.category,w.workout_type,w.segments::text AS segments,w.activity_target::text AS activity_target,w.activity_description,w.notes,w.needs_review,d.scheduled_time,w.customized_at,d.workout_id";
const DAYS = " FROM plan_instance_days d JOIN plan_instance_workouts w ON w.instance_id=d.instance_id AND w.workout_id=d.workout_id JOIN plan_instances pi ON pi.id=d.instance_id";
const IF = "id,template_id,start_date,pace_overrides::text AS pace_overrides,target_activity_id,approved_at,name,event,race_name,race_date,race_url,schedule_timezone,original_start_date,original_days_snapshot::text AS original_days_snapshot,current_revision,original_revision,created_at";

export function createOwnedPlanInstancesRepo(db: Queryable, userId: string) {
  return {
    instanceById: (id: number) => db.get(`SELECT ${IF} FROM plan_instances WHERE user_id=$1 AND id=$2`, [userId, id]),
    daysByInstance: (id: number) => db.all<PlanInstanceDayRow>(`SELECT ${DF}${DAYS} WHERE pi.user_id=$1 AND d.instance_id=$2 ORDER BY d.date,w.day`, [userId, id]),
    allInstances: () => db.all(`SELECT ${IF} FROM plan_instances WHERE user_id=$1 ORDER BY created_at DESC`, [userId]),
    dayByWorkoutId: (workoutId: string) => db.get<PlanInstanceDayRow & { instance_name: string | null }>(`SELECT ${DF},pi.name instance_name${DAYS} WHERE pi.user_id=$1 AND d.workout_id=$2`, [userId, workoutId]),
    runDaysWithTimezone: () => db.all<{workout_id:string;date:string;schedule_timezone:string|null;instance_id:number}>(`SELECT d.workout_id,d.date,pi.schedule_timezone,d.instance_id${DAYS} WHERE pi.user_id=$1 AND w.workout_type='run'`, [userId]),
  };
}
