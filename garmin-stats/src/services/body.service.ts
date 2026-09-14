import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import type { BodyRepo } from "../repositories/body.repo.ts";
import { createOwnedBodyRepo, type OwnedBodyRepo } from "../repositories/owned-body.repo.ts";
export function createBodyService(db:PostgresDatabase,_body:BodyRepo) { const transaction=<T>(userId:string,work:(repo:OwnedBodyRepo)=>Promise<T>)=>db.transaction(client=>work(createOwnedBodyRepo(clientQueryable(client),userId))); return {
  async softDeleteRange(userId:string,from:string,to:string){const body=createOwnedBodyRepo(db,userId);const count=(await body.countInRange(from,to))?.count??0;await transaction(userId,repo=>repo.softDeleteRange(from,to));return{deleted:count,from,to};},
  async restore(userId:string,ids:number[]){await transaction(userId,async repo=>{for(const id of ids)await repo.restoreById(id);});return{restored:ids.length};},
  async purge(userId:string,ids:number[]){await transaction(userId,async repo=>{for(const id of ids)await repo.purgeById(id);});return{purged:ids.length};},
  async correlation(userId:string,from:string,to:string){const rows=await createOwnedBodyRepo(db,userId).correlation(from,to) as {avg_weight:number|null}[];return{hasData:rows.length>1&&rows.some(r=>r.avg_weight!=null),rows};},
}; }
export type BodyService=ReturnType<typeof createBodyService>;
