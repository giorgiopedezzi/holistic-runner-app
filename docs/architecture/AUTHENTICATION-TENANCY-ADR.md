# Authentication and tenancy

> **Architecture Decision Record — accepted for implementation planning**
>
> **Decision date:** 2026-09-14
> **Scope:** Runs Free identities, sessions, tenancy boundary, and the configuration
> contract for future web and Capacitor clients. No login UI, migration, or
> authentication runtime is introduced by this record.

## Decision

Use **Auth0** as the managed OpenID Connect provider. Register three distinct
resources in Auth0:

1. a **Regular Web Application** for the confidential Railway BFF;
2. a **Native Application** for the future Capacitor app; and
3. a Runs Free **API** resource server with its own audience.

The browser is a BFF client, not an OAuth public client. It uses Authorization
Code flow at Railway, which retains provider tokens server-side and gives the
browser only an opaque application-session cookie. The Capacitor client is a
separate public client and uses Authorization Code + PKCE with `S256`.

Auth0's current B2C Free plan includes up to 25,000 monthly active users,
passwordless authentication, unlimited social connections, and one custom
domain; the planned MVP cost is therefore **$0/month**, excluding a verified
SMTP sender, Apple Developer Program membership, the existing Vercel/Railway
hosting, and any future Auth0 paid-plan upgrade. See [Auth0 pricing](https://auth0.com/pricing).

This is intentionally a managed-provider choice, not an endorsement of a
proprietary identity model. The application owns a stable internal `users` row
and provider identities are stored as immutable `(issuer, subject)` pairs.
Auth0 Management API export and ordinary OIDC discovery/JWKS validation keep
migration possible; Auth0-specific Universal Login configuration, Actions, and
connection settings are the principal lock-in cost.

## Context and alternatives

Auth0 directly supports Google, Apple, email one-time-passwords, and email
magic links. Its email magic-link flow has a real limitation: it requires
Classic Login and can fail when an iOS user begins in one browser and opens the
email in another. The product default is therefore **email OTP**; magic link
is an optional web-only method, not the native fallback. [Auth0's passwordless
documentation](https://auth0.com/docs/authenticate/passwordless/authentication-methods)
describes both methods and [documents the magic-link limitation](https://auth0.com/docs/authenticate/passwordless/authentication-methods/email-magic-link).

| Option | Result |
| --- | --- |
| **Auth0 (selected)** | Meets the OIDC, social, passwordless, BFF, PKCE, refresh-rotation, and documented JWKS requirements with a $0 MVP tier. |
| Clerk | Rejected. It is a capable managed identity product, but adopting its frontend-session model would make this small BFF/API contract depend on a second application-specific session abstraction rather than standard OIDC configuration and validation. |
| Self-hosted Keycloak | Rejected. It is portable, but adds patching, availability, email delivery, secret rotation, and incident responsibility before the product has an MVP. |
| Direct Google/Apple/email integrations | Rejected. It duplicates account-linking, token validation, lifecycle, and abuse-control work in the product. |

Passkeys are deliberately **later/optional**. They may be enabled only after
the account-linking and recovery UX has been reviewed; they are not a condition
for initial release.

## Registrations and exact allowed URLs

The values below are allowlists, not URL patterns. Do not add wildcard Vercel,
Railway, preview, custom-scheme, localhost, or arbitrary `returnTo` entries.

| Registration | Development callback / logout | Production callback / logout |
| --- | --- | --- |
| `runs-free-web-bff` (confidential Regular Web Application) | `http://localhost:5173/api/v1/auth/callback` / `http://localhost:5173/` | `https://holistic-runner-app-production.up.railway.app/api/v1/auth/callback` / `https://run.the-dreamshunter-runs-free.com/` |
| `runs-free-capacitor` (public Native Application, future) | `https://dev.run.the-dreamshunter-runs-free.com/mobile/auth/callback` / `https://dev.run.the-dreamshunter-runs-free.com/mobile/logout` | `https://run.the-dreamshunter-runs-free.com/mobile/auth/callback` / `https://run.the-dreamshunter-runs-free.com/mobile/logout` |

The native development subdomain must be provisioned with HTTPS plus Android
`assetlinks.json` and iOS `apple-app-site-association` before device testing.
It is not a substitute for a custom URI scheme. Claimed HTTPS callbacks are
Universal Links on iOS and App Links on Android, preventing another app from
claiming the authorization response. [Auth0's native-app guidance](https://auth0.com/docs/secure/security-guidance/measures-against-app-impersonation)
and [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252) support this
design.

The web callback is deliberately on Railway: Railway exchanges the code and
then redirects the browser to the Vercel origin. In local development, the
browser sees the Vite proxy response on `localhost:5173`, so that same origin
owns the development cookie. In production the Railway host owns the cookie.

`run.the-dreamshunter-runs-free.com` is the authoritative browser origin. The
current Vercel "production" deployment being a preview does not add an
allowlist entry: preview aliases must not receive production login callbacks.
If the canonical frontend or Railway host changes, changing this table, the
Auth0 allowlists, CORS, and deployment variables is one atomic release task.

Before iOS distribution, enable Sign in with Apple in the Apple Developer
account, associate the relevant App ID with a Services ID for web login, and
register the precise domains and return URLs. Apple requires a Services ID and
registered absolute HTTPS return URL for a web flow; see [Apple's configuration
guide](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple?changes=_5).

## Web session and API contract

1. Railway initiates Authorization Code flow, creates a single-use `state`
   record bound to the pre-authentication browser session and intended route,
   and sends `nonce` for OIDC ID-token validation.
2. The callback accepts only the exact registered URL, consumes and validates
   `state` once, exchanges the code confidentially, validates the ID token, and
   creates a new application session. Never reuse the pre-login session ID.
3. Provider access/refresh tokens stay encrypted at rest in Railway's session
   store (or an encrypted server-side credential store). They never appear in
   JavaScript, localStorage, sessionStorage, URLs, analytics, logs, error
   bodies, or a browser cookie.
4. Railway sets `__Host-runsfree_session` with `Secure`, `HttpOnly`, `Path=/`,
   no `Domain`, and `SameSite=None` in production because the Vercel and
   Railway sites are cross-origin. Development may use `SameSite=Lax` on its
   single `localhost:5173` browser origin. Cookie deletion mirrors these exact
   attributes.
5. Idle expiry is 30 minutes; absolute expiry is 12 hours. Renewal rotates the
   application session identifier, preserves neither the old ID nor provider
   token in the browser, and cannot extend past absolute expiry without a new
   authorization transaction.
6. Every unsafe Railway API request requires an Origin check equal to
   `https://run.the-dreamshunter-runs-free.com` (or local origin in
   development) **and** a session-bound CSRF token in a custom request header.
   The token is fetched only over credentialed HTTPS and retained in memory;
   it is not an access or refresh token.
7. `POST /api/v1/auth/logout` invalidates the current application session,
   clears its cookie, revokes its provider refresh-token grant when one exists,
   and redirects only to the registered logout URL. "Log out all devices"
   revokes every application session and every recorded refresh-token grant
   for that user. Auth0 distinguishes application and provider session layers;
   clearing the application cookie is not by itself a provider logout. See
   [How Logout Works](https://auth0.com/docs/authenticate/login/logout).

The Vercel application must call Railway with `credentials: "include"`.
Railway must return `Access-Control-Allow-Origin` only for the exact Vercel
origin above, `Access-Control-Allow-Credentials: true`, a minimal method/header
allowlist, and `Vary: Origin`; `*` is forbidden. CORS is not authentication or
CSRF protection, hence the separate Origin and CSRF checks.

## Native contract

The Capacitor app opens the operating-system browser, not a webview, sends a
high-entropy verifier/challenge using PKCE `S256`, validates `state` and OIDC
`nonce`, and receives only the claimed HTTPS callback. A public native client
has **no client secret** and none may be bundled in the app.

Access and rotating refresh tokens are stored only in OS-backed secure storage
(Keychain/Keystore). Request `offline_access` only when native refresh is
implemented; enable expiring refresh-token rotation and revoke on logout or
all-session revocation. Auth0 documents rotation/reuse detection and its use
with Authorization Code + PKCE [here](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation).

## Token validation and tenancy

Every Railway API authentication middleware validates tokens independently:

- use only the configured HTTPS issuer/discovery document and expected Runs
  Free API audience;
- require a supported asymmetric signature algorithm and validate signature,
  `iss`, `aud`, `exp`, `nbf` when present, and a maximum 60-second clock skew;
- obtain signing keys from discovery/JWKS, cache them for 5–10 minutes, refetch
  once on an unknown `kid`, and rate-limit cache-miss refetches for key
  rotation; never pin one key indefinitely;
- reject all validation failure uniformly as `401` without revealing whether
  an issuer, audience, key, expiry, or user caused it;
- validate OIDC `nonce` at the authorization client and `state` exactly once
  at the callback; API bearer-token validation is not a substitute for either.

Auth0's [access-token validation](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens)
and [JWKS caching guidance](https://auth0.com/docs/secure/tokens/json-web-tokens/json-web-key-sets)
are the implementation references.

An identity is unique by `(issuer, subject)`, never email. A first login whose
pair is unknown creates a pending/new identity subject to the registration
gate. An identity with the same email as an existing account is **not** merged
or linked. Linking requires the authenticated existing user, an independently
authenticated new identity, explicit confirmation, and an auditable server-side
record; unlinking requires a remaining recovery method.

## Threat-model checkpoint

| Threat | Required control |
| --- | --- |
| Redirect allowlist or open redirect | Exact Auth0 callback/logout lists; server-side fixed post-login destinations; never trust browser `returnTo`; reject unrecognized Origin. |
| CSRF | Credentialed CORS allowlist, Origin validation, and session-bound CSRF header on every unsafe request. |
| Code interception or replay | Confidential web exchange; native PKCE S256; one-use, expiring state; callback code exchange only over HTTPS. |
| Callback/state replay | Consume the state record atomically before session issuance; bind it to client, browser session, redirect URI, and expiry. |
| Token leakage | BFF for web; no storage-token APIs in browser; `HttpOnly` host-only cookie; redacted logs; no token-bearing URLs. |
| Account enumeration | Identical sign-in/recovery responses, rate limits, abuse telemetry, and no statement that an email/account exists. |
| Cross-account linking | `(iss, sub)` only; never auto-link by email; dual proof plus explicit confirmation and audit log. |

## Registration gate and external integrations

New-account creation is disabled by default. The Auth0 post-login action (or
the BFF immediately after verified login) permits only founder identities from
an explicit, server-managed allowlist while migration/isolation is tested. It
returns a generic pending-access result for everyone else; enabling public
registration is an audited feature-flag change, not a dashboard toggle.

Strava, Garmin, Withings, COROS, OpenWearables, and similar providers are
post-login **training-data integrations**. Their OAuth grants attach to the
currently authenticated Runs Free user; no external training provider is an
identity provider or an alternative way to access Runs Free.

## Configuration and deployment contract

Do not commit these values or secrets. Railway owns server-only values; Vercel
receives only the public API base. The future implementation must make all
required variables fail closed when production authentication is enabled.

| Owner | Variable | Required value / purpose |
| --- | --- | --- |
| Railway | `AUTH_ENABLED` | Explicit production gate; only `true` enables auth middleware. |
| Railway | `AUTH_ISSUER_URL` / `AUTH_DISCOVERY_URL` | Auth0 custom-domain issuer and discovery endpoint. |
| Railway | `AUTH_AUDIENCE` | Runs Free API identifier. |
| Railway | `AUTH_WEB_CLIENT_ID` / `AUTH_WEB_CLIENT_SECRET` | Confidential BFF registration only. |
| Railway | `AUTH_NATIVE_CLIENT_ID` | Public native registration ID; no native secret exists. |
| Railway | `AUTH_WEB_CALLBACK_URL` / `AUTH_WEB_LOGOUT_URL` | Exact Railway callback and Vercel logout URLs in this ADR. |
| Railway | `AUTH_ALLOWED_ORIGINS` | Exact frontend origin(s), never `*`; production value is `https://run.the-dreamshunter-runs-free.com`. |
| Railway | `AUTH_SESSION_KEY_CURRENT` / `AUTH_SESSION_KEY_PREVIOUS` | Rotatable cookie/session encryption or signing keys. |
| Railway | `AUTH_SESSION_IDLE_SECONDS` / `AUTH_SESSION_ABSOLUTE_SECONDS` | `1800` / `43200` unless a later ADR changes them. |
| Railway | `AUTH_REGISTRATION_MODE` / `AUTH_FOUNDER_ALLOWLIST` | `founders_only` and a server-only allowlist until the registration gate opens. |
| Vercel | `VITE_API_BASE` | `https://holistic-runner-app-production.up.railway.app`; no auth secret or provider token. |
| Native CI | `AUTH_NATIVE_CALLBACK_URL` / `AUTH_NATIVE_LOGOUT_URL` | Exact claimed-HTTPS URL for the selected dev or production build. |

Railway terminates TLS and must forward/recognize the original HTTPS protocol
correctly before setting a Secure cookie. Vercel serves static browser code;
it must never receive BFF secrets. A Railway API on a distinct origin means
there is no same-site cookie shortcut: production CORS, cookie attributes,
credentialed fetch, CSRF checks, Auth0 callbacks, and Vercel's `VITE_API_BASE`
must be deployed together and tested with the canonical custom domain.

## Authorization Authority

Auth0 is the OAuth/OIDC identity provider and authorization server. 
Runs Free is the authoritative application authorization service. 
Auth0 authenticates principals and issues credentials; Railway maps (issuer, subject) to the internal user UUID and enforces roles, entitlements, ownership, publication and resource-level access from the Runs Free database.

## Verification before implementation begins

1. Configure a development Auth0 tenant with the development URL pair and
   confirm Google, email OTP, and web-only magic link.
2. Before iOS release, configure Apple App ID/Services ID, the native claimed
   HTTPS files, and test the system-browser PKCE callback on iOS and Android.
3. Test callback state replay, wrong issuer/audience, expired token, unknown
   `kid`, token-family reuse, cross-origin request without CSRF, and a
   same-email/different-subject login.
4. Test current-session logout and all-session revocation from two sessions.
5. In a production-like Vercel-to-Railway deployment, confirm the Railway
   cookie is sent only with credentialed requests from the canonical Vercel
   origin and that preview aliases cannot complete production authentication.
