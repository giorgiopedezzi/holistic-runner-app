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
import path from "path";
import { closeDbForRestore, reopenDb, initSchema, type Db, type FeedbackRow } from "../db.ts";

const DEFAULT_INTERVAL_MS = 2 * 60 * 60 * 1000; // two hours

// Anonymous visitor feedback (HRA-226) accumulated on the live demo since the
// last restore would otherwise be silently discarded the moment this
// overwrites dbPath with the backup — the backup predates it entirely. Dumped
// as a plain-text report into feedback.txt next to dbPath (NOT the backup —
// this is a permanent, ever-growing archive, not restorable state) before
// the destructive copy below. Always appended, never a fresh/dated file per
// run, so every restore cycle's export lands in the same one file.
function exportFeedbackReport(db: Db, dbPath: string): void {
  const rows = db.prepare("SELECT * FROM feedback ORDER BY id").all() as unknown as FeedbackRow[];
  if (rows.length === 0) return;

  const lines: string[] = [];
  lines.push(`=== Feedback export ${new Date().toISOString()} (${rows.length} row${rows.length === 1 ? "" : "s"}) ===`);
  for (const row of rows) {
    const featureInterest = row.feature_interest ? (JSON.parse(row.feature_interest) as string[]).join(", ") : "—";
    lines.push("");
    lines.push(`#${row.id} — ${row.created_at}`);
    lines.push(`  Free text:              ${row.free_text ?? "—"}`);
    lines.push(`  Pricing choice:         ${row.pricing_choice ?? "—"}`);
    lines.push(`  Pricing why-not:        ${row.pricing_why_not_free_text ?? "—"}`);
    lines.push(`  App type:               ${row.app_type_choice ?? "—"}`);
    lines.push(`  Feature interest:       ${featureInterest}`);
    lines.push(`  Feature interest other: ${row.feature_interest_other_free_text ?? "—"}`);
  }
  lines.push("");

  const reportPath = path.join(path.dirname(dbPath), "feeedback.txt");
  fs.appendFileSync(reportPath, lines.join("\n") + "\n");
  console.log(`[demo-db-restore] Exported ${rows.length} feedback row(s) to ${reportPath}.`);
}

function runRestore(db: Db, dbPath: string, backupPath: string): void {
  console.log(`[demo-db-restore] Restoring ${dbPath} from backup ${backupPath}...`);
  exportFeedbackReport(db, dbPath);
  closeDbForRestore();
  // Always drop the LIVE path's own sidecars first — they belong to the
  // connection just closed, and if left in place would get merged into
  // whatever we copy over next, silently reintroducing the very state this
  // restore is meant to discard.
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = dbPath + suffix;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
  }
  fs.copyFileSync(backupPath, dbPath);
  // The backup itself may or may not be a clean/checkpointed snapshot — if
  // it was produced by copying a live WAL-mode file (rather than via
  // ".backup"/a full checkpoint first), its most recent transactions could
  // still live only in ITS OWN -wal file, not yet merged into the main .db
  // file. Bring those sidecars along too, if present, so the restore is
  // correct either way rather than silently truncating to whatever the
  // backup's main file alone happened to contain at copy time.
  for (const suffix of ["-wal", "-shm"]) {
    const backupSidecar = backupPath + suffix;
    if (fs.existsSync(backupSidecar)) fs.copyFileSync(backupSidecar, dbPath + suffix);
  }
  reopenDb();
  // The backup could predate a schema change this running version expects —
  // cheap and idempotent (CREATE TABLE IF NOT EXISTS / guarded ALTERs), same
  // as the normal startup path.
  initSchema(db);
  console.log("[demo-db-restore] Restore complete, connection reopened in place.");
}

// Milliseconds until the next fixed wall-clock boundary that's a multiple of
// intervalMs since local midnight (e.g. intervalMs=2h -> 00:00, 02:00, 04:00,
// ...) — a real fixed schedule, not "N hours after whenever the process
// happened to start". Recomputed from the actual current time on every call
// (see the recursive setTimeout below) rather than chained via setInterval,
// so it stays correctly aligned across DST changes / clock adjustments
// instead of silently drifting.
function msUntilNextBoundary(intervalMs: number, now: Date = new Date()): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const msSinceMidnight = now.getTime() - midnight;
  const next = Math.ceil((msSinceMidnight + 1) / intervalMs) * intervalMs; // +1: a call landing exactly ON a boundary waits for the NEXT one, not itself
  return next - msSinceMidnight;
}

export function scheduleDemoDbRestore(
  db: Db, dbPath: string, backupPath: string, intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  function tick(): void {
    runRestore(db, dbPath, backupPath);
    scheduleNext();
  }
  function scheduleNext(): void {
    setTimeout(tick, msUntilNextBoundary(intervalMs)).unref();
  }
  scheduleNext();
}
