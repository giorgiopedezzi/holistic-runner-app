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
  // AES-256-GCM key (base64, 32 raw bytes) integration credentials are
  // encrypted under at rest — domain/token-crypto.ts. Required only when a
  // provider token is actually written/read (HRA-352 AC2), same lazy-validate
  // convention as withings/strava client secrets.
  integrationEncryption: {
    key?: string;
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
  // Hosted-demo DB reset (jobs/demo-db-restore.ts): path to a pristine backup
  // copy of the database that is assumed to always exist and never change.
  // When set, the server periodically overwrites the live DB with this copy
  // so a public demo self-heals from whatever visitors have done to it —
  // independent of demoMode (unset/false doesn't disable this). Unset
  // disables the feature entirely.
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
  // AI-assisted plan template generation (integrations/plan-template-ai.ts).
  // A generic chat-completions-style external provider — endpoint/model are
  // configurable per host, never hardcoded (HRA-325).
  planTemplateAi: {
    endpoint?: string;
    apiKey?: string;
    model?: string;
  };
  // HRA-348/HRA-347 identity domain — off by default. AUTH_ENABLED is the
  // explicit production gate: deriveRequestIdentity() (http/auth-context.ts)
  // refuses every request when this is false, so an incomplete/misconfigured
  // deployment fails closed rather than silently accepting tokens. No route
  // in this Story reads this yet — it exists for the future login/callback
  // wiring to consume (see the HRA-348 review comment).
  auth: {
    enabled: boolean;
    issuerUrl?: string;
    discoveryUrl?: string;
    audience?: string;
    // "founders_only" (default) permits only an explicit allowlisted email to
    // register a first-ever internal user; "open" allows any unknown identity
    // to register (AC5).
    registrationMode: "founders_only" | "open";
    founderAllowlist: string[];
    sessionIdleSeconds: number;
    sessionAbsoluteSeconds: number;
    preauthCookieSeconds: number;
    webClientId?: string;
    webClientSecret?: string;
    webCallbackUrl?: string;
    webLogoutUrl?: string;
    allowedOrigins: string[];
  };
}

// "true" (case-insensitive) is the only truthy string; anything else,
// including unset, falls back to defaultValue.
function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

function parseIntEnv(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : defaultValue;
}

// Comma-separated list, trimmed, empty entries dropped. AUTH_FOUNDER_ALLOWLIST
// is a list of emails per the ADR — never (issuer, subject) pairs, since the
// allowlist gate runs before any internal identity exists to key off.
function parseListEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map(entry => entry.trim()).filter(entry => entry.length > 0);
}

// PostgreSQL is validated by openPostgresDatabase at the runtime boundary.
// DB_PATH remains optional only for archived SQLite migration tooling.
export function loadConfig(): Config {
  const dbPath = process.env.DB_PATH ?? "";
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
    integrationEncryption: {
      key: process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
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
    planTemplateAi: {
      endpoint: process.env.PLAN_TEMPLATE_AI_ENDPOINT,
      apiKey: process.env.PLAN_TEMPLATE_AI_API_KEY,
      model: process.env.PLAN_TEMPLATE_AI_MODEL,
    },
    auth: {
      enabled: parseBoolEnv(process.env.AUTH_ENABLED, false),
      issuerUrl: process.env.AUTH_ISSUER_URL,
      discoveryUrl: process.env.AUTH_DISCOVERY_URL,
      audience: process.env.AUTH_AUDIENCE,
      registrationMode: process.env.AUTH_REGISTRATION_MODE === "open" ? "open" : "founders_only",
      founderAllowlist: parseListEnv(process.env.AUTH_FOUNDER_ALLOWLIST),
      // ADR defaults: 30 min idle / 12h absolute.
      sessionIdleSeconds: parseIntEnv(process.env.AUTH_SESSION_IDLE_SECONDS, 1800),
      sessionAbsoluteSeconds: parseIntEnv(process.env.AUTH_SESSION_ABSOLUTE_SECONDS, 43200),
      // How long the OAuth-redirect preauth cookie (state/nonce binding) survives.
      preauthCookieSeconds: parseIntEnv(process.env.AUTH_PREAUTH_COOKIE_SECONDS, 600),
      webClientId: process.env.AUTH_WEB_CLIENT_ID,
      webClientSecret: process.env.AUTH_WEB_CLIENT_SECRET,
      webCallbackUrl: process.env.AUTH_WEB_CALLBACK_URL,
      webLogoutUrl: process.env.AUTH_WEB_LOGOUT_URL,
      allowedOrigins: parseListEnv(process.env.AUTH_ALLOWED_ORIGINS),
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

export function requireIntegrationEncryptionConfig(config: Config): { key: string } {
  return requireEnv(config.integrationEncryption, { key: "INTEGRATION_TOKEN_ENCRYPTION_KEY" });
}

export function requireOllamaConfig(config: Config): { host: string; model: string } {
  return requireEnv(config.ollama, { host: "OLLAMA_HOST", model: "OLLAMA_MODEL" });
}

export function requirePlanTemplateAiConfig(config: Config): { endpoint: string; apiKey: string; model: string } {
  return requireEnv(config.planTemplateAi, {
    endpoint: "PLAN_TEMPLATE_AI_ENDPOINT",
    apiKey: "PLAN_TEMPLATE_AI_API_KEY",
    model: "PLAN_TEMPLATE_AI_MODEL",
  });
}

export function requireAuthConfig(config: Config): { issuerUrl: string; discoveryUrl: string; audience: string } {
  return requireEnv(
    { issuerUrl: config.auth.issuerUrl, discoveryUrl: config.auth.discoveryUrl, audience: config.auth.audience },
    { issuerUrl: "AUTH_ISSUER_URL", discoveryUrl: "AUTH_DISCOVERY_URL", audience: "AUTH_AUDIENCE" },
  );
}

export function requireWebAuthConfig(config: Config): {
  issuerUrl: string; discoveryUrl: string; audience: string; webClientId: string;
  webClientSecret: string; webCallbackUrl: string; webLogoutUrl: string; allowedOrigins: string[];
} {
  const auth = requireEnv(
    {
      issuerUrl: config.auth.issuerUrl, discoveryUrl: config.auth.discoveryUrl, audience: config.auth.audience,
      webClientId: config.auth.webClientId, webClientSecret: config.auth.webClientSecret,
      webCallbackUrl: config.auth.webCallbackUrl, webLogoutUrl: config.auth.webLogoutUrl,
    },
    {
      issuerUrl: "AUTH_ISSUER_URL", discoveryUrl: "AUTH_DISCOVERY_URL", audience: "AUTH_AUDIENCE",
      webClientId: "AUTH_WEB_CLIENT_ID", webClientSecret: "AUTH_WEB_CLIENT_SECRET",
      webCallbackUrl: "AUTH_WEB_CALLBACK_URL", webLogoutUrl: "AUTH_WEB_LOGOUT_URL",
    },
  );
  if (config.auth.allowedOrigins.length === 0) throw new Error("Missing required environment variable: AUTH_ALLOWED_ORIGINS");
  return { ...auth, allowedOrigins: config.auth.allowedOrigins };
}

// HRA-356 AC2: startup-time validation. Called once from server.ts right
// after loadConfig() when AUTH_ENABLED is true, so a misconfigured
// deployment fails immediately at boot (visible in the deploy log) instead
// of only surfacing the first time a real user tries to log in. Throwing
// here is deliberate: server.ts is a top-level module, so an uncaught throw
// stops the process before it ever binds a port — the "fail safely" the AC
// asks for, not a caught-and-logged warning a deploy could miss.
const PLACEHOLDER_MARKERS = ["changeme", "change-me", "placeholder", "your-", "xxx", "todo", "example.com", "localhost.example"];

function rejectPlaceholder(label: string, value: string | undefined): void {
  if (value && PLACEHOLDER_MARKERS.some(marker => value.toLowerCase().includes(marker))) {
    throw new Error(`${label} looks like an unfilled placeholder value: "${value}"`);
  }
}

function originOf(label: string, url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).origin; } catch { throw new Error(`${label} is not a valid URL: "${url}"`); }
}

export function validateAuthConfig(config: Config): void {
  if (!config.auth.enabled) return;
  const web = requireWebAuthConfig(config);

  for (const [label, value] of Object.entries({
    AUTH_ISSUER_URL: web.issuerUrl, AUTH_DISCOVERY_URL: web.discoveryUrl, AUTH_AUDIENCE: web.audience,
    AUTH_WEB_CLIENT_ID: web.webClientId, AUTH_WEB_CLIENT_SECRET: web.webClientSecret,
    AUTH_WEB_CALLBACK_URL: web.webCallbackUrl, AUTH_WEB_LOGOUT_URL: web.webLogoutUrl,
  })) rejectPlaceholder(label, value);

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    for (const [label, url] of Object.entries({
      AUTH_ISSUER_URL: web.issuerUrl, AUTH_DISCOVERY_URL: web.discoveryUrl,
      AUTH_WEB_CALLBACK_URL: web.webCallbackUrl, AUTH_WEB_LOGOUT_URL: web.webLogoutUrl,
    })) {
      if (new URL(url).protocol !== "https:") throw new Error(`${label} must use https:// in production: "${url}"`);
    }
    for (const origin of web.allowedOrigins) {
      if (new URL(origin).protocol !== "https:") throw new Error(`AUTH_ALLOWED_ORIGINS must use https:// origins in production: "${origin}"`);
    }
  }

  // Cross-environment mismatch: Auth0's discovery document lives under the
  // issuer's own host — a discoveryUrl pointing at a different host almost
  // always means the dev tenant and the custom domain got mixed between envs.
  const issuerHost = new URL(web.issuerUrl).host;
  const discoveryHost = new URL(web.discoveryUrl).host;
  if (issuerHost !== discoveryHost) {
    throw new Error(`AUTH_ISSUER_URL host (${issuerHost}) and AUTH_DISCOVERY_URL host (${discoveryHost}) disagree — likely a cross-environment (dev tenant vs custom domain) mismatch.`);
  }

  // Contradictory: the post-login/logout landing page should be an origin the
  // API itself trusts for credentialed cross-origin calls — otherwise a
  // successful login redirects the browser to a domain that can't call back.
  const logoutOrigin = originOf("AUTH_WEB_LOGOUT_URL", web.webLogoutUrl);
  if (web.allowedOrigins.length > 0 && logoutOrigin && !web.allowedOrigins.includes(logoutOrigin)) {
    throw new Error(`AUTH_WEB_LOGOUT_URL origin (${logoutOrigin}) is not in AUTH_ALLOWED_ORIGINS (${web.allowedOrigins.join(", ")}) — the post-login redirect target must be a trusted frontend origin.`);
  }

  // Contradictory: an idle timeout longer than the absolute session lifetime
  // can never fire — the absolute cap would always win first.
  if (config.auth.sessionIdleSeconds > config.auth.sessionAbsoluteSeconds) {
    throw new Error(`AUTH_SESSION_IDLE_SECONDS (${config.auth.sessionIdleSeconds}) exceeds AUTH_SESSION_ABSOLUTE_SECONDS (${config.auth.sessionAbsoluteSeconds}) — the idle timeout could never fire.`);
  }
}

export function getArg(flag: string): string | null {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] ?? null : null;
}

export function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}
