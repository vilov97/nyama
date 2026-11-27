import type { AppRole } from "../lib/supabase";

/**
 * Pure role check used by RequireRole route guards.
 * UX-ONLY: every query is re-authorized server-side by Postgres RLS
 * (audit §5.5). Covered by roles.test.ts.
 */
export function canAccess(
  role: AppRole | null | undefined,
  allow: readonly AppRole[]
): boolean {
  if (!role) return false;
  return allow.includes(role);
}

/**
 * Does this account owe a second factor before it may open a staff dashboard?
 *
 * Managers and admins do. The single exception is a manager whose account
 * carries `app_metadata.mfa_exempt === true`: a shared test login nobody can
 * hold an authenticator for. Three limits keep that exception narrow:
 *   - app_metadata is written server-side only and signed into the JWT, so a
 *     user cannot grant the flag to themselves;
 *   - the value must be the boolean `true`, not anything truthy;
 *   - an admin is never exempt, whatever the flag says.
 */
export function staffMfaRequired(
  role: AppRole | null | undefined,
  appMetadata?: Record<string, unknown> | null
): boolean {
  if (role === "admin") return true;
  if (role === "manager") return appMetadata?.mfa_exempt !== true;
  return false;
}

/** Post-login landing page per role (audit §6.2). */
export function homeForRole(role: AppRole | null | undefined): string {
  switch (role) {
    case "customer":
      return "/app";
    case "rider":
      return "/ride";
    case "kitchen":
      return "/kitchen";
    case "manager":
      return "/manager";
    case "admin":
      return "/admin";
    default:
      return "/login";
  }
}
