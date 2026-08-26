---
paths:
  - "garmin-stats/src/**/*.ts"
  - "garmin-stats/package*.json"
  - "garmin-stats/tsconfig*.json"
---

# Backend invariants (`garmin-stats/`)

- Runtime is **Node 24** and executes `.ts` files natively; there is no build step.
- SQLite is **`node:sqlite`**. Do not introduce `better-sqlite3` or other native addons.
- Runtime dependencies are intentionally minimal. `fit-file-parser` is the deliberate exception, used only as an independent FIT decoder for cross-validation; its output is never persisted as the authoritative parse.
- Module system is ESM (`"type": "module"`) with `"module": "NodeNext"`.
- Imports must include the `.ts` extension explicitly.
- `__dirname` is unavailable in ESM. Derive it using `fileURLToPath(import.meta.url)` + `path.dirname()`.
- SQLite parameters use `$param` named syntax. Use typed builders from `db.ts` (`activityParams`, `trackPointParams`, `bodyMeasurementParams`); never cast to `Record<string, unknown>` to bypass typing.
- Run TypeScript entry points directly with Node.
- The backend does not auto-reload by default. During development use `npm run server:watch` (`node --watch src/server.ts`) when auto-restart is needed.
- Respect the architecture pipeline: `http/ → controllers/ → services/ → repositories/`; `domain/` stays pure/no-I/O.
- Naming: integration/client modules are nouns; executable jobs/commands are verbs.

Before changing backend behavior, read the relevant routed document from root `CLAUDE.md` (`docs/api.md`, `docs/schema.md`, or `docs/ingestion.md`).
