import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import { createOwnedActivitiesRepo, type OwnedActivitiesRepo } from "../repositories/owned-activities.repo.ts";
export function createActivitiesService(db: PostgresDatabase, activities: ActivitiesRepo) {
  const transaction = <T>(userId: string, work:(repo:OwnedActivitiesRepo)=>Promise<T>) => db.transaction(client => work(createOwnedActivitiesRepo(clientQueryable(client), userId)));
  return {
    async softDeleteRange(userId:string,from:string,to:string) { const repo=createOwnedActivitiesRepo(db, userId); const count=(await repo.countInRange(from,to))?.count ?? 0; await transaction(userId, repo=>repo.softDeleteRange(from,to)); return {deleted:count,from,to}; },
    async softDeleteById(userId:string,id:number) { await transaction(userId, repo=>repo.softDeleteById(id)); return {deleted:id}; },
    async restore(userId:string,ids:number[]) { await transaction(userId, async repo=>{for(const id of ids) await repo.restoreById(id);}); return {restored:ids.length}; },
    async purge(userId:string,ids:number[]) { await transaction(userId, async repo=>{for(const id of ids){await repo.deleteTrackPoints(id);await repo.purgeById(id);}}); return {purged:ids.length}; },
    async confirm(userId:string,ids:number[],method:"ai"|"statistical") { await transaction(userId, async repo=>{for(const id of ids) await repo.confirmById({$id:id,$source:method});}); return {confirmed:ids.length}; },
  };
}
export type ActivitiesService=ReturnType<typeof createActivitiesService>;
