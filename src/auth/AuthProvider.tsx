import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured, type AppRole } from "../lib/supabase";

type AuthState = {
  /** False until VITE_SUPABASE_* env is wired (Phase 0). Pages degrade gracefully. */
  configured: boolean;
  user: User | null;
  session: Session | null;
  /** UX-only role mirror. Postgres RLS re-authorizes every query (audit §5.5). */
  role: AppRole | null;
  /**
   * Where `role` came from. "jwt" = trusted app_metadata claim (works even when
   * PostgREST is rejecting tokens); "profile" = profiles row; "none" = unknown.
   */
  roleSource: "jwt" | "profile" | "none";
  /**
   * Non-null when the role could not be confirmed. Surfacing this matters: a
   * failed profile read must never silently downgrade an admin to customer.
   */
  roleError: string | null;
  /** True when staff (manager/admin) has no verified TOTP factor (audit F-08). */
  mfaRequired: boolean;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleSource, setRoleSource] = useState<"jwt" | "profile" | "none">("none");
  const [roleError, setRoleError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  const syncProfile = useCallback(async (user: User | undefined) => {
    if (!user) {
      setRole(null);
      setRoleSource("none");
      setRoleError(null);
      setMfaRequired(false);
      return;
    }

    // The app_metadata.user_role claim is set server-side by an admin and is
    // signed into the JWT, so it is safe to trust for UX routing. It also keeps
    // the portal correct when PostgREST cannot read profiles (e.g. a token
    // verification outage), instead of silently demoting the user.
    const jwtRole = (user.app_metadata as { user_role?: AppRole } | undefined)?.user_role;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    let resolved: AppRole | null = null;
    if (!error && data?.role) {
      resolved = data.role as AppRole;
      setRoleSource("profile");
      setRoleError(null);
    } else if (jwtRole) {
      resolved = jwtRole;
      setRoleSource("jwt");
      setRoleError(
        error
          ? `Could not read your profile (${error.message}); using the role from your token instead.`
          : null
      );
    } else {
      setRole(null);
      setRoleSource("none");
      setRoleError(error?.message ?? "Your account has no role assigned yet.");
      setMfaRequired(false);
      return;
    }

    setRole(resolved);

    // Staff must enrol TOTP. A failed listFactors() must not silently clear the
    // requirement, so fall back to "required" when the call itself fails.
    if (resolved === "manager" || resolved === "admin") {
      const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
      if (fErr) {
        setMfaRequired(true);
        return;
      }
      const verified = factors?.totp?.some((f) => f.status === "verified");
      setMfaRequired(!verified);
    } else {
      setMfaRequired(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let mounted = true;
    const init = async () => {
      try {
        const { data } = await getSupabase().auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        await syncProfile(data.session?.user);
      } catch {
        if (mounted) setSession(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    const { data: sub } = getSupabase().auth.onAuthStateChange(
      async (_event, next) => {
        if (!mounted) return;
        setSession(next);
        await syncProfile(next?.user);
      }
    );
    void init();
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [syncProfile]);

  const refreshProfile = useCallback(async () => {
    await syncProfile(session?.user);
  }, [session?.user?.id, syncProfile]);

  const signOutEverywhere = useCallback(async () => {
    if (isSupabaseConfigured) {
      await getSupabase().auth.signOut({ scope: "global" });
    }
    setSession(null);
    setRole(null);
    setRoleSource("none");
    setRoleError(null);
    setMfaRequired(false);
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        configured: isSupabaseConfigured,
        user: session?.user ?? null,
        session,
        role,
        roleSource,
        roleError,
        mfaRequired,
        loading,
        refreshProfile,
        signOutEverywhere,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

// Re-export the User type helper for pages (keeps imports tidy).
export type { User };
