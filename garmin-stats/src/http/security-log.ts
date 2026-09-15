/**
 * http/security-log.ts
 * HRA-356 AC6/AC7: a single place to (a) redact anything log-worthy before it
 * reaches stdout/Railway's log aggregation, and (b) emit discrete, greppable
 * security events (login/callback failure, replay, session revocation,
 * import/job failure, export/deletion status, registration-gate outcome)
 * without ever including the secret material that triggered them. Plain
 * console.log/error — no logging dependency, matching this backend's
 * zero-runtime-dependency default.
 */

// Order matters: token-shaped patterns first, then key=value pairs that
// might otherwise only partially match once a token substring is already
// replaced.
const SENSITIVE_PATTERNS: [RegExp, string][] = [
  // JWTs / opaque bearer tokens: three dot-separated base64url segments.
  [/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]"],
  // Authorization: Bearer <token> headers embedded in stringified errors.
  [/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]"],
  // Session cookie values (both the __Host- prefixed and local dev names).
  [/((?:__Host-)?runsfree_session=)[^;\s]+/gi, "$1[redacted]"],
  // OAuth/session key=value pairs (query string or urlencoded body dumps).
  [/((?:code|state|nonce|token|secret|client_secret|authorization|password|preauth)=)[^&\s"']+/gi, "$1[redacted]"],
  // Local filesystem paths (Windows absolute paths, POSIX home dirs) can
  // embed the machine's OS account name or an original imported filename —
  // AC6's "private filenames" — surfaced e.g. by a PowerShell bridge error.
  [/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+/g, "[redacted-path]"],
  [/\/(?:home|Users)\/[^\s"']+/g, "[redacted-path]"],
];

const MAX_LOG_LENGTH = 2000;

// Best-effort text redaction for anything that might land in a log line —
// never a substitute for not logging the secret in the first place, but a
// safety net for error messages/response bodies whose exact shape this
// module doesn't control.
export function redact(input: unknown): string {
  const text = input instanceof Error
    ? `${input.name}: ${input.message}`
    : typeof input === "string" ? input : JSON.stringify(input);
  let out = text;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) out = out.replace(pattern, replacement);
  return out.length > MAX_LOG_LENGTH ? `${out.slice(0, MAX_LOG_LENGTH)}…[truncated]` : out;
}

export type SecurityEvent =
  | "auth.login.unavailable"
  | "auth.callback.failed"
  | "auth.callback.replay"
  | "auth.session.revoked"
  | "auth.session.revoked_others"
  | "auth.registration.denied"
  | "import.job.failed"
  | "account.export.created"
  | "account.export.downloaded"
  | "account.deletion.requested"
  | "api.error.unhandled";

// One redacted, single-line JSON record per event (AC7's "useful aggregate
// events... without exposing secrets") — deliberately never the raw
// request/response/error object, only pre-redacted scalar detail fields.
export function logSecurityEvent(event: SecurityEvent, details: Record<string, unknown> = {}): void {
  const safeDetails: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    safeDetails[key] = typeof value === "string" ? redact(value) : value;
  }
  console.log(JSON.stringify({ type: "security_event", event, at: new Date().toISOString(), ...safeDetails }));
}
