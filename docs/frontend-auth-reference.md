# Frontend Auth Reference — React + Supabase (copy-paste starter)

Companion to `docs/AUTH_RBAC_SECURITY_AUDIT.md` (§5–§7) and `docs/supabase-auth-schema.sql`.
Target stack: the repo's existing React 19 + Vite + Tailwind SPA, Supabase Auth (Path 1, audit §6.3).
All UI guards below are **UX only** — Postgres RLS is the real enforcement (§5.5).

> Install: `npm i @supabase/supabase-js react-router-dom`
> Env: copy `.env.example` (below) to `.env`. The `VITE_SUPABASE_ANON_KEY` is
> public-by-design; the **service-role key must never appear in this repo**.

---

## 1. Supabase client — `src/lib/supabase.ts`

```ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env).");
}

export const supabase = createClient(url, anon, {
  auth: {
    flowType: "pkce",          // §6.3: PKCE for public clients
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export type AppRole = "customer" | "rider" | "manager" | "admin";
```

## 2. Auth provider — `src/auth/AuthProvider.tsx`

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type AppRole } from "../lib/supabase";

type AuthState = {
  user: User | null;
  session: Session | null;
  role: AppRole | null;      // from profiles (RLS: users read own row)
  mfaRequired: boolean;      // manager/admin without verified MFA
  loading: boolean;
  signOutEverywhere: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      await syncProfile(data.session?.user?.id);
      setLoading(false);
    };
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      await syncProfile(s?.user?.id);
    });
    init();
    return () => sub.subscription.unsubscribe();
  }, []);

  const syncProfile = async (userId?: string) => {
    if (!userId) { setRole(null); setMfaRequired(false); return; }
    const { data } = await supabase
      .from("profiles").select("role").eq("id", userId).single();
    const r = (data?.role as AppRole) ?? "customer";
    setRole(r);
    if (r === "manager" || r === "admin") {
      // Enforce MFA: staff must have a verified factor (audit F-08).
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp?.some((f) => f.status === "verified");
      setMfaRequired(!verified);
    } else setMfaRequired(false);
  };

  const signOutEverywhere = async () => {
    await supabase.auth.signOut({ scope: "global" }); // revoke refresh tokens
    setSession(null); setRole(null);
  };

  return (
    <AuthCtx.Provider value={{
      user: session?.user ?? null, session, role, mfaRequired, loading,
      signOutEverywhere,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}
```

## 3. Route guards — `src/auth/RequireRole.tsx`

```tsx
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import type { AppRole } from "../lib/supabase";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <p>Loading…</p>;
  return user ? <>{children}</> : <Navigate to="/login" state={{ from: loc }} replace />;
}

export function RequireRole({ allow, children }: { allow: AppRole[]; children: ReactNode }) {
  const { user, role, mfaRequired, loading } = useAuth();
  if (loading) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (mfaRequired) return <Navigate to="/mfa-enroll" replace />; // F-08 gate
  // UX-only: RLS re-decides every query server-side (audit §5.5).
  if (!role || !allow.includes(role)) return <Navigate to="/403" replace />;
  return <>{children}</>;
}

// Router sketch:
// /login, /403 public; /app/* RequireAuth;
// /manager/* RequireRole allow={["manager","admin"]};
// /ride/*   RequireRole allow={["rider"]};
// /admin/*  RequireRole allow={["admin"]};
```

## 4. Login + MFA snippets

```tsx
// Login (email+password). Phone-OTP variant: supabase.auth.signInWithOtp({ phone }).
// Always show a GENERIC error (anti-enumeration, audit §6.4).
const { error } = await supabase.auth.signInWithPassword({ email, password });
if (error) setFormError("Invalid credentials. Please try again.");

// List + challenge a TOTP factor after password login (staff):
const { data } = await supabase.auth.mfa.listFactors();
const factorId = data?.totp[0]?.id;
if (factorId) {
  const { data: ch, error } = await supabase.auth.mfa.challenge({ factorId });
  if (!error) {
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId, challengeId: ch.id, code: totpCode.trim(),
    });
    if (vErr) setFormError("Invalid authentication code.");
  }
}

// TOTP enrollment (first login for manager/admin):
const { data: enroll, error: eErr } =
  await supabase.auth.mfa.enroll({ factorType: "totp" });
// Render enroll.totp.qr_code (SVG) + enroll.totp.secret for manual entry,
// then: await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
```

## 5. Supabase Auth settings checklist (Dashboard → Authentication)

- [ ] JWT expiry: **3600s**; refresh rotation ON (default in new projects — verify).
- [ ] **Leaked Password Protection: ON** (HaveIBeenPwned check, audit §6.4).
- [ ] Minimum password length 8 (default 6 is too low); managers/admins 12+ (enforce client-side + edge check).
- [ ] Confirm email ON (at least for rider/manager/admin invites); double-confirm email changes ON.
- [ ] **CAPTCHA ON** with Cloudflare Turnstile site/secret keys (login, signup, recovery, OTP).
- [ ] Rate limits: review `rate_limit_*` (auth) values; set OTP send caps; enable auth log drain.
- [ ] Auth Hook on role change → mirror `profiles.role` into `app_metadata.user_role` (SQL file §7) + revoke sessions on demotion/disable (`auth.admin.signOut`).
- [ ] SMTP: custom sender (`noreply@kwamaiko.co.ke`) + SPF/DKIM/DMARC before launch.
- [ ] Phone (SMS) provider configured only if phone-OTP login ships (Phase 1+); set per-phone daily caps.

## 6. `vercel.json` — TLS + security headers (audit F-05)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(self)" },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        }
      ]
    }
  ]
}
```

> Adjust `connect-src` to your exact Supabase project refs. Re-verify header
> scans (T-SEC-07) after adding analytics, payment, or map SDKs.

## 7. `.env.example` (add at repo root)

```bash
# Public (safe in Vercel + Vite bundle)
VITE_SUPABASE_URL=https://xyzcompany.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_TURNSTILE_SITE_KEY=0x4AAAAAA...

# NEVER in Vite/Vercel-frontend env — edge functions & CI secrets only
# SUPABASE_SERVICE_ROLE_KEY=...
# DARAJA_CONSUMER_KEY=... / DARAJA_CONSUMER_SECRET=...
# TURNSTILE_SECRET_KEY=...
```

## 8. Operational runbooks (one-paragraphers for Phase 2/4)

- **Disable user / ex-staff (T-RBAC-08):** Dashboard → Auth → user → Ban/disable; `update profiles set is_active=false, role='customer'` (admin, logged by trigger); `auth.admin.signOut(userId)` to revoke sessions; verify in `audit_logs`. Target: < 1h from request.
- **Promote to manager/rider:** admin updates `profiles.role` (trigger logs + hook mirrors claim); user re-logs in; MFA enrollment forced on next staff login.
- **Key rotation:** rotate service-role key in Supabase → update edge-function/CI secrets → redeploy → verify audit + callbacks; rotate Turnstile/Daraja on the same calendar (yearly or on incident).
- **Breach response (Kenya DPA 72h):** contain (revoke keys/sessions) → assess scope via `audit_logs` → notify ODPC + subjects within 72h → post-mortem + audit v2.
