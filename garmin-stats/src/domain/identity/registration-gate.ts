/**
 * domain/identity/registration-gate.ts
 * The controlled-registration decision (AC5): an unknown (issuer, subject)
 * creates a new internal user only when this gate allows it. Pure, no I/O —
 * email is used here only to check founder allowlist membership, never as an
 * identity key.
 */

export type RegistrationMode = "founders_only" | "open";

export interface RegistrationGateInput {
  mode: RegistrationMode;
  founderAllowlist: readonly string[];
  email: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isRegistrationAllowed(input: RegistrationGateInput): boolean {
  if (input.mode === "open") return true;
  if (!input.email) return false;
  const candidate = normalizeEmail(input.email);
  return input.founderAllowlist.some(allowed => normalizeEmail(allowed) === candidate);
}
