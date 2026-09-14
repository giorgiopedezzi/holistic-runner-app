import type { Queryable } from "../db/query.ts";
import type { PlanInstanceDayRow, PlanInstanceRow } from "../db.ts";

const IF = "id,template_id,start_date,pace_overrides::text AS pace_overrides,target_activity_id,approved_at,name,event,race_name,race_date,race_url,schedule_timezone,original_start_date,original_days_snapshot::text AS original_days_snapshot,current_revision,original_revision,created_at";
const DF = "d.id,d.instance_id,w.section_name,w.week_number,d.date,w.day,w.suffix,w.category,w.workout_type,w.segments::text AS segments,w.activity_target::text AS activity_target,w.activity_description,w.notes,w.needs_review,d.scheduled_time,w.customized_at,d.workout_id";
const DAYS = ` FROM plan_instance_days d JOIN plan_instance_workouts w ON w.instance_id=d.instance_id AND w.workout_id=d.workout_id`;
export type PlanInstanceInput = Omit<PlanInstanceRow, "id" | "created_at" | "approved_at" | "current_revision" | "original_revision">;
export type PlanInstanceDayInput = Omit<PlanInstanceDayRow, "id">;
export type PlanInstanceDayWithInstance = PlanInstanceDayRow & { instance_name: string | null };

export function createPlanInstancesRepo(db: Queryable) {
  const repo = {
    deferConstraints: () => db.run("SET CONSTRAINTS ALL DEFERRED"),
    instanceById: (id: number) => db.get<PlanInstanceRow>(`SELECT ${IF} FROM plan_instances WHERE id=$1`, [id]),
    listPage: (limit:number,offset:number,templateId?:number) => db.all<PlanInstanceRow>(`SELECT ${IF} FROM plan_instances ${templateId == null ? "" : "WHERE template_id=$3"} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, templateId == null ? [limit,offset] : [limit,offset,templateId]),
    count: (templateId?:number) => db.get<{count:number}>(`SELECT COUNT(*)::int count FROM plan_instances ${templateId == null ? "" : "WHERE template_id=$1"}`, templateId == null ? [] : [templateId]),
    allInstances: () => db.all<PlanInstanceRow>(`SELECT ${IF} FROM plan_instances ORDER BY created_at DESC`),
    daysByInstance: (id:number) => db.all<PlanInstanceDayRow>(`SELECT ${DF}${DAYS} WHERE d.instance_id=$1 ORDER BY d.date,w.day`,[id]),
    dayById: (id:number) => db.get<PlanInstanceDayRow>(`SELECT ${DF}${DAYS} WHERE d.id=$1`,[id]),
    daysBySection: (id:number,section:string) => db.all<PlanInstanceDayRow>(`SELECT ${DF}${DAYS} WHERE d.instance_id=$1 AND w.section_name=$2 ORDER BY d.date,w.day`,[id,section]),
    daysBySectionAndWeek:(id:number,section:string,week:number)=>db.all<PlanInstanceDayRow>(`SELECT ${DF}${DAYS} WHERE d.instance_id=$1 AND w.section_name=$2 AND w.week_number=$3 ORDER BY d.date,w.day`,[id,section,week]),
    daysByDateAndWorkoutType:(date:string,type:string)=>db.all<PlanInstanceDayWithInstance>(`SELECT ${DF},pi.name instance_name${DAYS} JOIN plan_instances pi ON pi.id=d.instance_id WHERE d.date=$1 AND w.workout_type=$2 ORDER BY pi.created_at DESC`,[date,type]),
    activeInstanceIdForDate: async (date:string) => (await db.get<{id:number}>(`SELECT pi.id FROM plan_instance_days d JOIN plan_instances pi ON pi.id=d.instance_id WHERE d.date=$1 AND pi.approved_at IS NOT NULL ORDER BY pi.created_at DESC LIMIT 1`,[date]))?.id,
    runDaysWithTimezone:()=>db.all<{workout_id:string;date:string;schedule_timezone:string|null;instance_id:number}>(`SELECT d.workout_id,d.date,pi.schedule_timezone,d.instance_id FROM plan_instance_days d JOIN plan_instance_workouts w ON w.instance_id=d.instance_id AND w.workout_id=d.workout_id JOIN plan_instances pi ON pi.id=d.instance_id WHERE w.workout_type='run'`),
    dayByWorkoutId:(id:string)=>db.get<PlanInstanceDayWithInstance>(`SELECT ${DF},pi.name instance_name${DAYS} JOIN plan_instances pi ON pi.id=d.instance_id WHERE d.workout_id=$1`,[id]),
    createInstance:(i:PlanInstanceInput)=>db.get<PlanInstanceRow>(`INSERT INTO plan_instances (user_id,template_id,start_date,pace_overrides,target_activity_id,name,event,race_name,race_date,race_url,schedule_timezone,original_start_date,original_days_snapshot) VALUES ((SELECT id FROM users ORDER BY created_at LIMIT 1),$1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING ${IF}`,[i.template_id,i.start_date,i.pace_overrides,i.target_activity_id,i.name,i.event,i.race_name,i.race_date,i.race_url,i.schedule_timezone,i.original_start_date,i.original_days_snapshot]),
    async createDay(d:PlanInstanceDayInput) { await db.run(`INSERT INTO plan_instance_workouts (instance_id,workout_id,user_id,section_name,week_number,day,suffix,category,workout_type,segments,activity_target,activity_description,notes,needs_review,customized_at) VALUES ($1,$2,(SELECT user_id FROM plan_instances WHERE id=$1),$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::boolean,$14) ON CONFLICT (instance_id,workout_id) DO UPDATE SET section_name=excluded.section_name,week_number=excluded.week_number,day=excluded.day,suffix=excluded.suffix,category=excluded.category,workout_type=excluded.workout_type,segments=excluded.segments,activity_target=excluded.activity_target,activity_description=excluded.activity_description,notes=excluded.notes,needs_review=excluded.needs_review,customized_at=excluded.customized_at`,[d.instance_id,d.workout_id,d.section_name,d.week_number,d.day,d.suffix,d.category,d.workout_type,d.segments,d.activity_target,d.activity_description,d.notes,d.needs_review,d.customized_at]); await db.run(`INSERT INTO plan_instance_days (instance_id,workout_id,user_id,date,scheduled_time) VALUES ($1,$2,(SELECT user_id FROM plan_instances WHERE id=$1),$3,$4)`,[d.instance_id,d.workout_id,d.date,d.scheduled_time]); },
    dayByIdentity:async(instanceId:number,section:string,week:number,day:number)=>(await db.get<{workout_id:string}>(`SELECT w.workout_id${DAYS} WHERE d.instance_id=$1 AND w.section_name=$2 AND w.week_number=$3 AND w.day=$4`,[instanceId,section,week,day]))?.workout_id,
    deleteDaysByInstance:(id:number)=>db.run("DELETE FROM plan_instance_days WHERE instance_id=$1",[id]),
    deleteDayByIdentity:(id:number,section:string,week:number,day:number)=>db.run(`DELETE FROM plan_instance_days d USING plan_instance_workouts w WHERE d.instance_id=w.instance_id AND d.workout_id=w.workout_id AND d.instance_id=$1 AND w.section_name=$2 AND w.week_number=$3 AND w.day=$4`,[id,section,week,day]),
    clearApproval:(id:number)=>db.run("UPDATE plan_instances SET approved_at=NULL WHERE id=$1",[id]),
    async updateFields(id:number,f:Partial<{name:string;race_name:string|null;race_date:string|null;race_url:string|null}>) { const fields: string[]=[]; const values:unknown[]=[]; for(const [column,value] of Object.entries(f)){if(value!==undefined){values.push(value);fields.push(`${column}=$${values.length+1}`)}} if(fields.length) await db.run(`UPDATE plan_instances SET ${fields.join(",")} WHERE id=$1`,[id,...values]); },
    updateStartDateAndPaceOverrides:(id:number,start:string,pace:string|null)=>db.run("UPDATE plan_instances SET start_date=$2,pace_overrides=$3::jsonb WHERE id=$1",[id,start,pace]),
    updateScheduleTimezone:(id:number,tz:string)=>db.run("UPDATE plan_instances SET schedule_timezone=$2 WHERE id=$1",[id,tz]),
    updateOriginal:(id:number,start:string,snapshot:string,revision:number)=>db.run("UPDATE plan_instances SET original_start_date=$2,original_days_snapshot=$3::jsonb,original_revision=$4 WHERE id=$1",[id,start,snapshot,revision]),
    bumpCurrentRevision:(id:number)=>db.run("UPDATE plan_instances SET current_revision=current_revision+1 WHERE id=$1",[id]),
    updateDayFromDsl:(id:number,d: {day:number;suffix:string|null;category:string|null;workout_type:string;segments:string;activity_target:string|null;activity_description:string|null;notes:string|null;needs_review:number})=>db.run(`UPDATE plan_instance_workouts w SET day=$2,suffix=$3,category=$4,workout_type=$5,segments=$6::jsonb,activity_target=$7,activity_description=$8,notes=$9,needs_review=$10::boolean FROM plan_instance_days d WHERE d.instance_id=w.instance_id AND d.workout_id=w.workout_id AND d.id=$1`,[id,d.day,d.suffix,d.category,d.workout_type,d.segments,d.activity_target,d.activity_description,d.notes,d.needs_review]),
    updateDayNotes:(id:number,notes:string|null)=>db.run(`UPDATE plan_instance_workouts w SET notes=$2 FROM plan_instance_days d WHERE d.instance_id=w.instance_id AND d.workout_id=w.workout_id AND d.id=$1`,[id,notes]),
    updateDayScheduledTime:(id:number,time:string|null)=>db.run("UPDATE plan_instance_days SET scheduled_time=$2 WHERE id=$1",[id,time]),
    updateDayWorkoutId:(id:number,workoutId:string)=>db.run("UPDATE plan_instance_days SET workout_id=$2 WHERE id=$1",[id,workoutId]),
    // HRA-333 follow-up: locks both slot rows for the atomic swap below —
    // returns whichever of the two ids actually exist (0, 1, or 2 rows), each
    // with its own instance_id so the caller can verify same-instance
    // membership itself; a WHERE instance_id=$1 filter here would collapse
    // "doesn't exist" and "belongs to another instance" into the same empty
    // result, losing the distinction the swap's own validation wants.
    lockDaysForSwap:(dayIdA:number,dayIdB:number)=>db.all<{id:number;instance_id:number;workout_id:string}>("SELECT id,instance_id,workout_id FROM plan_instance_days WHERE id IN ($1,$2) FOR UPDATE",[dayIdA,dayIdB]),
    // The (instance_id, workout_id) unique constraint on plan_instance_days
    // is DEFERRABLE precisely for this: exchanging two rows' workout_id
    // within one statement is already atomic, but Postgres still validates
    // uniqueness per-row as it writes, so without deferring, the first row's
    // new value can transiently collide with the second row's still-old
    // value mid-statement.
    deferWorkoutIdentityConstraint:()=>db.run("SET CONSTRAINTS plan_instance_days_instance_id_workout_id_key DEFERRED"),
    // Exchanges workout_id between two slot rows in one statement — neither
    // row's own id/date/scheduled_time moves, and plan_instance_workouts
    // (content, customization) and workout_associations (keyed by
    // (instance_id, workout_id)) are never touched, so both stay attached to
    // the logical workout, not the slot.
    swapWorkoutIds:(dayIdA:number,workoutIdA:string,dayIdB:number,workoutIdB:string)=>db.run("UPDATE plan_instance_days SET workout_id=CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 END WHERE id IN ($1,$3)",[dayIdA,workoutIdA,dayIdB,workoutIdB]),
    markDayCustomized:(id:number)=>db.run(`UPDATE plan_instance_workouts w SET customized_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM plan_instance_days d WHERE d.instance_id=w.instance_id AND d.workout_id=w.workout_id AND d.id=$1`,[id]),
    customizedDaysFrom:(id:number,from:string)=>db.all<PlanInstanceDayRow>(`SELECT ${DF}${DAYS} WHERE d.instance_id=$1 AND d.date >= $2 AND w.customized_at IS NOT NULL ORDER BY d.date,w.day`,[id,from]),
    approve:(id:number)=>db.get<PlanInstanceRow>(`UPDATE plan_instances SET approved_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') WHERE id=$1 RETURNING ${IF}`,[id]),
    async dateRangeForInstance(id:number){const r=await db.get<{start_date:string|null;end_date:string|null}>("SELECT MIN(date) start_date,MAX(date) end_date FROM plan_instance_days WHERE instance_id=$1",[id]);return r?.start_date&&r.end_date?{start_date:r.start_date,end_date:r.end_date}:undefined;},
    overlappingApproved:(id:number,start:string,end:string)=>db.all<{id:number;name:string|null;start_date:string;end_date:string}>("SELECT pi.id,pi.name,MIN(d.date) start_date,MAX(d.date) end_date FROM plan_instances pi JOIN plan_instance_days d ON d.instance_id=pi.id WHERE pi.approved_at IS NOT NULL AND pi.id != $1 GROUP BY pi.id HAVING MAX(d.date)>=$2 AND MIN(d.date)<=$3",[id,start,end]),
    remove:(id:number)=>db.run("DELETE FROM plan_instances WHERE id=$1",[id]),
  };
  return { ...repo, withDb: (query: Queryable) => createPlanInstancesRepo(query) };
}
export type PlanInstancesRepo=ReturnType<typeof createPlanInstancesRepo>;
