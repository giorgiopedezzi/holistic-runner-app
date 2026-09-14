# Local PostgreSQL migration

This is the explicit migration path from the local SQLite archive to a local
PostgreSQL database. It does not touch Railway, production data, deployment
variables, Auth0, or provider-account design.

## Local setup

Create an empty local PostgreSQL database, then set this in `garmin-stats/.env`:

```dotenv
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/runs_free
```

From `garmin-stats/`, apply the versioned schema and inspect its state:

```bash
npm run db:migrate
npm run db:migrate:status
```

Migrations are recorded in `schema_migrations`. They run only through
`db:migrate`; neither server startup nor normal jobs repair, alter, seed, or
backfill the PostgreSQL schema.

## SQLite import

Keep `garmin.db` as an archive and source it read-only:

```bash
npm run db:import-sqlite -- --source ./garmin.db
npm run db:verify-import
npm run db:verify-ownership
npm run db:verify-schema
```

The importer uses one PostgreSQL transaction, refuses a destination that has
domain data already, preserves useful numeric IDs and relationships, and emits
only table row counts. A failure rolls back the destination transaction.

The deterministic founder is UUID
`00000000-0000-4000-8000-000000000001`. It is never derived from an email,
Auth0 issuer, or Auth0 subject. Import assigns every SQLite user-owned root to
it; children inherit ownership through their parent. To prepare an empty,
migrated database without importing SQLite data, run:

```bash
npm run db:bootstrap-founder
```

Bind the founder's provider identity only after obtaining the provider's stable
issuer and subject values. The operation is idempotent and refuses to steal an
identity already bound to another internal user; email is neither accepted nor
consulted:

```bash
npm run db:bind-founder-identity -- --issuer https://issuer.example/ --subject provider-subject
```

`db:verify-ownership` fails non-zero for orphaned or cross-owner child/root
relationships and a missing founder settings row. It is required after import
or founder bootstrap, but it does not open registration. Registration remains
closed until the later authentication and tenant-isolation Stories complete.

## Architecture

`users` and `external_identities` provide storage only; no runtime
authentication is implemented. `user_settings` replaces singleton settings.
User-owned aggregate roots have `user_id`; `track_points` inherit through
activities, while plan-day/workout data inherit through plan instances.

`plan_instance_workouts` stores a stable logical workout. `plan_instance_days`
stores a calendar slot and references that workout. Its `(instance_id,
workout_id)` uniqueness is `DEFERRABLE INITIALLY IMMEDIATE`, so a slot swap can
be executed atomically with constraints deferred. Associations prove both the
activity and instance share a user through composite foreign keys; segment
alignments are children of an association.

The importer intentionally excludes empty legacy `training_plans` and
`planned_workouts`.

## Local rollback

For development only, drop and recreate the local PostgreSQL database, run
`db:migrate`, and re-run the SQLite import. Do not delete `garmin.db`; it is
the source/archive. No operation here changes deployed Railway SQLite data.

## Deferred

- Auth0 runtime integration
- deployed Railway cutover
- Strava multi-user redesign
- Withings multi-user redesign
- publication
- audit/security-event model

## Runtime boundary

The local server, sync jobs, archived FIT reprocessor, and plan-date cleanup
use PostgreSQL. SQLite remains only as the read-only source for the explicit
SQLite importer and legacy migration/archive tests.

The former demo database restore has been removed: replacing a live SQLite
file has no safe PostgreSQL equivalent and is not a supported runtime feature.
`DEMO_DB_BACKUP_PATH` now fails startup explicitly so it cannot be mistaken for
a working reset mechanism.
