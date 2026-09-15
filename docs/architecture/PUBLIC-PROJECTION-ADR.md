# Public projection and redaction architecture

Status: accepted for HRA-359 (2026-09-15)

## Decision

Guest Runs Free reads a persisted, versioned public snapshot. It never creates
an anonymous owner, calls authenticated owner endpoints, or reads private owner
repositories on demand. The private publication path may read founder-owned
data and call the existing Runs Free domain/services, but it crosses the public
boundary only through `public-projection.service.ts`.

The rejected alternative was an on-demand adapter over the existing private
repositories. Although cheaper to wire initially, it would make anonymous read
availability depend on private APIs, keep private identifiers live in the
request path, and create an unsafe fallback temptation when projection logic
failed. A persisted snapshot makes the safe failure result structural.

## Boundary and data flow

1. An authenticated publication orchestrator loads founder-owned inputs.
2. Existing activity, plan, and reporting domain code computes all values. The
   projector does not calculate or reinterpret pace, totals, comparisons,
   coverage, missing values, or evidence.
3. The orchestrator supplies a private source-version coordinate and resource
   fields to `public-projection.service.ts`.
4. The service hashes the version coordinate, resolves stable random UUIDs for
   each `(resource kind, private id)`, applies the allowlist/redaction policy,
   and atomically replaces the snapshot.
5. Anonymous code receives only `published-projection.repo.ts` and reads
   `published_public_projections` through `getBySlug`. That repository has no
   refresh/control methods, and the view has no owner id, private
   resource id, retry detail, credentials, or private-source relationship.

`owner_user_id IS NULL` (or any missing ownership value) is never a publication
signal. Publication exists only when a `public_projection_sources` row is in
the explicit `published` state and has a valid snapshot.

## Public contract and exclusions

The canonical field allowlist lives in
`domain/publication/public-projection.ts#PUBLIC_FIELD_ALLOWLIST`:

| Resource | Approved top-level fields |
|---|---|
| Profile | display name, biography, avatar URL, locale, unit system |
| Activity | public title/date/sport, duration and distance metrics, aggregate HR/cadence/elevation, coordinate-free track values |
| Plan | public name/event/race dates, public week/workout structure |
| Report | kind/range/freshness and existing calculated datasets, comparisons, denominators, coverage and evidence |

Unknown top-level fields are omitted. At every nested depth the projector strips
private/internal identifiers, exact or named locations, latitude/longitude,
credentials, sessions, provider identity/tokens, email, device/filesystem data,
filenames, raw payloads, and private notes. Missing authoritative values remain
`null` or absent; they are never changed to zero.

Resource envelopes receive random UUID public identifiers stored in
`public_projection_identifiers`. Private IDs never enter snapshot JSON. The
source version exposed publicly is an HMAC keyed by the private projection UUID,
not a plan revision, activity ID, timestamp coordinate, or provider version.
The public slug is immutable after source creation so a failed refresh can
never retarget the last safe snapshot to a different URL.

## States, freshness, retry, and failure

Publication state is explicit:

- `draft`: snapshot work may exist but public reads return unavailable;
- `published`: the last complete snapshot is readable;
- `suspended`: public reads immediately return unavailable while the safe
  snapshot may remain available for later controlled republication.

`sourceVersion` identifies the authoritative input set. Repeating a refresh
with the same version returns `unchanged`, preserving public IDs, payload, and
`projectedAt`. A new version is built and saved in one transaction.
`projectedAt` is the snapshot freshness time; `last_attempted_at` is private
operational metadata.

If mapping, redaction, validation, or persistence fails, the transaction rolls
back. A fixed non-sensitive retry marker is recorded separately. The last valid
published snapshot remains unchanged; if none exists, public reads honestly
return `unavailable`. There is no fallback to a private repository or API.

## Follow-on boundaries

HRA-359 provides storage, redaction, stable identities, refresh semantics, and
the safe read abstraction. Founder entitlement/lifecycle commands, anonymous
HTTP routes, Guest UI, registration conversion, ordinary-user publication, and
billing remain separate Stories. Any later public endpoint must depend on
`createPublishedProjectionRepo`; it must not receive the private projection
repository or accept an owner/private resource identifier.
