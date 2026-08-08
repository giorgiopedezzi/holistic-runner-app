/**
 * http/stream-sync.ts
 * Streaming variant of the sync runner: spawns sync-garmin.ts and relays its
 * "PROGRESS <phase> <current> <total> [<label>]" stdout lines to the client live
 * as NDJSON, so the dashboard can show a real progress bar. Lives in the HTTP layer
 * (not services/) because it writes straight to the response. `scriptsDir` is
 * injected so the script path is independent of this file's location. Moved out of
 * server.ts (HRA-31).
 */
import http from "http";
import path from "path";
import { spawn } from "child_process";
import readline from "readline";

const PROGRESS_LINE = /^PROGRESS (\w+) (\d+) (\d+)(?: (.*))?$/;

export function streamSyncScript(res: http.ServerResponse, scriptName: string, scriptsDir: string): void {
  const scriptPath = path.join(scriptsDir, scriptName);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Cache-Control": "no-cache",
  });

  const send = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`);

  const child = spawn(process.execPath, [...process.execArgv, scriptPath], {
    cwd: process.cwd(),
  });

  let logTail = "";
  let stderrBuf = "";

  readline.createInterface({ input: child.stdout }).on("line", line => {
    logTail += `${line}\n`;
    const m = line.match(PROGRESS_LINE);
    if (m) send({ type: "progress", phase: m[1], current: Number(m[2]), total: Number(m[3]), label: m[4] });
  });
  child.stderr.on("data", chunk => stderrBuf += chunk);

  child.on("error", err => {
    send({ type: "error", message: err.message });
    res.end();
  });

  child.on("close", code => {
    if (code !== 0) {
      send({ type: "error", message: `${scriptName} exited with code ${code}: ${(stderrBuf || logTail).slice(-1000)}` });
      res.end();
      return;
    }
    const imported = parseInt(logTail.match(/Imported\s*:\s*(\d+)/)?.[1] ?? "0");
    const skipped  = parseInt(logTail.match(/Skipped\s*:\s*(\d+)/)?.[1]  ?? "0");
    const errors   = parseInt(logTail.match(/Errors\s*:\s*(\d+)/)?.[1]   ?? "0");
    send({ type: "done", imported, skipped, errors });
    res.end();
  });
}
