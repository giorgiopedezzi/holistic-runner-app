# HRA-351 ownership coverage matrix

Private requests derive their owner only from the validated request identity. A
missing, foreign, or malformed identifier is deliberately indistinguishable
from a missing resource at the HTTP boundary.

| Area | Read/list/export paths | Mutation/reference paths | Enforcement |
| --- | --- | --- | --- |
| Plan templates | list, by id, mobile eligibility, instantiate preview | create, update, approve, delete, instantiate | `owned-plan-templates.repo.ts`; instances may only reference an owned template |
| Plan instances | list, by id, active agenda, date/day list, day and ZIP FIT exports | instantiate, patch, approve, delete, regenerate | `owned-plan-instances.repo.ts`; all queries filter `plan_instances.user_id` |
| Logical workouts and schedule slots | instance days, workout report, week/plan/range reports, FIT exports | single-day edit, full day replacement, atomic swap, regenerate | instance ownership is joined before day/workout reads and every write; `(instance_id, workout_id)` stays the logical identity |
| Associations and report drill-down | association candidates, workout/range reporting, quality alignment | set/clear association, quality alignment | HRA-350 owned association repositories and HRA-351 owner-scoped reporting service |
| Saved reports/configuration | date-range list/read | create, update, delete, activity reference | `owned-date-ranges.repo.ts`; activity reference requires the same owner |
| Settings, preferences, backgrounds | settings and custom-background read | every settings sub-resource and background upload | `owned-settings.repo.ts`; a settings row is created with each new user |
| Common reference data | `GET /api/v1/activity-types` | none | separate `activity_types` repository; it has no ordinary user write route |

## Common-data boundary

`activity_types` is the sole current application-owned reference namespace and
is represented by its own table/repository. Private tables always require a
non-null `user_id`; no null owner, request field, or client-supplied scope flag
can make a private record common.

There is intentionally no system-template promotion endpoint or schema in this
slice. A future promotion must create a separate, auditable system
representation and copy from it into a newly-owned user template; it must not
reclassify or overwrite the source template.
