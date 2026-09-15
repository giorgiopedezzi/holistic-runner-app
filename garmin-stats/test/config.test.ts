/**
 * test/config.test.ts (HRA-217)
 * loadConfig() now builds Config from process.env instead of reading
 * config.json. Covers: DB_PATH required at boot, every other section
 * optional at boot but validated lazily via require*Config, and
 * SYNC_AUTO_ON_START/SYNC_SKIP_DUPLICATES boolean parsing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadConfig,
  requireGarminConfig,
  requireWithingsConfig,
  requireStravaConfig,
  requireOllamaConfig,
  requireIntegrationEncryptionConfig,
  validateAuthConfig,
} from "../src/config.ts";

const ENV_KEYS = [
  "DB_PATH", "GARMIN_DEVICE_NAME",
  "WITHINGS_CLIENT_ID", "WITHINGS_CLIENT_SECRET", "WITHINGS_REDIRECT_URI",
  "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI",
  "SYNC_AUTO_ON_START", "SYNC_SKIP_DUPLICATES",
  "OLLAMA_HOST", "OLLAMA_MODEL",
  "INTEGRATION_TOKEN_ENCRYPTION_KEY", "AUTH_REGISTRATION_MODE",
  "AUTH_ENABLED", "AUTH_ISSUER_URL", "AUTH_DISCOVERY_URL", "AUTH_AUDIENCE",
  "AUTH_WEB_CLIENT_ID", "AUTH_WEB_CLIENT_SECRET", "AUTH_WEB_CALLBACK_URL", "AUTH_WEB_LOGOUT_URL",
  "AUTH_ALLOWED_ORIGINS", "AUTH_SESSION_IDLE_SECONDS", "AUTH_SESSION_ABSOLUTE_SECONDS", "NODE_ENV",
] as const;

// A complete, self-consistent AUTH_* set — every validateAuthConfig test
// starts here and overrides only the field(s) under test, so a failure
// isolates to that one field instead of tripping an unrelated check.
const VALID_AUTH_ENV = {
  AUTH_ENABLED: "true",
  AUTH_ISSUER_URL: "https://tenant.eu.auth0.com",
  AUTH_DISCOVERY_URL: "https://tenant.eu.auth0.com/.well-known/openid-configuration",
  AUTH_AUDIENCE: "https://api.runsfree.app",
  AUTH_WEB_CLIENT_ID: "abc123clientid",
  AUTH_WEB_CLIENT_SECRET: "s3cr3t-client-secret-value",
  AUTH_WEB_CALLBACK_URL: "https://api.runsfree.app/api/v1/auth/callback",
  AUTH_WEB_LOGOUT_URL: "https://app.runsfree.app/",
  AUTH_ALLOWED_ORIGINS: "https://app.runsfree.app",
} as const;

// Snapshot/restore so each test's env mutations never leak into another test
// or into the surrounding test run's own .env.test-sourced DB_PATH.
function withEnv(overrides: Partial<Record<typeof ENV_KEYS[number], string | undefined>>, fn: () => void): void {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("loadConfig throws a clear error when DB_PATH is unset", () => {
  withEnv({}, () => {
    assert.equal(loadConfig().database.path, "");
  });
});

test("loadConfig succeeds with only DB_PATH set — other sections stay unset", () => {
  withEnv({ DB_PATH: "./garmin.db" }, () => {
    const config = loadConfig();
    assert.equal(config.database.path, "./garmin.db");
    assert.equal(config.withings.client_id, undefined);
    assert.equal(config.strava.client_id, undefined);
    assert.equal(config.garmin.device_name, undefined);
    assert.equal(config.ollama.host, undefined);
  });
});

test("SYNC_AUTO_ON_START / SYNC_SKIP_DUPLICATES default to true when unset", () => {
  withEnv({ DB_PATH: "./garmin.db" }, () => {
    const config = loadConfig();
    assert.equal(config.sync.auto_on_start, true);
    assert.equal(config.sync.skip_duplicates, true);
  });
});

test("SYNC_AUTO_ON_START / SYNC_SKIP_DUPLICATES parse \"false\" to false", () => {
  withEnv({ DB_PATH: "./garmin.db", SYNC_AUTO_ON_START: "false", SYNC_SKIP_DUPLICATES: "false" }, () => {
    const config = loadConfig();
    assert.equal(config.sync.auto_on_start, false);
    assert.equal(config.sync.skip_duplicates, false);
  });
});

test("requireWithingsConfig throws naming the missing env var(s)", () => {
  withEnv({ DB_PATH: "./garmin.db", WITHINGS_CLIENT_ID: "id-only" }, () => {
    const config = loadConfig();
    assert.throws(
      () => requireWithingsConfig(config),
      /WITHINGS_CLIENT_SECRET.*WITHINGS_REDIRECT_URI/,
    );
  });
});

test("requireWithingsConfig succeeds and returns narrowed strings when all vars are set", () => {
  withEnv({
    DB_PATH: "./garmin.db",
    WITHINGS_CLIENT_ID: "id", WITHINGS_CLIENT_SECRET: "secret", WITHINGS_REDIRECT_URI: "http://localhost:3002/callback",
  }, () => {
    const config = loadConfig();
    const withings = requireWithingsConfig(config);
    assert.deepEqual(withings, { client_id: "id", client_secret: "secret", redirect_uri: "http://localhost:3002/callback" });
  });
});

test("requireStravaConfig throws naming the missing env var(s)", () => {
  withEnv({ DB_PATH: "./garmin.db" }, () => {
    const config = loadConfig();
    assert.throws(
      () => requireStravaConfig(config),
      /STRAVA_CLIENT_ID.*STRAVA_CLIENT_SECRET.*STRAVA_REDIRECT_URI/,
    );
  });
});

test("requireOllamaConfig throws naming the missing env var(s)", () => {
  withEnv({ DB_PATH: "./garmin.db" }, () => {
    const config = loadConfig();
    assert.throws(() => requireOllamaConfig(config), /OLLAMA_HOST.*OLLAMA_MODEL/);
  });
});

test("requireGarminConfig throws naming the missing env var", () => {
  withEnv({ DB_PATH: "./garmin.db" }, () => {
    const config = loadConfig();
    assert.throws(() => requireGarminConfig(config), /GARMIN_DEVICE_NAME/);
  });
});

test("requireIntegrationEncryptionConfig throws naming the missing env var", () => {
  withEnv({ DB_PATH: "./garmin.db" }, () => {
    const config = loadConfig();
    assert.throws(() => requireIntegrationEncryptionConfig(config), /INTEGRATION_TOKEN_ENCRYPTION_KEY/);
  });
});

test("requireIntegrationEncryptionConfig succeeds when the key is set", () => {
  withEnv({ DB_PATH: "./garmin.db", INTEGRATION_TOKEN_ENCRYPTION_KEY: "a-key-value" }, () => {
    const config = loadConfig();
    assert.deepEqual(requireIntegrationEncryptionConfig(config), { key: "a-key-value" });
  });
});

// HRA-352 AC (registration gate): registration must stay disabled by
// default — AUTH_REGISTRATION_MODE unset (the real deployment default,
// .env.example never sets it) must resolve to "founders_only", never "open".
test("registration mode defaults to founders_only when AUTH_REGISTRATION_MODE is unset", () => {
  withEnv({ DB_PATH: "./garmin.db" }, () => {
    assert.equal(loadConfig().auth.registrationMode, "founders_only");
  });
});

test("registration mode stays founders_only for any value other than the exact literal \"open\"", () => {
  withEnv({ DB_PATH: "./garmin.db", AUTH_REGISTRATION_MODE: "Open" }, () => {
    assert.equal(loadConfig().auth.registrationMode, "founders_only");
  });
});

test("registration mode is only ever \"open\" via an explicit, exact AUTH_REGISTRATION_MODE=open", () => {
  withEnv({ DB_PATH: "./garmin.db", AUTH_REGISTRATION_MODE: "open" }, () => {
    assert.equal(loadConfig().auth.registrationMode, "open");
  });
});

// HRA-356 AC2: startup validation fails safely for missing, placeholder,
// cross-environment, insecure, or contradictory database/auth/session config.
test("validateAuthConfig is a no-op when AUTH_ENABLED is unset/false", () => {
  withEnv({ DB_PATH: "./garmin.db" }, () => {
    assert.doesNotThrow(() => validateAuthConfig(loadConfig()));
  });
});

test("validateAuthConfig passes a complete, consistent, secure config", () => {
  withEnv({ DB_PATH: "./garmin.db", ...VALID_AUTH_ENV }, () => {
    assert.doesNotThrow(() => validateAuthConfig(loadConfig()));
  });
});

test("validateAuthConfig throws naming the missing var(s) when AUTH_ENABLED but incomplete", () => {
  withEnv({ DB_PATH: "./garmin.db", AUTH_ENABLED: "true" }, () => {
    assert.throws(() => validateAuthConfig(loadConfig()), /AUTH_ISSUER_URL/);
  });
});

test("validateAuthConfig rejects an unfilled placeholder value", () => {
  withEnv({ DB_PATH: "./garmin.db", ...VALID_AUTH_ENV, AUTH_WEB_CLIENT_SECRET: "changeme" }, () => {
    assert.throws(() => validateAuthConfig(loadConfig()), /placeholder/);
  });
});

test("validateAuthConfig rejects http:// URLs in production", () => {
  withEnv({ DB_PATH: "./garmin.db", ...VALID_AUTH_ENV, NODE_ENV: "production", AUTH_WEB_CALLBACK_URL: "http://api.runsfree.app/api/v1/auth/callback" }, () => {
    assert.throws(() => validateAuthConfig(loadConfig()), /https/);
  });
});

test("validateAuthConfig allows http:// URLs outside production", () => {
  withEnv({ DB_PATH: "./garmin.db", ...VALID_AUTH_ENV, AUTH_WEB_CALLBACK_URL: "http://localhost:3001/api/v1/auth/callback", AUTH_WEB_LOGOUT_URL: "http://localhost:5173/", AUTH_ALLOWED_ORIGINS: "http://localhost:5173" }, () => {
    assert.doesNotThrow(() => validateAuthConfig(loadConfig()));
  });
});

test("validateAuthConfig rejects an issuer/discovery host mismatch (cross-environment)", () => {
  withEnv({ DB_PATH: "./garmin.db", ...VALID_AUTH_ENV, AUTH_DISCOVERY_URL: "https://other-tenant.eu.auth0.com/.well-known/openid-configuration" }, () => {
    assert.throws(() => validateAuthConfig(loadConfig()), /cross-environment/);
  });
});

test("validateAuthConfig rejects a logout URL whose origin isn't in AUTH_ALLOWED_ORIGINS", () => {
  withEnv({ DB_PATH: "./garmin.db", ...VALID_AUTH_ENV, AUTH_WEB_LOGOUT_URL: "https://staging.runsfree.app/" }, () => {
    assert.throws(() => validateAuthConfig(loadConfig()), /AUTH_ALLOWED_ORIGINS/);
  });
});

test("validateAuthConfig rejects an idle timeout longer than the absolute session lifetime", () => {
  withEnv({ DB_PATH: "./garmin.db", ...VALID_AUTH_ENV, AUTH_SESSION_IDLE_SECONDS: "99999", AUTH_SESSION_ABSOLUTE_SECONDS: "43200" }, () => {
    assert.throws(() => validateAuthConfig(loadConfig()), /idle timeout could never fire/);
  });
});
