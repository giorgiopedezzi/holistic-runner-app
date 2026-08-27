---
paths:
  - "garmin-stats/src/http/router.ts"
  - "garmin-stats/openapi.json"
---

# HTTP contract synchronization

- `garmin-stats/openapi.json` is the machine-readable API contract.
- **Any change to `garmin-stats/src/http/router.ts` that adds a route or changes a method, path, or response shape must update `garmin-stats/openapi.json` in the same commit.**
- Treat OpenAPI drift as a bug, not deferred cleanup; a stale spec is worse than no spec because it is authoritative-looking.
- Before changing HTTP behavior, read `docs/api.md` and follow `rest-api-standards`.
