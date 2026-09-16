# Founder public access, projection, and redaction architecture

Status: accepted for HRA-359 (2026-09-15), snapshot-only delivery superseded by HRA-372 (2026-09-16)

## Decision update: live founder reads

HRA-372 supersedes the HRA-359 decision that Guest Runs Free must be delivered only from a persisted public snapshot. The product requirement changed: the founder's sporting and Runs Free product data is intentionally public, and Guest needs the same domain fidelity as the normal product rather than a reduced parallel snapshot experience.

Approved Guest routes may therefore execute the existing domain read/compute paths against the founder account. This is not a general anonymous-owner mechanism. The HTTP boundary selects the fixed `FOUNDER_USER_ID`; the client never supplies an owner or user identifier that becomes authoritative.

The persisted projection, allowlist, redaction rules, opaque public identifiers, and public-only repository remain in place until the live replacement is proven and the later retirement Story removes them. They remain useful security inventory: they document data that was already reviewed for public exposure and the fields that must never leak accidentally.

## Access contexts

Strict authenticated identity and founder-public access are different concepts:

- **Authenticated context** comes only from a validated session or bearer credential. It is required for private reads and every persistent, external-side-effecting, or billable operation.
- **Founder-public context** exists only when an explicitly reviewed `PUBLIC_READ` or `PUBLIC_COMPUTE` boundary receives no credential. It contains the server-selected `FOUNDER_USER_ID`; it is never returned by `requestIdentity()`.
- **Public-feedback context** permits only the dedicated anonymous product-feedback endpoint and carries no owner identity.

`deriveRequestAccessContext()` requires a reviewed capability as input and does not infer safety from `GET`, `POST`, or any other method. `requestIdentity()` remains strict and has no founder fallback.

Credential absence and credential failure are intentionally different. A request with no session cookie or Authorization header may enter an approved public context. If either credential is supplied, it must validate. Malformed, expired, revoked, wrong-issuer, wrong-audience, bad-signature, or disabled-account credentials return the normal authentication failure and never downgrade to founder-public access. An unrelated cookie is not an authentication attempt.

## Route capability matrix

This matrix is the reviewed target contract for the Guest-relevant API surface. HRA-372 defines the boundary and does not remap the router; HRA-373 and the later product slices own consumer wiring. An unlisted route is not public.

| Capability | Exact routes / route families | Decision |
|---|---|---|
| `PUBLIC_READ` | `GET /api/v1/range`, `/summary`, `/weekly`, `/monthly` | Founder activity aggregates are approved public sporting data. |
| `PUBLIC_READ` | `GET /api/v1/activities`, `/activities/count`, `/activities/races`, `/activities/:id`, `/activities/:id/track` | Founder activity list, detail, coordinate-free track, counts, and race discovery are approved. Private identifiers remain server-internal. |
| `PUBLIC_READ` | `GET /api/v1/date-ranges`, `/activity-types` | Founder range definitions and the fixed activity-type lookup are approved. Named-range mutation is not. |
| `PUBLIC_READ` | `GET /api/v1/plan-templates`, `/plan-templates/:id`, `/plan-templates/:id/mobile-eligibility` | Founder plan-product reads are approved. |
| `PUBLIC_READ` | `GET /api/v1/plan-instances`, `/plan-instances/active`, `/plan-instance-days`, `/plan-instances/:id` | Founder resolved-plan reads are approved. |
| `PUBLIC_READ` | `GET /api/v1/plan-instances/:id/reports/workouts/:workoutId`, `/plan-instances/:id/reports/weeks`, `/plan-instances/:id/reports/plan`, `/reports/range` | Existing reporting calculations may run for the founder and retain their normal missing-data semantics. |
| `PUBLIC_READ` | `GET /api/v1/locales/:locale` | Static locale content is safe and carries no owner data. |
| `PUBLIC_READ` (transition only) | `GET /api/v1/public/profiles/:slug` and its `/activities`, `/plans`, `/reports` collection/resource descendants | The persisted projection remains supported until replacement is proven. |
| `PUBLIC_COMPUTE` | `POST /api/v1/plan-templates/generate`, `/plan-templates/prompt-preview` | Pure DSL/prompt preview; no persistence, billable provider, or external side effect. |
| `PUBLIC_COMPUTE` | `POST /api/v1/plan-templates/:id/instantiate/preview`, `/plan-instances/:id/days/:dayId/validate` | Founder plan data may be read to compute a preview, but nothing may be saved. |
| `AUTHENTICATED_READ` | Every `GET /api/v1/body-measurements...` route | Body/scale data is not approved for public exposure. |
| `AUTHENTICATED_READ` | `GET /api/v1/activities/trash`, `/activities/:id/association`, `/activities/:id/association-candidates` | Deleted-state and workout-association internals remain private. |
| `AUTHENTICATED_READ` | `GET /api/v1/settings`, `/settings/background-image` | Account configuration and uploaded assets remain private; Guest uses public product defaults. |
| `AUTHENTICATED_READ` | `GET /api/v1/plan-instances/:id/days/:dayId/fit`, `/plan-instances/:id/fit` | Device-export artifacts are not part of public plan exploration. |
| `AUTHENTICATED_READ` | Account, publication-control/preview, Garmin/Withings/Strava status/login, and account-export download routes | Account, credential, provider, device, export, and publication administration remain private. |
| `AUTHENTICATED_WRITE` | All activity mutations: range/item delete, classify, classification feedback, confirm, restore/purge, type changes, and association changes | Persistent activity changes require authenticated ownership. |
| `AUTHENTICATED_WRITE` | All body-measurement delete/restore/purge routes | Persistent body-data changes require authenticated ownership. |
| `AUTHENTICATED_WRITE` | `POST /api/v1/date-ranges`, `PUT/DELETE /api/v1/date-ranges/:id` | Named-range writes remain private. |
| `AUTHENTICATED_WRITE` | Plan-template create/update/delete/approve/instantiate, plan-instance update/delete/regenerate/approve/day edit/workout swap, and report quality-alignment changes | Plan and report persistence remains private. |
| `AUTHENTICATED_WRITE` | `POST /api/v1/plan-templates/ai-generate` | The AI call is billable and remains authenticated even though its response is a preview. |
| `AUTHENTICATED_WRITE` | Settings/profile/background updates; sync/import/extract; provider disconnect; publication publish/refresh/suspend; session/account-privacy actions | Persistent or external side effects retain authenticated ownership plus existing CSRF/origin/session protections. |
| `PUBLIC_FEEDBACK` | `POST /api/v1/feedback` | Anonymous product feedback remains the sole public write and carries no founder owner context. |

The login/callback endpoints, API documentation, OpenAPI document, OAuth callback, and CORS preflight are protocol/bootstrap infrastructure rather than founder product-data capabilities. Their existing dedicated controls remain unchanged.

## Body-data decision

Withings/body-measurement data is explicitly excluded from public access in this decision. Weight, fat ratio/mass, muscle mass, hydration, bone mass, BMI, heart rate, body ranges, monthly body averages, body/activity correlation, counts, and trash state all remain authenticated. Public activity/report routes must not start returning body datasets merely because a report implementation can query them internally. A later explicit security/product decision is required to change this classification.

## Stable public entry and suspension

The public product URL remains `/p/founder-journey`; `FOUNDER_PUBLIC_SLUG` is stable and is not client-configurable. The slug selects the public founder product, not an arbitrary tenant or owner.

Publication suspension remains the public kill switch. Before a founder-public read or compute reaches an owner-scoped repository, the HTTP boundary must confirm that the founder publication is in the `published` state. `draft`, `suspended`, missing, or invalid publication state returns the same generic public-unavailable response and performs no live owner read. HRA-373 owns that live routing/gate wiring.

## Preserved projection security inventory

Until retirement, the HRA-359 projection behavior remains unchanged:

1. Authenticated publication code loads founder inputs and uses existing domain calculations.
2. `public-projection.service.ts` hashes private source coordinates, resolves stable random public UUIDs, applies the allowlist/redaction policy, and atomically replaces the snapshot.
3. Anonymous projection routes receive only `createPublishedProjectionRepo`; they never receive a private owner repository.
4. Projection state is explicit (`draft`, `published`, `suspended`), refresh is idempotent by source version, and failure preserves the last valid snapshot without falling back to a private repository.

The canonical projection allowlist remains `domain/publication/public-projection.ts#PUBLIC_FIELD_ALLOWLIST`. Its denylist continues to prohibit private/internal identifiers, exact or named locations, coordinates, credentials, sessions, provider identity/tokens, email, device/filesystem data, filenames, raw payloads, and private notes at every nested depth. Missing authoritative values remain null or absent rather than being rewritten as zero.

## Rejected alternatives

Making `requestIdentity()` return the founder when credentials are missing was rejected because every existing private controller would silently become eligible for anonymous access, including writes and provider/account routes.

Treating all `GET` routes as public was rejected because body data, trash, associations, settings, account/export, provider status, publication control, and device-export artifacts are reads but are not approved public data.

Deleting the persisted projection immediately was rejected because it would remove the current safe public path and its reviewed redaction inventory before the live replacement and suspension gate are proven.
