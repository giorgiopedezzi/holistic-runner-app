# HRA-352 integration/job ownership coverage

Provider credentials, OAuth callback state, and sync/import jobs derive their
owner only from the authenticated request identity (login-url endpoints) or
from server-side OAuth state (callback endpoints) — never from a
client-supplied id, and never a "first user"/"most recently updated" fallback.

| Area | Owner-scoped seam | Cross-tenant result |
| --- | --- | --- |
| Withings/Strava connection status, login-url, disconnect | `router.ts`'s `ownerScopedRoute` requires auth; every handler reads `requestIdentity(req).userId` | A second owner's status reads `{present:false}`; disconnect touches zero rows |
| Provider credentials at rest | `withings_tokens`/`strava_tokens` (`user_id` PK, already present since `001_postgresql_foundation.sql`) + `domain/token-crypto.ts` (AES-256-GCM) | A row is unreadable without the process's own encryption key; `loadToken`/`saveToken` always take an explicit `userId`, no unscoped lookup remains |
| OAuth callback state | `oauth_states` (`004_integration_tenancy.sql`) — minted only for an authenticated user, bound to `(user, provider, redirect_uri)`, single-use (`consumed_at`), expiring (10 min) | Replay, provider-swap, and guessed-token all consume to `null`, collapsed into the same generic failure page |
| Provider account conflict | Partial unique index on `provider_account_id` per token table; `saveToken` catches the violation and raises `ProviderAccountConflictError` | The second owner's exchange is rejected before any write; the first owner's row is untouched, no duplicate row is created |
| Sync/import jobs (Garmin/Withings/Strava) | `controllers/sync.controller.ts` requires auth and passes `--user-id` explicitly to the spawned script; `jobs/sync-*.ts` use that id everywhere (`ON CONFLICT (user_id, filename\|measured_at)`, dedup/cursor queries, the association reconciler) | A second owner's sync never reads/writes the founder's rows; a cross-source Strava/Garmin duplicate match, and the incremental sync cursor, are scoped to the same owner only |
| Sync run locking | `sync_runs` partial unique index on `(user_id, provider) WHERE status='running'` (`services/sync-lock.ts`) | A second concurrent sync for the same owner+provider is rejected (409); a different owner or a different provider is never blocked by it |
| Workout-association reconciliation | `services/workout-associations.service.ts`'s `reconcile(userId)` builds owned repos per call | A sync never scans/mutates another owner's planned workouts or associations |
| **Disconnect vs. an in-flight sync** | `isConnectionActive(db, userId)` (withings.ts/strava.ts), re-checked before every new provider-derived write inside `jobs/sync-withings.ts`/`jobs/sync-strava.ts`'s own loop | A disconnect landing mid-run stops further writes from that checkpoint on (already-imported records are kept); the aborting job exits non-zero, so `sync_runs` is released as `failed`, never left stuck `running` |
| **Late OAuth completion vs. disconnect** | `disconnect()` calls `http/oauth.ts`'s `invalidatePendingOauthStates(db, userId, provider)`, marking every still-open `oauth_states` row for that (user, provider) consumed | A login flow started before disconnect but completed after it fails the same single-use check a replay fails — it can never resurrect the connection disconnect just removed |
| **Founder migration compatibility** | `domain/token-crypto.ts`'s `safeDecryptToken`/`looksEncrypted` — every read path tolerates a legacy plaintext token (written before this Story's encryption existed) and passes it through unchanged; `saveToken` always encrypts on write, so the row self-upgrades on its next refresh | A pre-Story founder connection keeps working through the normal owner-scoped path with no separate data-migration script and no live provider call needed to prove it (`test/integrations/founder-migration-compatibility.test.ts`) |

## PKCE — researched, documented N/A (AC: "where the provider/client type supports or requires it")

Verified against each provider's own published OAuth2 documentation (fetched
2026-09-15):

- **Strava** (`developers.strava.com/docs/authentication/`): the documented
  authorization-code flow lists no `code_challenge`/`code_challenge_method`
  parameter anywhere; token exchange is client_id + client_secret + code.
- **Withings** (`developer.withings.com/.../oauth-authorization-url/`): the
  documented authorize-URL parameters are `response_type`, `client_id`,
  `scope`, `redirect_uri`, `state`, and an optional `mode` — no
  `code_challenge`/`code_challenge_method`.

Neither provider's authorization endpoint accepts or validates a PKCE
challenge at all — it isn't merely "not required for a confidential client",
it is **not supported by the provider**, so there is nothing this
application could correctly implement even if it wanted to go beyond the
AC's own conditional. Both integrations are also confidential, server-side
clients (`client_secret` required at token exchange, never exposed to a
browser) — PKCE's actual purpose (protecting a *public* client that can't
hold a secret from authorization-code interception) doesn't apply to this
architecture either. The AC's own wording ("where the provider/client type
supports or requires it") is satisfied vacuously and correctly: the
condition never fires for either provider.

## Job ownership — every mechanism that actually exists is owner-scoped

This application has no queue, broker, or automatic retry system — sync
stays "an authenticated HTTP request spawns a child process synchronously"
(pre-existing architecture, unchanged by this Story). The mechanisms that
*do* exist are all owner-scoped:

- **Locks**: `sync_runs`'s partial unique index (`services/sync-lock.ts`).
- **Idempotency**: `ON CONFLICT (user_id, filename|measured_at)` in every
  insert (`test/jobs/fit-dedup-tenancy.test.ts` proves this directly against
  the real constraint).
- **Progress**: `http/stream-sync.ts`'s NDJSON stream is scoped to the single
  HTTP response/child-process pair for that request — never shared across
  requests or owners.
- **Errors/result records**: `sync_runs.error_message`/`imported`/`skipped`/
  `errors`, written by `controllers/sync.controller.ts`'s
  `acquireSyncLock`/`releaseSyncLock` pairing around each run.
- **Retries, queues**: do not exist anywhere in the codebase — nothing to
  scope. (Not a gap introduced by this Story; the pre-existing
  spawn-and-wait model never had them either.)

## Manual FIT upload — the ONLY deliberately deferred capability

The application has **no browser/manual FIT-upload feature** — nothing to
scope, and building one is explicitly out of this Story's slice (a separate
future product capability, tracked as a candidate below, not an HRA-352
blocker). What this Story *does* cover, fully:

> All existing FIT ingestion paths — Garmin MTP/device sync
> (`jobs/sync-garmin.ts`) and FIT archive reprocessing
> (`jobs/reprocess-fit-archive.ts`) — execute under an explicit owner.
> Files, hashes, deduplication, errors, generated derivatives, and cleanup
> state never cross owner boundaries for either path. Any future manual
> FIT-upload capability must reuse this same owner-scoped ingestion
> contract (explicit `user_id` on every write, `(user_id, filename)`
> uniqueness, no unscoped lookup) rather than reintroducing a singleton.

`test/jobs/fit-dedup-tenancy.test.ts` proves this for both the import path
(`(user_id, filename)` uniqueness — idempotent per owner, no false collision
across owners, a purge's dedup-blocking survives per owner only) and the
reprocessing path (`WHERE user_id=$1 AND filename=$2` never resolves to
another owner's activity even when the filename string collides).

`fit-archive/` itself remains a single shared filesystem folder, not
per-owner paths — a deliberate, documented consequence of there being one
physical Garmin device and one operator today (no multi-tenant upload
feature exists to need per-owner storage paths yet).

## CLI-only operator tools (`npm run sync:*`, `withings:login`, `reprocess:fit`)

These remain founder-only local tools with no HTTP request/session to derive
an owner from. Each accepts an explicit `--user-id`; when omitted it falls
back to the stable `FOUNDER_USER_ID` constant — a documented, fixed default
for the pre-multi-user period, not a "whichever row happens to exist"
singleton. The HTTP-triggered path (`controllers/sync.controller.ts`) never
relies on this default — it always passes the authenticated caller's id.

## Two-user adversarial coverage

| Surface | Test |
| --- | --- |
| Provider status | `withings-tenancy.test.ts`, `strava-tenancy.test.ts` |
| Provider account identity | `withings-tenancy.test.ts`, `strava-tenancy.test.ts` (conflict tests) |
| Scopes | `withings-tenancy.test.ts`, `strava-tenancy.test.ts` (dedicated scope-isolation tests) |
| Token persistence/access | `withings-tenancy.test.ts`, `strava-tenancy.test.ts`, `token-redaction.test.ts` |
| OAuth state | `oauth-state.test.ts` (replay/swap/guessed/expired/two-user) |
| Cursor/sync state | `cursor-isolation.test.ts` |
| Sync locks/runs (job ownership) | `sync-lock.test.ts`, `disconnect-in-flight.test.ts` |
| Import/reprocessing state | `fit-dedup-tenancy.test.ts` |
| Errors/results | `sync-lock.test.ts` (release outcomes), `token-redaction.test.ts` |
| Connection IDs | **N/A — no such resource exists.** A connection's identity IS the owner's `user_id` (the token tables' own PK); there is no separate opaque "connection ID" to guess. Covered by the same status/disconnect tests as "provider status". |
| Disconnect | `withings-tenancy.test.ts`, `strava-tenancy.test.ts`, `integrations-tenancy.test.ts`, `disconnect-in-flight.test.ts` |
| Job ownership | `sync-lock.test.ts`, `disconnect-in-flight.test.ts` |

Per-file tests never spawn the sync scripts or build a fake HTTP/queue
surface — they exercise the real repository/service/domain functions the
jobs and controllers actually call, at the seam that genuinely enforces
isolation (matching `test/helpers/server.ts`'s own established constraint of
never spawning sync scripts in tests).

## Registration gate

`test/config.test.ts` now asserts `AUTH_REGISTRATION_MODE` unset (the real
deployment default — `.env.example` never sets it) resolves to
`"founders_only"`, and that only the exact literal `"open"` changes it. The
domain-level enforcement (`isRegistrationAllowed`) was already covered by
HRA-348's `test/domain/identity/registration-gate.test.ts`.

## Candidates outside this slice (not implemented)

- **Manual browser FIT upload/import.** See above — a genuinely new product
  capability (endpoint, storage, hashing, dedup, derivative generation,
  cleanup lifecycle), not a scoping fix. Tracked as a future Story.
- `.claude/rules/backend.md` still documents `node:sqlite` as the runtime,
  and `docs/ingestion.md`/`docs/schema.md` still describe the pre-Postgres
  single-row token model — both stale relative to the actual Postgres/
  ownership architecture. Pre-existing drift, not introduced by this Story.
- A general job queue/supervisor remains unbuilt — the disconnect/in-flight
  gap was closed via connection-state revalidation instead (see above),
  which is sufficient for the current synchronous, single-run-at-a-time
  architecture; a real queue would only become necessary if concurrent
  multi-step background jobs are introduced later.
