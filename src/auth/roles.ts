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

/** Post-login landing page per role (audit §6.2). */
export function homeForRole(role: AppRole | null | undefined): string {
  switch (role) {
    case "customer":
      return "/app";
    case "rider":
      return "/ride";
    case "manager":
      return "/manager";
    case "admin":
      return "/admin";
    default:
      return "/login";
  }
}
