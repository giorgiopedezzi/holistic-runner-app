// Deliberately reduces Auth0's internal connection names to a tiny UI-safe
// vocabulary. Unknown or legacy values are not exposed.
export type AuthenticationMethod = "google" | "email";

export function normalizeAuthenticationMethod(provider: string | null): AuthenticationMethod | null {
  if (provider === "google-oauth2") return "google";
  if (provider === "email") return "email";
  return null;
}
