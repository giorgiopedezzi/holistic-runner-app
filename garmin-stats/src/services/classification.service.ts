import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import type { PostgresDatabase } from "../db/postgres.ts";
import { createOwnedActivitiesRepo } from "../repositories/owned-activities.repo.ts";
import { summarizeWorkout, type WorkoutTrackPoint } from "../domain/workout-metrics.ts";
import { classifyWorkout } from "../integrations/ollama.ts";
import { classifyByStatistics } from "../domain/stats-classifier.ts";
export type ClassificationMethod="ai"|"statistical";
export function createClassificationService(db:PostgresDatabase,_activities:ActivitiesRepo){async function classify(userId:string,id:number,splitMeters:number,method:ClassificationMethod){const owned=createOwnedActivitiesRepo(db,userId);const activity=await owned.byId(id) as {sport:string|null;distance_m:number|null;duration_sec:number|null;avg_hr:number|null}|undefined;if(!activity)throw new Error(`Activity ${id} not found`);const summary=summarizeWorkout(activity,await owned.track(id) as WorkoutTrackPoint[],{splitMeters});if(method==="statistical"){const r=classifyByStatistics(summary);await owned.updateStatisticalClassification({$id:id,$classification:r.classification,$explanation:r.explanation});}else{const r=await classifyWorkout(summary);await owned.updateAiClassification({$id:id,$classification:r.classification,$explanation:r.explanation});}}return{classify};}
export type ClassificationService=ReturnType<typeof createClassificationService>;
