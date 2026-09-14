import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
export function createActivitiesService(db: PostgresDatabase, activities: ActivitiesRepo) {
  const transaction = <T>(work:(repo:ActivitiesRepo)=>Promise<T>) => db.transaction(client => work(activities.withDb(clientQueryable(client))));
  return {
    async softDeleteRange(from:string,to:string) { const count=(await activities.countInRange(from,to))?.count ?? 0; await transaction(repo=>repo.softDeleteRange(from,to)); return {deleted:count,from,to}; },
    async softDeleteById(id:number) { await activities.softDeleteById(id); return {deleted:id}; },
    async restore(ids:number[]) { await transaction(async repo=>{for(const id of ids) await repo.restoreById(id);}); return {restored:ids.length}; },
    async purge(ids:number[]) { await transaction(async repo=>{for(const id of ids){await repo.deleteTrackPoints(id);await repo.purgeById(id);}}); return {purged:ids.length}; },
    async confirm(ids:number[],method:"ai"|"statistical") { await transaction(async repo=>{for(const id of ids) await repo.confirmById({$id:id,$source:method});}); return {confirmed:ids.length}; },
  };
}
export type ActivitiesService=ReturnType<typeof createActivitiesService>;
