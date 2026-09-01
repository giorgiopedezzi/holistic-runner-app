export interface Config {
  garmin: {
    device_name?: string;
  };
  withings: {
    client_id?: string;
    client_secret?: string;
    redirect_uri?: string;
  };
  strava: {
    client_id?: string;
    client_secret?: string;
    redirect_uri?: string;
  };
  database: {
    path: string;
  };
  sync: {
    auto_on_start: boolean;
    skip_duplicates: boolean;
  };
  // Demo-mode gate (HRA-220): when true, the router rejects the write
  // endpoints listed in http/demo-guard.ts with 403 so a public demo can't
  // destroy the database. Default false — unset behaves exactly as before.
  demoMode: boolean;
  // Local Ollama instance for the workout classifier (ollama-service.ts).
  // No API key — Ollama's HTTP API is unauthenticated by default on
  // localhost. model is a real Ollama model tag (`ollama pull <model>`
  // first) — small/fast models are a good fit here: classification is a
  // narrow, well-specified task (six categories, explicit numeric rules),
  // not open-ended generation, and the bulk classify workflow can mean many
  // sequential calls where per-call latency matters more than nuance.
  ollama: {
    host?: string;
    model?: string;
  };
}

// "true" (case-insensitive) is the only truthy string; anything else,
// including unset, falls back to defaultValue.
function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

// database.path is the only section required at boot — every other section
// is validated lazily, only when the integration that needs it is actually
// used (see require*Config below), so the server can boot with just DB_PATH
// set.
export function loadConfig(): Config {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    throw new Error("Missing required environment variable: DB_PATH");
  }
  return {
    garmin: {
      device_name: process.env.GARMIN_DEVICE_NAME,
    },
    withings: {
      client_id: process.env.WITHINGS_CLIENT_ID,
      client_secret: process.env.WITHINGS_CLIENT_SECRET,
      redirect_uri: process.env.WITHINGS_REDIRECT_URI,
    },
    strava: {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      redirect_uri: process.env.STRAVA_REDIRECT_URI,
    },
    database: {
      path: dbPath,
    },
    sync: {
      auto_on_start: parseBoolEnv(process.env.SYNC_AUTO_ON_START, true),
      skip_duplicates: parseBoolEnv(process.env.SYNC_SKIP_DUPLICATES, true),
    },
    demoMode: parseBoolEnv(process.env.DEMO_MODE, false),
    ollama: {
      host: process.env.OLLAMA_HOST,
      model: process.env.OLLAMA_MODEL,
    },
  };
}

function requireEnv<T extends Record<string, string | undefined>>(
  section: T,
  varNames: { [K in keyof T]-?: string },
): { [K in keyof T]-?: string } {
  const missing = (Object.keys(varNames) as (keyof T)[]).filter(key => !section[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.map(key => varNames[key]).join(", ")}`);
  }
  return section as unknown as { [K in keyof T]-?: string };
}

export function requireGarminConfig(config: Config): { device_name: string } {
  return requireEnv(config.garmin, { device_name: "GARMIN_DEVICE_NAME" });
}

export function requireWithingsConfig(config: Config): { client_id: string; client_secret: string; redirect_uri: string } {
  return requireEnv(config.withings, {
    client_id: "WITHINGS_CLIENT_ID",
    client_secret: "WITHINGS_CLIENT_SECRET",
    redirect_uri: "WITHINGS_REDIRECT_URI",
  });
}

export function requireStravaConfig(config: Config): { client_id: string; client_secret: string; redirect_uri: string } {
  return requireEnv(config.strava, {
    client_id: "STRAVA_CLIENT_ID",
    client_secret: "STRAVA_CLIENT_SECRET",
    redirect_uri: "STRAVA_REDIRECT_URI",
  });
}

export function requireOllamaConfig(config: Config): { host: string; model: string } {
  return requireEnv(config.ollama, { host: "OLLAMA_HOST", model: "OLLAMA_MODEL" });
}

export function getArg(flag: string): string | null {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] ?? null : null;
}

export function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}
