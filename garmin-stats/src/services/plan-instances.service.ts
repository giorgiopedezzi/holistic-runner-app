import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import type { PlanInstanceDayRow, PlanInstanceRow } from "../db.ts";
import type { PlanInstanceDayInput, PlanInstancesRepo } from "../repositories/plan-instances.repo.ts";
import { instantiatePlan, type InstantiateOptions } from "../domain/runplan/instantiate.ts";
import type { RunPlan } from "../domain/runplan/types.ts";
import { isOriginalFrozen } from "../domain/plan-timezone.ts";
import { newWorkoutId } from "../domain/runplan/workout-identity.ts";
import { dayPatchChanged, daySetChanged, type RevisionComparableDay } from "../domain/plan-revision.ts";
import { createOwnedPlanInstancesRepo } from "../repositories/owned-plan-instances.repo.ts";
export type PlanInstanceDayReplacement=Omit<PlanInstanceDayInput,"instance_id"|"workout_id">&{workout_id?:string};
// HRA-333 follow-up: thrown from inside swapWorkouts' own transaction when a
// requested day id doesn't exist or doesn't belong to the requested
// instance — framework-agnostic (no http import here; the controller maps
// this to a 404), and distinct from the plain Error the other methods below
// throw only for a genuinely-unexpected DB state.
export class DayNotInInstanceError extends Error {
  // NB: an explicit field + assignment, not a `public readonly` parameter
  // property — Node's strip-only .ts runtime rejects parameter properties
  // (same reason http/problem.ts's ApiProblem avoids them).
  readonly dayId: number;
  constructor(dayId: number) {
    super(`Day ${dayId} does not exist or does not belong to the requested plan instance.`);
    this.name = "DayNotInInstanceError";
    this.dayId = dayId;
  }
}
const comparable=(d: {section_name:string;week_number:number;day:number;date:string;suffix:string|null;category:string|null;workout_type:string;segments:string;activity_target:string|null;activity_description:string|null;notes:string|null;needs_review:number|boolean}):RevisionComparableDay=>({...d,needs_review:typeof d.needs_review==="boolean"?(d.needs_review?1:0):d.needs_review});
const input=(instance_id:number,d: ReturnType<typeof instantiatePlan>[number],workout_id:string):PlanInstanceDayInput=>({instance_id,section_name:d.section_name,week_number:d.week_number,date:d.date,day:d.day,suffix:d.suffix??null,category:d.category??null,workout_type:d.workout_type,segments:JSON.stringify(d.segments),activity_target:d.activity_target?JSON.stringify(d.activity_target):null,activity_description:d.activity_description??null,notes:d.notes??null,needs_review:d.needs_review?1:0,scheduled_time:null,customized_at:null,workout_id});
export function createPlanInstancesService(db:PostgresDatabase,instances:PlanInstancesRepo){
  async function tx<T>(work:(repo:PlanInstancesRepo)=>Promise<T>){return db.transaction(client=>work(instances.withDb(clientQueryable(client))));}
  async function syncOriginal(repo:PlanInstancesRepo,id:number){const instance=await repo.instanceById(id);if(!instance?.schedule_timezone||!instance.original_start_date||isOriginalFrozen(instance.original_start_date,instance.schedule_timezone))return;await repo.updateOriginal(id,instance.start_date,JSON.stringify(await repo.daysByInstance(id)),instance.current_revision);}
  return {
    forUser: (userId:string) => createPlanInstancesService(db, createOwnedPlanInstancesRepo(db, userId) as unknown as PlanInstancesRepo),
    async instantiate(templateId:number,plan:RunPlan,options:InstantiateOptions,targetActivityId:number|null,name:string,raceName:string|null,raceDate:string|null,raceUrl:string|null,scheduleTimezone:string){return tx(async repo=>{const instance=await repo.createInstance({template_id:templateId,start_date:options.startDate,pace_overrides:options.paceOverrides?JSON.stringify(options.paceOverrides):null,target_activity_id:targetActivityId,name,event:plan.metadata.event??null,race_name:raceName,race_date:raceDate,race_url:raceUrl,schedule_timezone:scheduleTimezone,original_start_date:options.startDate,original_days_snapshot:null});if(!instance)throw new Error("Plan instance insert did not return a row.");for(const day of instantiatePlan(plan,options))await repo.createDay(input(instance.id,day,newWorkoutId()));await repo.updateOriginal(instance.id,options.startDate,JSON.stringify(await repo.daysByInstance(instance.id)),instance.current_revision);return{instance:(await repo.instanceById(instance.id))!,days:await repo.daysByInstance(instance.id)};});},
    async patchInstance(instanceId:number,fields:Partial<{name:string;race_name:string|null;race_date:string|null;race_url:string|null}>,days?:PlanInstanceDayReplacement[],scheduleTimezone?:string){return tx(async repo=>{const before=(await repo.instanceById(instanceId))!;let changed=false;if(days){const existing=await repo.daysByInstance(instanceId);const ids=new Set(existing.map(d=>d.workout_id));changed=daySetChanged(existing.map(comparable),days.map(comparable));await repo.deleteDaysByInstance(instanceId);for(const day of days)await repo.createDay({...day,instance_id:instanceId,workout_id:day.workout_id&&ids.has(day.workout_id)?day.workout_id:newWorkoutId()});}const fieldsChanged=Object.entries(fields).some(([k,v])=>v!==undefined&&before[k as keyof typeof fields]!==v);const tzChanged=scheduleTimezone!==undefined&&scheduleTimezone!==before.schedule_timezone;await repo.updateFields(instanceId,fields);if(scheduleTimezone!==undefined)await repo.updateScheduleTimezone(instanceId,scheduleTimezone);await repo.clearApproval(instanceId);if(changed||fieldsChanged||tzChanged)await repo.bumpCurrentRevision(instanceId);await syncOriginal(repo,instanceId);return{instance:(await repo.instanceById(instanceId))!,days:await repo.daysByInstance(instanceId)};});},
    async patchDay(dayId:number,dslFields:{day:number;suffix:string|null;category:string|null;workout_type:string;segments:string;activity_target:string|null;activity_description:string|null;notes:string|null;needs_review:number}|undefined,notes:string|null|undefined,scheduledTime:string|null|undefined,workoutId?:string){return tx(async repo=>{const before=(await repo.dayById(dayId))!;const changed=dayPatchChanged(before,{dslFields,notes,scheduledTime,workoutId});if(dslFields){await repo.updateDayFromDsl(dayId,{...dslFields,notes:notes!==undefined?notes:dslFields.notes});await repo.markDayCustomized(dayId);}else if(notes!==undefined)await repo.updateDayNotes(dayId,notes);if(scheduledTime!==undefined)await repo.updateDayScheduledTime(dayId,scheduledTime);if(workoutId!==undefined){await repo.deferConstraints();await repo.updateDayWorkoutId(dayId,workoutId);}if(changed)await repo.bumpCurrentRevision(before.instance_id);await syncOriginal(repo,before.instance_id);return(await repo.dayById(dayId))!;});},
    // HRA-333 follow-up: one atomic swap of which logical workout occupies
    // each of the two given slots — replaces the old two-call PATCH
    // .../days/:dayId flow (each call its own transaction, so the deferred
    // (instance_id, workout_id) unique constraint on plan_instance_days
    // could never actually resolve: the first call's row still collided
    // with the second (untouched) row at ITS commit — see
    // docs/architecture/POSTGRESQL-MIGRATION.md). Existence + same-instance
    // membership are re-verified here, against the locked rows, inside the
    // same transaction that performs the exchange — not just by an earlier
    // read the controller happened to do first.
    async swapWorkouts(instanceId:number,dayIdA:number,dayIdB:number){return tx(async repo=>{
      await repo.deferWorkoutIdentityConstraint();
      const rows=await repo.lockDaysForSwap(dayIdA,dayIdB);
      const rowA=rows.find(r=>r.id===dayIdA);
      const rowB=rows.find(r=>r.id===dayIdB);
      if(!rowA||rowA.instance_id!==instanceId)throw new DayNotInInstanceError(dayIdA);
      if(!rowB||rowB.instance_id!==instanceId)throw new DayNotInInstanceError(dayIdB);
      await repo.swapWorkoutIds(dayIdA,rowB.workout_id,dayIdB,rowA.workout_id);
      return{dayA:(await repo.dayById(dayIdA))!,dayB:(await repo.dayById(dayIdB))!};
    });},
    async regenerateFrom(instanceId:number,plan:RunPlan,options:InstantiateOptions,effectiveFrom:string){const fresh=instantiatePlan(plan,options).filter(d=>d.date>=effectiveFrom);return tx(async repo=>{const before=(await repo.instanceById(instanceId))!;const old=(await repo.daysByInstance(instanceId)).filter(d=>d.date>=effectiveFrom);const changed=before.start_date!==options.startDate||before.pace_overrides!==(options.paceOverrides?JSON.stringify(options.paceOverrides):null)||daySetChanged(old.map(comparable),fresh.map(d=>comparable(input(instanceId,d,"x"))));const ids=new Map<string,string>();for(const d of fresh){const k=`${d.section_name}|${d.week_number}|${d.day}`;ids.set(k,(await repo.dayByIdentity(instanceId,d.section_name,d.week_number,d.day))??newWorkoutId());await repo.deleteDayByIdentity(instanceId,d.section_name,d.week_number,d.day);}for(const d of fresh)await repo.createDay(input(instanceId,d,ids.get(`${d.section_name}|${d.week_number}|${d.day}`)!));await repo.updateStartDateAndPaceOverrides(instanceId,options.startDate,options.paceOverrides?JSON.stringify(options.paceOverrides):null);await repo.clearApproval(instanceId);if(changed)await repo.bumpCurrentRevision(instanceId);await syncOriginal(repo,instanceId);return{instance:(await repo.instanceById(instanceId))!,days:await repo.daysByInstance(instanceId)};});},
  };
}
export type PlanInstancesService=ReturnType<typeof createPlanInstancesService>;
