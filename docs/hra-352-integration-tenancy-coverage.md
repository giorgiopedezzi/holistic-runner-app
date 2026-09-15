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
| Sync/import jobs (Garmin/Withings/Strava) | `controllers/sync.controller.ts` requires auth and passes `--user-id` explicitly to the spawned script; `jobs/sync-*.ts` use that id everywhere (`ON CONFLICT (user_id, filename\|measured_at)`, dedup queries, the association reconciler) | A second owner's sync never reads/writes the founder's rows; a cross-source Strava/Garmin duplicate match is scoped to the same owner only |
| Sync run locking | `sync_runs` partial unique index on `(user_id, provider) WHERE status='running'` (`services/sync-lock.ts`) | A second concurrent sync for the same owner+provider is rejected (409); a different owner or a different provider is never blocked by it |
| Workout-association reconciliation | `services/workout-associations.service.ts`'s `reconcile(userId)` now builds owned repos per call (was previously unscoped — see "What this Story does NOT cover" below) | A sync no longer scans/mutates another owner's planned workouts or associations |

## CLI-only operator tools (`npm run sync:*`, `withings:login`, `reprocess:fit`)

These remain founder-only local tools with no HTTP request/session to derive
an owner from. Each accepts an explicit `--user-id`; when omitted it falls
back to the stable `FOUNDER_USER_ID` constant — a documented, fixed default
for the pre-multi-user period, not a "whichever row happens to exist"
singleton. The HTTP-triggered path (`controllers/sync.controller.ts`) never
relies on this default — it always passes the authenticated caller's id.

## What this Story does NOT cover (deviations, not silent gaps)

- **PKCE.** Not added. Both Withings and Strava use confidential,
  server-side authorization-code flows (`client_secret` already required at
  token exchange, never exposed to a browser). PKCE exists to protect
  *public* clients that can't hold a secret — neither integration is one, so
  AC6's "where the provider/client type supports or requires it" doesn't
  apply here.
- **A general job queue/broker.** Sync stays "HTTP request spawns a child
  process" (pre-existing architecture). `sync_runs` adds a real owner-scoped
  lock and result record, not a queue — retries/backoff are still the
  caller's responsibility, same as before this Story.
- **Manual FIT upload/import.** No such feature exists in this codebase —
  the only inbound FIT path is the Garmin MTP device sync
  (`jobs/sync-garmin.ts`), which this Story does scope to an explicit owner.
  There is no separate upload/hash/dedup/derivative/cleanup pipeline to make
  owner-scoped.
- **`jobs/reprocess-fit-archive.ts`.** Scoped to an explicit `--user-id`
  (default `FOUNDER_USER_ID`) for its activity lookup, since `filename` is
  only unique per-owner. It is still a shared-folder operator maintenance
  script, not a per-owner feature.
