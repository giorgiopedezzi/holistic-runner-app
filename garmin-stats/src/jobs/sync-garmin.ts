/**
 * sync-garmin.ts
 * Implements a Windows-native PowerShell bridge to bypass MTP USB driver constraints.
 * Extracts missing .FIT files cleanly into a type-safe SQLite database structure.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import readline from "readline";
import { loadConfig, requireGarminConfig, getArg, hasFlag } from "../config.ts";
import { openPostgresDatabase } from "../db/postgres.ts";
import { FOUNDER_USER_ID } from "../db/founder.ts";
import { parseFit } from "../domain/fit-parser.ts";
import { crossValidateFitParser } from "../domain/fit-file-parser-validate.ts";
import { createWorkoutAssociationsService } from "../services/workout-associations.service.ts";

// Handle ESM path resolution requirements natively
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config  = loadConfig();
const VERBOSE = hasFlag("--verbose") || hasFlag("-v");
// HRA-352: the HTTP-triggered path (controllers/sync.controller.ts) always
// passes the authenticated owner explicitly — the FOUNDER_USER_ID fallback
// only serves a bare `npm run sync:garmin` invoked directly from a terminal,
// which stays a founder-only operator tool until multi-user registration
// opens (Story scope note).
const USER_ID = getArg("--user-id") ?? FOUNDER_USER_ID;

const db = openPostgresDatabase();

// Shared across both phases: what's already imported, so the PS1 script knows
// what to skip and the import phase can size its progress total up front.
const existingFilenames = new Set<string>();

// Emits machine-readable "PROGRESS <phase> <current> <total> [<label>]" lines
// on our own stdout (in addition to normal log lines) so a caller — either a
// human tailing the console or server.ts relaying to the dashboard — can show
// a live progress bar. Plain text is harmless noise when read directly.
function emitProgress(phase: "download" | "import", current: number, total: number, label?: string): void {
  console.log(`PROGRESS ${phase} ${current} ${total}${label ? ` ${label}` : ""}`);
}

// Runs the PS1 bridge as a real child process (not execFileSync) so its
// stdout can be read line-by-line as it happens, instead of only being
// available once the whole thing exits — that live stream is what lets the
// download phase report per-file progress instead of just "done or not".
function runPowershellStreaming(args: string[], onLine: (line: string) => void, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    // No stdio: "inherit" here either — same reasoning as before: this process
    // may itself be a console-less grandchild of server.ts, and Shell.Application's
    // MTP COM calls need a message pump that only a real console provides.
    // Capturing via pipes forces Windows to give powershell.exe its own console
    // regardless of how sync-garmin.ts was launched.
    const child = spawn("powershell.exe", args, { stdio: ["ignore", "pipe", "pipe"] });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", onLine);

    let stderrBuf = "";
    child.stderr.on("data", chunk => stderrBuf += chunk);

    const timer = setTimeout(() => {
      child.kill();
      const err = new Error("PowerShell bridge timed out. The device may be asleep/disconnected, or Windows may be waiting on an \"allow access to this device\" prompt on the desktop — check for one and retry.");
      (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
      reject(err);
    }, timeoutMs);

    child.on("error", err => { clearTimeout(timer); reject(err); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`PowerShell exited with code ${code}${stderrBuf.trim() ? `: ${stderrBuf.trim()}` : ""}`));
        return;
      }
      resolve();
    });
  });
}

async function runMtpExtractionPipeline(archiveFolder: string): Promise<void> {
  const scriptPath = path.join(__dirname, "..", "powershell", "activities-file-extractor.ps1");
  const tempJsonPath = path.join(__dirname, "existing_activities.json");

  console.log(`📊 Found ${existingFilenames.size} records. Compiling exchange file...`);
  fs.writeFileSync(tempJsonPath, JSON.stringify([...existingFilenames]), "utf-8");

  const { device_name } = requireGarminConfig(config);
  try {
    console.log("🔄 Launching PowerShell core file sync worker...");
    await runPowershellStreaming([
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-Target", archiveFolder,
      "-ExistingJsonFiles", tempJsonPath,
      "-DeviceName", device_name
    ], line => {
      if (line.trim()) console.log(line);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    // Structural Safeguard: Always dismantle the transaction manifest file
    if (fs.existsSync(tempJsonPath)) {
      fs.unlinkSync(tempJsonPath);
    }
  }
}

async function processLocalSync(targetFolder: string): Promise<void> {
  if (!fs.existsSync(targetFolder)) {
    console.log("No new updates extracted during this execution loop.");
    return;
  }

  const files = fs.readdirSync(targetFolder)
    .filter(f => f.toLowerCase().endsWith(".fit"))
    .sort();

  if (files.length === 0) {
    console.log("✨ Synced. No new workouts found to import.");
    return;
  }

  // Pre-filter so the progress total reflects real work (new files), not the
  // whole permanent archive — most of it is already-imported history now that
  // .FIT files are kept around indefinitely rather than deleted after import.
  const pending = config.sync.skip_duplicates
    ? files.filter(f => !existingFilenames.has(f))
    : files;

  console.log(`\n🚀 Ingesting ${pending.length} new file(s) into database context (${files.length} total in archive)...`);
  emitProgress("import", 0, pending.length);

  let imported = 0, skipped = 0, errors = 0, done = 0;

  await db.transaction(async client => {
    for (const fname of files) {
      if (existingFilenames.has(fname) && config.sync.skip_duplicates) {
        if (VERBOSE) console.log(`  skip  ${fname}`);
        skipped++; continue;
      }

      try {
        const buf = fs.readFileSync(path.join(targetFolder, fname));
        const parsed = parseFit(buf, fname);
        const { activity, trackPoints } = parsed;

        // Validation-only — never affects what gets written below. See
        // fit-file-parser-validate.ts for why this stays a side channel.
        await crossValidateFitParser(buf, fname, parsed);

        const inserted = await client.query<{ id: number }>(`INSERT INTO activities
          (user_id, filename, activity_date, date_only, sport, duration_sec, distance_m, avg_pace_minkm, calories, avg_hr, max_hr, avg_cadence, ascent_m, descent_m, avg_speed_ms, max_speed_ms, source, moving_time_sec)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (user_id, filename) DO NOTHING RETURNING id`, [USER_ID, activity.filename, activity.activity_date, activity.date_only, activity.sport, activity.duration_sec, activity.distance_m, activity.avg_pace_minkm, activity.calories, activity.avg_hr, activity.max_hr, activity.avg_cadence, activity.ascent_m, activity.descent_m, activity.avg_speed_ms, activity.max_speed_ms, "garmin", activity.moving_time_sec]);
        const row = inserted.rows[0] ?? (await client.query<{ id: number }>("SELECT id FROM activities WHERE user_id=$1 AND filename=$2", [USER_ID, fname])).rows[0];
        if (!row) { errors++; done++; emitProgress("import", done, pending.length, fname); continue; }

        for (const pt of trackPoints) {
          await client.query(`INSERT INTO track_points (activity_id, elapsed_sec, timestamp_unix, distance_m, heart_rate, speed_ms, cadence, altitude_m, temperature, power, lat, lon, stamina)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [row.id, pt.elapsed_sec, pt.timestamp_unix, pt.distance_m, pt.heart_rate, pt.speed_ms, pt.cadence, pt.altitude_m, pt.temperature, pt.power, pt.lat, pt.lon, pt.stamina]);
        }

        imported++;
        done++;
        emitProgress("import", done, pending.length, fname);
        if (VERBOSE) {
          const dist = activity.distance_m ? `${(activity.distance_m / 1000).toFixed(2)} km` : "-";
          console.log(`  ✓  ${fname}  ${activity.date_only}  ${activity.sport}  ${dist}`);
        }
      } catch (e) {
        console.error(`  ✗  ${fname}: ${e instanceof Error ? e.message : e}`);
        errors++;
        done++;
        emitProgress("import", done, pending.length, fname);
      }
    }
  });

  console.log(`\n\nExecution Metrics:`);
  console.log(`  Imported : ${imported}`);
  console.log(`  Skipped  : ${skipped}`);
  console.log(`  Errors   : ${errors}`);
  console.log("  DB Store : PostgreSQL");
}

// Permanent archive of raw .FIT files, kept alongside the DB (not under src/,
// not deleted after import) so richer re-parsing/analysis stays possible later.
const fitArchivePath = path.resolve(__dirname, "../../fit-archive");

async function main(): Promise<void> {
  console.log("=== Garmin Stats — Controlled Native PowerShell Sync ===\n");

  for (const row of await db.all<{ filename: string }>("SELECT filename FROM activities WHERE user_id=$1", [USER_ID])) existingFilenames.add(row.filename);

  // 1. Run safely via the OS-level infrastructure
  await runMtpExtractionPipeline(fitArchivePath);

  // 2. Parse the archive directory state into PostgreSQL
  await processLocalSync(fitArchivePath);

  // 3. HRA-334: re-run the conservative planned-workout/activity matcher now
  // that new activities may exist — this script runs as its own process with
  // its own DB connection, so the server's in-process wiring never sees these
  // imports on its own. HRA-352: scoped to this run's own owner only.
  await createWorkoutAssociationsService(db).reconcile(USER_ID);
  await db.close();
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
