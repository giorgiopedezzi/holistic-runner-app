// Thrown when a provider account (identified by the provider's own external
// id, e.g. Withings' `userid` or Strava's `athlete.id`) is already linked to
// a DIFFERENT Runs Free user (HRA-352 AC5). Deliberately carries no
// identifying detail about the other account — callers must render a
// generic, non-enumerating failure, never "linked to user X" or any signal
// that would let a caller probe which accounts are already connected.
export class ProviderAccountConflictError extends Error {
  constructor() {
    super("This provider account is already connected to a different account.");
    this.name = "ProviderAccountConflictError";
  }
}

// Postgres unique_violation.
const UNIQUE_VIOLATION = "23505";

export function isProviderAccountConflict(error: unknown, indexName: string): boolean {
  return (
    typeof error === "object" && error !== null &&
    "code" in error && (error as { code?: string }).code === UNIQUE_VIOLATION &&
    "constraint" in error && (error as { constraint?: string }).constraint === indexName
  );
}
