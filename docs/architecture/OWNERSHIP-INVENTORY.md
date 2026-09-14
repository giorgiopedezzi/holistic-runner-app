# PostgreSQL ownership inventory

This inventory is the ownership contract for the current runtime schema. A
missing `user_id` is never a signal that a row is public.

| Area | Ownership rule |
| --- | --- |
| `users`, `external_identities`, `sessions`, `user_entitlements`, `security_events` | Identity-system records. An external identity is authoritative only by `(issuer, subject)` and belongs to one `users.id`; email is metadata. |
| `activities`, `body_measurements`, `date_ranges`, `plan_templates`, `plan_instances`, `workout_associations`, `user_settings`, `strava_tokens`, `withings_tokens` | Private roots with a non-null `user_id` referencing `users`. Uniqueness is owner-scoped where an external/keyed value is reusable: activity filename, measurement time, range name. |
| `track_points` | Private child inherited through mandatory `activities(id)` with cascade delete. |
| `plan_instance_workouts`, `plan_instance_days` | Private children inherited through mandatory composite parent constraints `(instance_id, user_id)`; days also require their instance workout. |
| `workout_segment_alignments` | Private child inherited through mandatory `workout_associations(id)` with cascade delete. |
| `activity_types` | Explicit application-owned common lookup data; it has no user ownership and is seeded by migration. |
| `feedback` | Explicitly anonymous product-feedback data, not a private user aggregate; HRA-352 owns any future tenant-aware feedback policy. |
| SQLite archive, FIT archive/import files, environment credentials | Durable artefacts outside PostgreSQL. SQLite remains read-only import/archive tooling; HRA-352 owns credential/import-file tenancy. |

`db:verify-ownership` checks the database relationships above after import or
bootstrap. It detects orphaned children, cross-owner roots/children, and a
founder user missing its required settings. Database foreign keys are the
enforcement boundary; the verifier is repeatable evidence, not a fallback
authorization path. Route authorization remains owned by HRA-350/HRA-351.
