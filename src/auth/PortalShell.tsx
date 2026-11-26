import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

/** Shared header + layout for the four role portals. */
export default function PortalShell({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  const { user, role, roleError, signOutEverywhere } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOutEverywhere();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="no-underline">
            <span className="text-lg font-light tracking-tighter text-neutral-900">
              KWAMAIKO<span className="font-black">NYAMA</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            {role && (
              <span className="bg-neutral-900 px-2 py-1 text-[0.6rem] font-bold uppercase tracking-widest text-[#ffe500]">
                {role}
              </span>
            )}
            <span className="hidden text-xs text-neutral-500 sm:inline">
              {user?.email}
            </span>
            <button
              onClick={handleSignOut}
              className="cursor-pointer border border-neutral-300 px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-600 transition-colors hover:border-neutral-900 hover:text-neutral-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
          {kicker}
        </p>
        <h1 className="mb-6 text-2xl font-light tracking-tighter text-neutral-900">
          {title}
        </h1>
        {roleError && (
          <div className="mb-6 border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
            <strong>Limited mode.</strong> {roleError} Some panels may be empty until this is
            resolved — this is a backend permission problem, not an account problem.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

export function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 border border-neutral-200 bg-white p-5">
      <h2 className="mb-4 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-neutral-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-xs text-neutral-400">{text}</p>;
}

export const portalErrorCls =
  "mb-6 border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700";

export const thCls =
  "border-b border-neutral-200 px-2 py-2 text-left text-[0.6rem] font-bold uppercase tracking-widest text-neutral-400";

export const tdCls = "border-b border-neutral-100 px-2 py-2 text-xs text-neutral-700";

export const smallBtnCls =
  "cursor-pointer border border-neutral-300 px-2 py-1 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-600 transition-colors hover:border-neutral-900 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50";
