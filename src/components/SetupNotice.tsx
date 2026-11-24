/**
 * Shown on auth-gated pages when the Supabase backend isn't wired yet
 * (Phase 0 pending — e.g. no free Supabase project slot). The public
 * marketing pages always render; only portals show this notice.
 */
export default function SetupNotice() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="mb-2 text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
        Backend not connected
      </p>
      <h1 className="mb-4 text-2xl font-light tracking-tighter">
        Auth backend pending setup
      </h1>
      <p className="mx-auto mb-6 max-w-md text-sm leading-relaxed text-neutral-500">
        This portal needs <code>VITE_SUPABASE_URL</code> and{" "}
        <code>VITE_SUPABASE_ANON_KEY</code>. Once the Supabase project is
        provisioned and the schema in{" "}
        <code>docs/supabase-auth-schema.sql</code> is applied, this page becomes
        the live login screen. See{" "}
        <code>docs/AUTH_RBAC_SECURITY_AUDIT.md</code> §7 (Phase 0–1).
      </p>
      <a
        href="/"
        className="inline-block bg-[#ffe500] px-8 py-3 text-xs font-bold uppercase tracking-wider text-neutral-900 no-underline transition-all hover:bg-neutral-900 hover:text-white"
      >
        Back to home
      </a>
    </div>
  );
}
