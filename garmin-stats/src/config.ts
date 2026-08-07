import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export interface Config {
  garmin: {
    activities_path: string;
    device_name: string;
  };
  withings: {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
  };
  strava: {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
  };
  database: {
    path: string;
  };
  sync: {
    auto_on_start: boolean;
    skip_duplicates: boolean;
  };
  // Local Ollama instance for the workout classifier (ollama-service.ts).
  // No API key — Ollama's HTTP API is unauthenticated by default on
  // localhost. model is a real Ollama model tag (`ollama pull <model>`
  // first) — small/fast models are a good fit here: classification is a
  // narrow, well-specified task (six categories, explicit numeric rules),
  // not open-ended generation, and the bulk classify workflow can mean many
  // sequential calls where per-call latency matters more than nuance.
  ollama: {
    host: string;
    model: string;
  };
}

// Anchored to this file's own location (not process.cwd()), so config.json
// resolves the same way whether launched via `npm run`, an IDE run config,
// or as a child process spawned by server.ts — each of which can hand the
// script a different working directory.
const CONFIG_PATH = path.resolve(__dirname, "../config.json");
export const CONFIG_DIR = path.dirname(CONFIG_PATH);

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`config.json not found at ${CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config;
}

export function getArg(flag: string): string | null {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] ?? null : null;
}

export function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}
