# Account privacy lifecycle

HRA-354's account surface tells a runner what happens to private data.

- A personal-data export is a captured, owner-scoped JSON snapshot with a
  `runs-free-personal-data-export` manifest at version 1. It includes the
  private PostgreSQL aggregates listed in the manifest and excludes sessions,
  authentication and integration credentials, identity-provider metadata,
  security-event payloads, common lookup data, and every other user's data.
- Original uploaded FIT files are currently unavailable in this export because
  the legacy archive is not a tenant-addressable runtime artefact. Prior
  generated exports are likewise not recursively exported. Both limitations
  are stated in the product UI and manifest rather than silently omitting data.
- Export links require both the authenticated owner and a high-entropy secret,
  expire after 24 hours, and are removed by the account-lifecycle worker.
  Invalid, expired, and cross-owner links use the same not-found response.
- Disconnecting Strava or Withings immediately removes/revokes that owner's
  credential and stops future sync. It never changes Runs Free access and
  never silently deletes imported activities or measurements.
- Deletion needs explicit confirmation plus a session created in the last five
  minutes. Acceptance marks the account `deletion_pending`, revokes all
  sessions and integration credentials, invalidates pending OAuth state, and
  queues durable removal. The application worker retries queued/failed requests
  every minute and deletes the ownership-inventory user root in one PostgreSQL
  transaction, so private children cascade while common lookup data remains.
  There is no cancellation/grace period. Retained PostgreSQL backups follow
  their ordinary recovery-retention schedule and are not physically erased
  immediately; partial worker failures remain queued or failed without
  restoring private access.
- Runs Free processes training and health-adjacent data to provide the service
  and connected integrations. Public publication is a distinct opt-in surface;
  it is not part of this private account lifecycle.
