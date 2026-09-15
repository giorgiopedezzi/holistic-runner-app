import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import type { AssociationStatus, WorkoutAssociationRow } from "../db.ts";
import type { PlanInstanceDayWithInstance } from "../repositories/plan-instances.repo.ts";
import { reconcileAssociations, type CandidateActivity, type CandidateWorkout, type ExistingAssociation } from "../domain/workout-association.ts";
import { localDateInTimeZone, SCHEDULE_TIMEZONE_BACKFILL_FALLBACK } from "../domain/plan-timezone.ts";
import { createOwnedActivitiesRepo } from "../repositories/owned-activities.repo.ts";
import { createOwnedPlanInstancesRepo } from "../repositories/owned-plan-instances.repo.ts";
import { createOwnedWorkoutAssociationsRepo } from "../repositories/owned-workout-associations.repo.ts";
export interface AssociationView { activity_id:number;workout_id:string|null;status:AssociationStatus|null;instance_id:number|null;instance_name:string|null;section_name:string|null;week_number:number|null;date:string|null; }
// HRA-352: reconcile() is owner-scoped (called by the per-owner sync jobs,
// jobs/sync-garmin.ts and jobs/sync-strava.ts, after each import) — every
// other method already built its own owned repos per-call from `userId`;
// this brings reconcile() in line instead of scanning across all owners'
// workouts/activities/associations.
export function createWorkoutAssociationsService(db:PostgresDatabase) {
  async function toView(userId:string,row:WorkoutAssociationRow|undefined,activityId:number):Promise<AssociationView>{const day=row?.workout_id?await createOwnedPlanInstancesRepo(db,userId).dayByWorkoutId(row.workout_id):undefined;return{activity_id:activityId,workout_id:row?.workout_id??null,status:row?.status??null,instance_id:day?.instance_id??null,instance_name:day?.instance_name??null,section_name:day?.section_name??null,week_number:day?.week_number??null,date:day?.date??null};}
  return {
    async reconcile(userId:string){const planInstances=createOwnedPlanInstancesRepo(db,userId);const activities=createOwnedActivitiesRepo(db,userId);const associations=createOwnedWorkoutAssociationsRepo(db,userId);const workouts:CandidateWorkout[]=(await planInstances.runDaysWithTimezone()).map(d=>({workout_id:d.workout_id,date:d.date,timeZone:d.schedule_timezone??SCHEDULE_TIMEZONE_BACKFILL_FALLBACK}));const candidates:CandidateActivity[]=(await activities.runningActivitiesForAssociation()).map(a=>({activity_id:a.id,activity_date:a.activity_date}));const existing:ExistingAssociation[]=(await associations.all()).map(a=>({activity_id:a.activity_id,workout_id:a.workout_id,status:a.status}));const plan=reconcileAssociations(workouts,candidates,existing);if(!plan.accept.length&&!plan.demote.length)return;await db.transaction(async client=>{const repo=createOwnedWorkoutAssociationsRepo(clientQueryable(client),userId);for(const a of plan.accept){const day=await planInstances.dayByWorkoutId(a.workout_id);await repo.upsert(a.activity_id,day?.instance_id??null,a.workout_id,"automatic");}for(const d of plan.demote)await repo.demoteToUnresolved(d.activity_id);});},
    async getForActivity(userId:string,activityId:number){const owned=createOwnedWorkoutAssociationsRepo(db,userId);return toView(userId,await owned.byActivityId(activityId),activityId);},
    async setAssociation(userId:string,activityId:number,workoutId:string){const owned=createOwnedWorkoutAssociationsRepo(db,userId);const current=await owned.byActivityId(activityId);const status:AssociationStatus=current?.workout_id===workoutId?"manual_confirmed":"manual_changed";const day=await createOwnedPlanInstancesRepo(db,userId).dayByWorkoutId(workoutId);if(!day)return undefined;await owned.upsert(activityId,day.instance_id,workoutId,status);return toView(userId,await owned.byActivityId(activityId),activityId);},
    async clearAssociation(userId:string,activityId:number){const owned=createOwnedWorkoutAssociationsRepo(db,userId);await owned.upsert(activityId,null,null,"manual_changed");return toView(userId,await owned.byActivityId(activityId),activityId);},
    async candidatesForActivity(userId:string,activityId:number):Promise<PlanInstanceDayWithInstance[]>{const activity=await createOwnedActivitiesRepo(db,userId).byId(activityId) as {activity_date:string}|undefined;if(!activity)return[];const plans=createOwnedPlanInstancesRepo(db,userId);const rows=await plans.runDaysWithTimezone();const candidates=await Promise.all(rows.filter(d=>localDateInTimeZone(new Date(activity.activity_date),d.schedule_timezone??SCHEDULE_TIMEZONE_BACKFILL_FALLBACK)===d.date).map(d=>plans.dayByWorkoutId(d.workout_id)));return candidates.filter((d):d is PlanInstanceDayWithInstance=>d!=null);},
  };
}
export type WorkoutAssociationsService=ReturnType<typeof createWorkoutAssociationsService>;
