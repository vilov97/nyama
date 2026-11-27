import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { AppRole } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { canAccess } from "./roles";

/** Any authenticated user. Redirects to /login otherwise (audit T-SEC-01). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { configured, user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <AuthLoading />;
  if (!configured || !user) {
    return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  }
  return <>{children}</>;
}

type RequireRoleProps = { allow: readonly AppRole[]; children: ReactNode };

/**
 * Role-gated route. Redirects unauthenticated users to /login, staff without
 * MFA to /mfa-enroll, and wrong-role users to /403.
 * UX-ONLY — RLS enforces the same rules server-side (audit §5.5).
 */
export function RequireRole({ allow, children }: RequireRoleProps) {
  const { configured, user, role, mfaRequired, mfaStepUpRequired, loading } = useAuth();
  if (loading) return <AuthLoading />;
  if (!configured || !user) return <Navigate to="/login" replace />;
  // Enrolment and step-up both live on /mfa-enroll: the one page that handles
  // "you have no factor" and "your factor is unused in this session".
  if (mfaRequired || mfaStepUpRequired) return <Navigate to="/mfa-enroll" replace />;
  if (!canAccess(role, allow)) return <Navigate to="/403" replace />;
  return <>{children}</>;
}

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">
        Checking session…
      </p>
    </div>
  );
}
