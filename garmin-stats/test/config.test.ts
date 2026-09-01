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
} from "../src/config.ts";

const ENV_KEYS = [
  "DB_PATH", "GARMIN_DEVICE_NAME",
  "WITHINGS_CLIENT_ID", "WITHINGS_CLIENT_SECRET", "WITHINGS_REDIRECT_URI",
  "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI",
  "SYNC_AUTO_ON_START", "SYNC_SKIP_DUPLICATES",
  "OLLAMA_HOST", "OLLAMA_MODEL",
] as const;

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
    assert.throws(() => loadConfig(), /DB_PATH/);
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
