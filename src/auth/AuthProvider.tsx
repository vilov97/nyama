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
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  const syncProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setRole(null);
      setMfaRequired(false);
      return;
    }
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      const r = (data?.role as AppRole | undefined) ?? "customer";
      setRole(r);
      if (r === "manager" || r === "admin") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const verified = factors?.totp?.some((f) => f.status === "verified");
        setMfaRequired(!verified);
      } else {
        setMfaRequired(false);
      }
    } catch {
      setRole(null);
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
        await syncProfile(data.session?.user?.id);
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
        await syncProfile(next?.user?.id);
      }
    );
    void init();
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [syncProfile]);

  const refreshProfile = useCallback(async () => {
    await syncProfile(session?.user?.id);
  }, [session?.user?.id, syncProfile]);

  const signOutEverywhere = useCallback(async () => {
    if (isSupabaseConfigured) {
      await getSupabase().auth.signOut({ scope: "global" });
    }
    setSession(null);
    setRole(null);
    setMfaRequired(false);
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        configured: isSupabaseConfigured,
        user: session?.user ?? null,
        session,
        role,
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
