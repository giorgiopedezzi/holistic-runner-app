# Deployment, observability, and release readiness

> **HRA-356.** This document is the release gate for the Railway PostgreSQL +
> Auth0 production cutover: configuration, secret handling, observability,
> production security controls, the release checklist, incident response, and
> rollback. It builds on, and does not repeat, `AUTHENTICATION-TENANCY-ADR.md`
> (Auth0 registrations, session/CSRF/CORS contract, native return-link
> requirements) and `POSTGRESQL-MIGRATION.md` (local migration/import/founder
> bootstrap tooling). Read both alongside this file.

## What this Story actually verified vs. what still requires live infrastructure

This Story was implemented without Railway production credentials, Auth0
production-tenant dashboard access, or a deployed environment to exercise.
Everything below that is **code, tests, or a documented procedure** was
implemented and verified in this repository. Everything marked **"Not yet
executed — requires live infra access"** is a runbook for whoever holds
Railway/Auth0 production access to carry out before registration opens; it is
not something this session could fabricate evidence for.

| Area | Status |
| --- | --- |
| Startup/deployment config validation (fails closed on missing/placeholder/cross-environment/insecure/contradictory config) | **Done** — `garmin-stats/src/config.ts`'s `validateAuthConfig`, called from `server.ts` at boot. Tests: `garmin-stats/test/config.test.ts`. |
| Secrets never enter frontend build vars unless explicitly public | **Done** — verified below (Vercel contract section). |
| Versioned migrations checked in; no opportunistic schema repair at startup | **Already true** (established by `POSTGRESQL-MIGRATION.md`) — verified by reading `garmin-stats/src/server.ts` and `garmin-stats/src/db/migrate.ts`; migrations run only through `npm run db:migrate`. |
| Railway PostgreSQL cutover itself | **Not yet executed** — requires Railway dashboard/CLI access. Runbook below. |
| Backup/recovery evidence for the Railway plan | **Not yet executed** — requires Railway access. Runbook below. |
| Redacted logs/telemetry | **Done** — `garmin-stats/src/http/security-log.ts` (`redact()`), wired into the unhandled-error path, auth failures, and sync/job failures. Tests: `garmin-stats/test/http/security-log.test.ts`. |
| Security observability events | **Done** — `logSecurityEvent()` calls for login/callback failure, state replay, session revocation (both self and "revoke others"), registration-gate denial, import/job failure, export created/downloaded, deletion requested. See "Security observability" below for the one AC item (denied cross-owner access) this Story deliberately did **not** instrument, and why. |
| TLS / callback allowlist / CORS / cookie flags / CSRF / security headers / rate limits | **Done** in code — see "Production security controls" below. TLS itself is terminated by Railway/Vercel, not this application; verifying it end-to-end is part of the deployment runbook, not a unit test. |
| Automated auth/session/CSRF/replay/registration-gate verification | **Already substantially covered** by the HRA-347–355 test suite (`garmin-stats/test/http/auth-context.test.ts`, `oauth-state.test.ts`, `auth-transaction.test.ts`, `account-privacy.test.ts`, `domain/identity/*.test.ts`) — this Story added no new gap here beyond the config/redaction/rate-limit tests listed above. |
| Two-user adversarial verification (HRA-349–352 matrix) | **Already substantially covered** locally (`garmin-stats/test/http/tenant-isolation.test.ts`, `integrations-tenancy.test.ts`, and the `docs/hra-35{0,1,2}-*-coverage.md` notes). Re-running this same suite against the **deployed** PostgreSQL instance is part of the release runbook below — a local-DB pass is not proof of the deployed topology. |
| No private route anonymously reachable except documented public routes | **Verified by reading `router.ts`** — see "Public route inventory" below. |
| Founder migration/auth proven against the deployed database | **Not yet executed** — requires a deployed environment. Runbook below. |
| Release checklist / incident response / rollback documentation | **Done** — see the three sections below. |

## Configuration reference

### PostgreSQL

Local and deployed configuration, migration mechanics, founder import/bootstrap,
and local rollback are documented in `POSTGRESQL-MIGRATION.md`. The only
addition this Story makes: **Railway's own `DATABASE_URL` is the production
equivalent of the local `postgres://...` value in that doc** — set it as a
Railway service variable (Railway auto-populates this when a Railway Postgres
plugin is attached to the service), never committed, never mirrored into a
Vercel variable. `openPostgresDatabase()` (`garmin-stats/src/db/postgres.ts`)
reads it the same way locally and in production; there is no separate
production code path.

### Auth0

Issuer/discovery/audience, web BFF client, native client, callback/logout URL
allowlists, cookie attributes, CORS, and CSRF are fully specified in
`AUTHENTICATION-TENANCY-ADR.md`'s "Registrations and exact allowed URLs" and
"Configuration and deployment contract" tables. This Story adds the startup
validation that enforces several of those rules mechanically instead of only
by code review — see `validateAuthConfig` in `config.ts`:

- every required `AUTH_*` variable is present when `AUTH_ENABLED=true` (reuses
  the ADR's own table — `requireWebAuthConfig`);
- none of them is an unfilled placeholder (`changeme`, `your-...`, `xxx`,
  `example.com`, etc.);
- when `NODE_ENV=production`, `AUTH_ISSUER_URL`, `AUTH_DISCOVERY_URL`,
  `AUTH_WEB_CALLBACK_URL`, `AUTH_WEB_LOGOUT_URL`, and every
  `AUTH_ALLOWED_ORIGINS` entry must be `https://`;
- `AUTH_ISSUER_URL` and `AUTH_DISCOVERY_URL` must share a host (a mismatch
  almost always means the Auth0 dev tenant and the custom domain got crossed
  between environments);
- `AUTH_WEB_LOGOUT_URL`'s origin must be one of `AUTH_ALLOWED_ORIGINS` (the
  post-login/logout redirect target must be a trusted frontend origin);
- `AUTH_SESSION_IDLE_SECONDS` must not exceed `AUTH_SESSION_ABSOLUTE_SECONDS`.

A failure throws at process start, before the port binds — visible immediately
in the Railway deploy log, not only on the first real user's login attempt.

### Secret provisioning and rotation

- **Never commit secrets.** `garmin-stats/.env` and `garmin-stats/.env.test`
  are gitignored; `.env.example` (if present) carries variable names only,
  never real values. Before any commit that touches configuration, run
  `git diff --cached -- garmin-stats/.env*` and confirm it is empty/gitignored
  — this is also covered by the release checklist below.
- **Railway owns every server-only secret**: `AUTH_WEB_CLIENT_SECRET`,
  `DATABASE_URL`, `INTEGRATION_TOKEN_ENCRYPTION_KEY`, `WITHINGS_CLIENT_SECRET`,
  `STRAVA_CLIENT_SECRET`, `PLAN_TEMPLATE_AI_API_KEY`. None of these has a
  `VITE_`-prefixed counterpart; Vite only exposes variables it's explicitly
  given at build time, and Vercel's own variable set for this project must
  contain only `VITE_API_BASE` (a public API base URL, not a secret) per the
  ADR's configuration table.
- **Rotation.** For a client secret (`AUTH_WEB_CLIENT_SECRET`,
  `WITHINGS_CLIENT_SECRET`, `STRAVA_CLIENT_SECRET`, provider API keys):
  generate the new value in the provider's dashboard, set it as the new
  Railway variable value, redeploy (Railway restarts the process, which
  re-reads env at boot — there is no live env reload), then revoke the old
  value in the provider dashboard once the new deploy is confirmed healthy.
  For `INTEGRATION_TOKEN_ENCRYPTION_KEY` specifically: this key decrypts
  already-stored integration tokens (`domain/token-crypto.ts`) — rotating it
  requires decrypting-and-re-encrypting existing rows under the new key in the
  same maintenance window, not a plain swap; treat this as a distinct,
  planned operation, never an ad hoc rotation.

## Security observability

`garmin-stats/src/http/security-log.ts` provides two things:

1. **`redact(input)`** — strips JWT/bearer-token-shaped substrings, session
   cookie values, `code=`/`state=`/`token=`/`secret=`/... query/body
   parameters, and local filesystem paths (which can embed the machine's OS
   account name or an imported filename) from any string before it's logged,
   and truncates to 2000 characters. Applied to: the router's unhandled-error
   catch (including the error's own stack trace), the auth callback failure
   path, and the sync/import failure path (both the value stored in
   `sync_runs.errorMessage` and the value streamed back to the client as
   NDJSON — a PowerShell bridge failure can otherwise leak a local path).
2. **`logSecurityEvent(event, details)`** — one redacted, single-line JSON
   record per event, safe to ship straight to Railway's log aggregation with
   no second filtering pass. Wired at:

| Event | Where |
| --- | --- |
| `auth.login.unavailable` | Login blocked by `AUTH_ENABLED=false` or the pre-existing per-IP rate limit. |
| `auth.callback.replay` | A callback `state` param that fails to consume (already used, expired, or a preauth-cookie mismatch) — distinguished from ordinary missing-params noise. |
| `auth.callback.failed` | Any other callback exchange/validation failure. |
| `auth.session.revoked` | A session revoked on login-rotation or logout. |
| `auth.session.revoked_others` | `POST /api/v1/account/sessions/revoke-others`. |
| `auth.registration.denied` | `resolveExternalLogin` returns `registration_denied`/`account_unusable`. |
| `import.job.failed` | Garmin/Withings/Strava sync failure. |
| `account.export.created` / `account.export.downloaded` | HRA-354 export lifecycle. |
| `account.deletion.requested` | HRA-354 deletion request. |
| `api.error.unhandled` | The router's top-level 500 catch. |

**Deliberately not instrumented: "denied cross-owner access."** Every
owner-scoped repository query is filtered by `WHERE user_id = $identity` at
the SQL level (the HRA-349–352 ownership model), so a request for another
owner's resource returns the same `404 Not Found` as a genuinely nonexistent
one — by design, to avoid an enumeration oracle ("this id exists but isn't
yours" vs. "this id doesn't exist" must be indistinguishable). Emitting a
distinct "cross-owner denial" event at that boundary would require breaking
that indistinguishability (the log line itself would prove existence to
anyone who could read logs) for a signal that's also **not separable from
ordinary not-found traffic** at the point it's raised, so it would be pure
noise. The two-user adversarial test suite (`tenant-isolation.test.ts`,
`integrations-tenancy.test.ts`) is the actual verification mechanism for this
control, not a runtime alert.

## Production security controls

All implemented in `garmin-stats/src/http/`:

- **TLS** is terminated by Railway/Vercel, not this application; there is
  nothing for the Node process to configure. `validateAuthConfig` enforces
  that every Auth0-facing URL is `https://` when `NODE_ENV=production`.
- **Callback/redirect allowlist**: exact-match only, per the ADR — no pattern
  or wildcard is ever accepted (`AUTH_WEB_CALLBACK_URL`/`AUTH_WEB_LOGOUT_URL`
  are single fixed values, not derived from any request).
- **Fixed CORS policy**: `router.ts` echoes only an origin present in
  `AUTH_ALLOWED_ORIGINS` (with `Access-Control-Allow-Credentials: true`) once
  `AUTH_ENABLED` + `AUTH_ALLOWED_ORIGINS` are set; every other origin gets a
  403 before any route dispatches. `http/respond.ts`'s new `corsHeaders(res)`
  is the single source every handler — including the binary/NDJSON responses
  that bypass `send()` (FIT/zip export, background image, sync progress,
  account-data export) — now reads from, replacing four call sites that
  previously hardcoded `Access-Control-Allow-Origin: "*"` regardless of
  `AUTH_ENABLED`. That wildcard was a real cross-domain break waiting to
  happen, not just a hardening nicety: once the frontend (Vercel) and backend
  (Railway) are on different origins, a browser refuses to expose a
  credentialed response whose `Access-Control-Allow-Origin` is `*`.
- **Cookie flags**: `HttpOnly`, `Secure` + `SameSite=None` in production,
  `Path=/`, no `Domain` — see the ADR; unchanged by this Story.
- **CSRF**: pre-existing HMAC-based `X-RunsFree-CSRF` header check
  (`router.ts`), enforced on every unsafe (non-GET/HEAD) private-route
  request; unchanged by this Story.
- **Security headers** (new — `router.ts`, applied to every response):
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`,
  `Strict-Transport-Security: max-age=63072000; includeSubDomains`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (this
  is a pure JSON/binary API). The one HTML response (`GET /api/v1/docs`)
  overrides CSP to allow its own inline `<style>`/`<script>` and same-origin
  `fetch()`, nothing else.
- **Rate limits** (new — `garmin-stats/src/http/rate-limit.ts`): a minimal
  in-process fixed-window limiter, matching this backend's zero-dependency
  default. Auth login/callback already had a rate limiter
  (`auth.controller.ts`'s pre-existing `checkRate`, untouched by this Story).
  This Story adds the same protection to the three import/sync routes: 10
  requests per 5-minute window, keyed per authenticated user + provider (not
  by IP, since these routes already require auth) — `429` via the existing
  RFC 7807 `tooManyRequests()` helper, documented in `openapi.json`. **Single
  Railway instance only**: if this backend ever runs more than one instance,
  both the auth limiter and this one need a shared store (Postgres/Redis)
  instead of in-process memory — flagged as a residual risk below.

## Public route inventory (AC11)

Every route in `garmin-stats/src/http/router.ts` is private (requires a valid
session/bearer identity via `authenticateRequest`) **except** the following,
each deliberately public for a stated reason:

| Route(s) | Why it's public |
| --- | --- |
| `GET /api/v1/auth/login`, `GET /api/v1/auth/callback` | Must be reachable pre-authentication — this is the login flow itself. |
| `GET /api/v1/docs`, `GET /api/v1/openapi.json` | API documentation, no user data. |
| `GET /api/v1/garmin/status` | Probes whether a Garmin device is physically plugged into the host machine — a single-machine hardware fact, not per-user data. |
| `GET /api/v1/activity-types` | A fixed, identical-for-everyone lookup table. |
| `GET /api/v1/locales/:lang` | Static translation bundles, no user data. |
| `POST /api/v1/feedback` | Deliberately anonymous by design (HRA-226) — the one write route the demo guard must never block, since visitors without an account are a primary source of submissions. |
| `GET /api/v1/strava/callback` | OAuth redirect target hit directly by Strava, not by an authenticated app request — its owner comes from server-side OAuth state, not request identity (see the doc comment in `integrations.controller.ts`). |
| `POST /api/v1/source-files/extract` | A pure, stateless transform (decode + parse bytes given in the request body) with no repository/service dependency and no persistence — reads or writes nothing owner-scoped. |

Frontend hiding is never counted as authorization anywhere in this list —
every route above is public at the HTTP layer itself, by the same
`ownerScopedRoute()`/`ownerScopedRoute` check `router.ts` uses for every other
route, not by client-side omission.

## Release checklist

Complete every item before enabling `AUTH_REGISTRATION_MODE=open` in
production:

- [ ] Test evidence: `npm test` (`garmin-stats/`) and `npm run verify`
      (`garmin-dashboard/`) both green; record the pass counts in the release
      comment (not "tests pass").
- [ ] Migrations: `npm run db:migrate:status` against the Railway database
      shows every migration in `garmin-stats/src/db/migrations/` applied, none
      pending.
- [ ] Founder bootstrap/verification executed against the **deployed**
      database: `db:bootstrap-founder` (or `db:import-sqlite` +
      `db:verify-import`), then `db:verify-ownership` and `db:verify-schema`,
      all clean.
- [ ] Backup/recovery evidence recorded (see the runbook below) — a real
      restore test, not just "backups are enabled."
- [ ] `validateAuthConfig` passes at Railway boot (visible in the deploy log —
      no crash-on-start).
- [ ] `git diff --cached -- garmin-stats/.env*` confirmed empty before every
      commit in this release; no secret appears in `git log -p` for this
      release's commits.
- [ ] Two-user adversarial suite re-run against the deployed topology (not
      just local), covering the HRA-349–352 matrix.
- [ ] CORS/cookie/callback smoke test from the real Vercel origin against the
      real Railway origin (not `localhost`) — login, session read, logout,
      CSRF-protected write, and a request from a non-allowlisted origin
      receiving 403.
- [ ] Known residual risks (below) reviewed and accepted or scheduled.
- [ ] Rollback/disable-registration actions (below) rehearsed by the
      responsible operator at least once before go-live.
- [ ] Responsible operational owner named for this release.

### Known residual risks

- The rate limiters (auth and sync) are in-process/single-instance. If Railway
  ever scales this service to more than one instance, both need a shared
  store — not yet a problem at the planned single-instance deployment size.
- `AUTH_SESSION_KEY_CURRENT`/`AUTH_SESSION_KEY_PREVIOUS` rotation (ADR) is not
  automated; it's a manual Railway variable change plus a deploy.
- External penetration testing and formal compliance certification are
  explicitly out of scope for this Story (see the Story's own "Out of scope"
  section).
- The two-user adversarial suite and founder-against-deployed-DB verification
  above are runbook items this session could not execute — they must be run
  by whoever holds Railway/Auth0 production access before registration opens.

## Incident response

Immediate actions, in order, for a suspected authentication/session/account
compromise:

1. **Disable registration**: set `AUTH_REGISTRATION_MODE=founders_only` (or,
   for a full lockout, `AUTH_ENABLED=false`) as a Railway variable and
   redeploy. This is the fastest full stop — no code change required.
2. **Revoke sessions**: use the existing `identityService.revokeOtherSessions`
   / `revokeSessionByCookie` paths — for a suspected account-level compromise,
   revoke that user's sessions; for a suspected systemic issue, this may mean
   a direct database operation to expire every row in the sessions table
   (there is no bulk "revoke all" HTTP endpoint by design — a global session
   wipe is an operational action, not a normal API call).
3. **Revoke provider credentials**: rotate `AUTH_WEB_CLIENT_SECRET` in the
   Auth0 dashboard and Railway (see "Rotation" above) if the client secret
   itself is suspected compromised; for a suspected leaked integration token,
   revoke it at the provider (Withings/Strava dashboard) and clear the stored
   encrypted credential for the affected user(s).
4. **Preserve evidence without exposing training data**: capture the relevant
   `logSecurityEvent` lines (already redacted — safe to export/share) and the
   `sync_runs`/`auth_transactions` table state for the affected window.
   **Never** export raw activity/body/FIT data, provider tokens, or session
   cookie values as part of an incident record — the redaction this Story adds
   is exactly what keeps an incident export from becoming a second exposure.
5. Once contained, follow the release checklist's smoke-test items before
   re-enabling registration.

## Rollback

**Application rollback** (a bad deploy, not a data problem): redeploy the
previous Railway image/commit. This is independent of the database — the
versioned migrations in `garmin-stats/src/db/migrations/` are additive and
forward-only in normal operation, so a same-schema application rollback needs
no database action at all.

**Database migration/recovery** (a bad migration or data corruption) is a
**separate, slower action**, never bundled into "rollback": restore from the
most recent verified Railway PostgreSQL backup (see the runbook below), or
hand-write and apply a new forward migration that corrects the bad state — this
repository has no down-migration tooling, matching `POSTGRESQL-MIGRATION.md`'s
"migrations run only through `db:migrate`" invariant (no automatic repair, no
automatic reversal either).

**No rollback procedure here assumes a live writable SQLite runtime.** SQLite
is archive/import tooling only (`POSTGRESQL-MIGRATION.md`); the former
hosted-demo SQLite-file restore mechanism has been removed entirely
(`server.ts` throws explicitly if `DEMO_DB_BACKUP_PATH` is set) and must never
be reintroduced as a production recovery path.

## Backup/recovery runbook (not yet executed — requires Railway access)

1. Confirm the Railway PostgreSQL plugin's backup plan/tier and note its
   retention window, access control (who in the Railway project can restore),
   and whether backups are encrypted at rest (Railway-managed Postgres
   documents this per plan tier — record the specific answer for the plan in
   use, not a generic assumption).
2. Take (or confirm Railway's automatic) a backup immediately before the
   first production cutover.
3. **Actually restore it** to a scratch Railway Postgres instance (never the
   live one) and run `db:verify-schema` + `db:verify-ownership` +
   `db:verify-import`-style row-count checks against the restored copy to
   prove the backup is real and complete, not merely "exists."
4. Record: who owns recovery execution operationally, the measured
   restore-to-verified time, and the retention window, in the release
   checklist evidence for this release.
5. Repeat step 3 periodically (not just once at initial cutover) — a backup
   nobody has restored recently is not verified evidence.

## Railway PostgreSQL cutover runbook (not yet executed — requires Railway access)

1. Attach a Railway PostgreSQL plugin to the service; Railway sets
   `DATABASE_URL` automatically.
2. Run `npm run db:migrate` against it (via a Railway one-off command/shell,
   not by pointing a local `.env` at the production `DATABASE_URL`).
3. Run the founder bootstrap/import procedure from `POSTGRESQL-MIGRATION.md`
   against the Railway database.
4. Run `db:verify-import` / `db:verify-ownership` / `db:verify-schema` against
   it — all clean.
5. Set every `AUTH_*` Railway variable per the ADR's table; confirm
   `validateAuthConfig` passes at boot (deploy log shows a clean start, not a
   crash).
6. Run the release checklist's CORS/cookie/callback smoke test from the real
   Vercel origin.
7. Only then consider opening `AUTH_REGISTRATION_MODE=open`.
