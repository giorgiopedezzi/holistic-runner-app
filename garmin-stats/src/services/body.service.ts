import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import type { BodyRepo } from "../repositories/body.repo.ts";
export function createBodyService(db:PostgresDatabase,body:BodyRepo) { const transaction=<T>(work:(repo:BodyRepo)=>Promise<T>)=>db.transaction(client=>work(body.withDb(clientQueryable(client)))); return {
  async softDeleteRange(from:string,to:string){const count=(await body.countInRange(from,to))?.count??0;await transaction(repo=>repo.softDeleteRange(from,to));return{deleted:count,from,to};},
  async restore(ids:number[]){await transaction(async repo=>{for(const id of ids)await repo.restoreById(id);});return{restored:ids.length};},
  async purge(ids:number[]){await transaction(async repo=>{for(const id of ids)await repo.purgeById(id);});return{purged:ids.length};},
  async correlation(from:string,to:string){const rows=await body.correlation(from,to) as {avg_weight:number|null}[];return{hasData:rows.length>1&&rows.some(r=>r.avg_weight!=null),rows};},
}; }
export type BodyService=ReturnType<typeof createBodyService>;
