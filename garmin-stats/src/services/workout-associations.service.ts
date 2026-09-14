import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import type { AssociationStatus, WorkoutAssociationRow } from "../db.ts";
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import type { PlanInstanceDayWithInstance, PlanInstancesRepo } from "../repositories/plan-instances.repo.ts";
import type { WorkoutAssociationsRepo } from "../repositories/workout-associations.repo.ts";
import { reconcileAssociations, type CandidateActivity, type CandidateWorkout, type ExistingAssociation } from "../domain/workout-association.ts";
import { localDateInTimeZone, SCHEDULE_TIMEZONE_BACKFILL_FALLBACK } from "../domain/plan-timezone.ts";
export interface AssociationView { activity_id:number;workout_id:string|null;status:AssociationStatus|null;instance_id:number|null;instance_name:string|null;section_name:string|null;week_number:number|null;date:string|null; }
export function createWorkoutAssociationsService(db:PostgresDatabase,activities:ActivitiesRepo,planInstances:PlanInstancesRepo,associations:WorkoutAssociationsRepo) {
  async function toView(row:WorkoutAssociationRow|undefined,activityId:number):Promise<AssociationView>{const day=row?.workout_id?await planInstances.dayByWorkoutId(row.workout_id):undefined;return{activity_id:activityId,workout_id:row?.workout_id??null,status:row?.status??null,instance_id:day?.instance_id??null,instance_name:day?.instance_name??null,section_name:day?.section_name??null,week_number:day?.week_number??null,date:day?.date??null};}
  return {
    async reconcile(){const workouts:CandidateWorkout[]=(await planInstances.runDaysWithTimezone()).map(d=>({workout_id:d.workout_id,date:d.date,timeZone:d.schedule_timezone??SCHEDULE_TIMEZONE_BACKFILL_FALLBACK}));const candidates:CandidateActivity[]=(await activities.runningActivitiesForAssociation()).map(a=>({activity_id:a.id,activity_date:a.activity_date}));const existing:ExistingAssociation[]=(await associations.all()).map(a=>({activity_id:a.activity_id,workout_id:a.workout_id,status:a.status}));const plan=reconcileAssociations(workouts,candidates,existing);if(!plan.accept.length&&!plan.demote.length)return;await db.transaction(async client=>{const repo=associations.withDb(clientQueryable(client));for(const a of plan.accept){const day=await planInstances.dayByWorkoutId(a.workout_id);await repo.upsert(a.activity_id,day?.instance_id??null,a.workout_id,"automatic");}for(const d of plan.demote)await repo.demoteToUnresolved(d.activity_id);});},
    async getForActivity(activityId:number){return toView(await associations.byActivityId(activityId),activityId);},
    async setAssociation(activityId:number,workoutId:string){const current=await associations.byActivityId(activityId);const status:AssociationStatus=current?.workout_id===workoutId?"manual_confirmed":"manual_changed";const day=await planInstances.dayByWorkoutId(workoutId);await associations.upsert(activityId,day?.instance_id??null,workoutId,status);return toView(await associations.byActivityId(activityId),activityId);},
    async clearAssociation(activityId:number){await associations.upsert(activityId,null,null,"manual_changed");return toView(await associations.byActivityId(activityId),activityId);},
    async candidatesForActivity(activityId:number):Promise<PlanInstanceDayWithInstance[]>{const activity=await activities.byId(activityId) as {activity_date:string}|undefined;if(!activity)return[];const rows=await planInstances.runDaysWithTimezone();const candidates=await Promise.all(rows.filter(d=>localDateInTimeZone(new Date(activity.activity_date),d.schedule_timezone??SCHEDULE_TIMEZONE_BACKFILL_FALLBACK)===d.date).map(d=>planInstances.dayByWorkoutId(d.workout_id)));return candidates.filter((d):d is PlanInstanceDayWithInstance=>d!=null);},
  };
}
export type WorkoutAssociationsService=ReturnType<typeof createWorkoutAssociationsService>;
