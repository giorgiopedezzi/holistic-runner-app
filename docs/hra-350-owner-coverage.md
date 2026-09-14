# HRA-350 private-data owner coverage

Every entry below derives its owner from the HRA-348 authenticated request identity; no request body, header, query parameter, or path parameter supplies an owner.

| Surface | Owner-scoped data seam | Cross-tenant result |
| --- | --- | --- |
| Activity list, page, range, count, races, summary, weekly, monthly | `owned-activities.repo.ts` | Empty collection/aggregate |
| Activity object, classification, feedback, type, delete, restore, purge | `owned-activities.repo.ts` plus owner-bound services | `404` for object reads; mutations affect zero foreign rows |
| Track points, pause/chart evidence | Track query joins its parent activity and filters `activities.user_id` | `404` before nested access |
| Body list, range, count, monthly, correlation, trash, restore, purge | `owned-body.repo.ts` | Empty collection/aggregate; foreign mutations affect zero rows |
| Named ranges and race links | `owned-date-ranges.repo.ts`; linked activity requires same owner | `404` for object reads/mutations; foreign links are rejected |
| Activity/workout association and candidate lookup | owner-bound activity, plan-day, and association repositories | `404` for foreign activity/workout identifiers |
| Workout/week/plan/range reports and quality alignment | owner-bound activities, associations, plan instances, and segment alignments | `404` for foreign instance/workout identifiers; no cross-owner rows in aggregates |

External credential and job processing are intentionally excluded: HRA-352 owns their per-tenant isolation. Templates/common data remain HRA-351 scope.
