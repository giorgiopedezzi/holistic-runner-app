/**
 * services/sync.service.ts
 * Orchestrates the blocking sync scripts (Withings, Strava) as child processes and
 * parses their summary output. No http — returns a plain result. The streaming
 * Garmin variant (streamSyncScript) stays in the HTTP layer because it writes NDJSON
 * straight to the response. `scriptsDir` is injected so __dirname resolution is
 * independent of where this file lives. Moved out of server.ts (HRA-30).
 */
import path from "path";
import { spawn } from "child_process";

export interface SyncResult { imported: number; skipped: number; errors: number }

export function createSyncService(scriptsDir: string) {
  function runSyncScript(scriptName: string, extraArgs: string[] = []): Promise<SyncResult> {
    const scriptPath = path.join(scriptsDir, scriptName);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, scriptPath, ...extraArgs], {
        cwd: process.cwd(),
      });

      let stdout = "";
      child.stdout.on("data", chunk => stdout += chunk);
      child.stderr.on("data", chunk => stdout += chunk);
      child.on("error", reject);
      child.on("close", code => {
        if (code !== 0) {
          reject(new Error(`${scriptName} exited with code ${code}: ${stdout.slice(-1000)}`));
          return;
        }
        const imported = parseInt(stdout.match(/Imported\s*:\s*(\d+)/)?.[1] ?? "0");
        const skipped  = parseInt(stdout.match(/Skipped\s*:\s*(\d+)/)?.[1]  ?? "0");
        const errors   = parseInt(stdout.match(/Errors\s*:\s*(\d+)/)?.[1]   ?? "0");
        resolve({ imported, skipped, errors });
      });
    });
  }

  return { runSyncScript };
}

export type SyncService = ReturnType<typeof createSyncService>;
