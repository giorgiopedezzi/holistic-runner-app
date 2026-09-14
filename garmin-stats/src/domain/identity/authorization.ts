/**
 * domain/identity/authorization.ts
 * Account-status enforcement + resource ownership. `ownsResource` is
 * deliberately role-blind (AC10): an admin identity gets no special path to
 * another runner's private data through this check — admin-only surfaces, if
 * any are ever built, must be separate operations that never substitute for
 * ownership. Pure, no I/O.
 */
import type { AccountStatus } from "./types.ts";

export function isAccountUsable(status: AccountStatus): boolean {
  return status === "active";
}

export function ownsResource(identityUserId: string, resourceOwnerId: string): boolean {
  return identityUserId === resourceOwnerId;
}
