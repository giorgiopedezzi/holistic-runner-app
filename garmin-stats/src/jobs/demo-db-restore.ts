/**
 * demo-db-restore.ts
 * Hosted-demo safety net: every INTERVAL_MS (default 2h), overwrite the live
 * DB file with a pristine backup copy assumed to always exist, unchanged, at
 * DEMO_DB_BACKUP_PATH — then reopen the connection in place (no process
 * restart assumed/relied on). db.ts's liveTarget-swapping Proxy is what makes
 * this transparent to every repository/service/controller already holding
 * the `db` reference — they never see a different object, just a different
 * live connection behind it. Only wired in from server.ts when demoMode is
 * on and demoDbBackupPath is configured.
 */
import fs from "fs";
import { closeDbForRestore, reopenDb, initSchema, type Db } from "../db.ts";

const DEFAULT_INTERVAL_MS = 2 * 60 * 60 * 1000; // two hours

export function scheduleDemoDbRestore(
  db: Db, dbPath: string, backupPath: string, intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  setInterval(() => {
    console.log(`[demo-db-restore] Restoring ${dbPath} from backup ${backupPath}...`);
    closeDbForRestore();
    fs.copyFileSync(backupPath, dbPath);
    // WAL/SHM sidecars belong to the connection just closed — drop any stale
    // ones so the reopened connection reads the restored file clean.
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = dbPath + suffix;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
    }
    reopenDb();
    // The backup could predate a schema change this running version
    // expects — cheap and idempotent (CREATE TABLE IF NOT EXISTS / guarded
    // ALTERs), same as the normal startup path.
    initSchema(db);
    console.log("[demo-db-restore] Restore complete, connection reopened in place.");
  }, intervalMs).unref();
}
