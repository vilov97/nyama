import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = {
  kicker: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
};

/** Shared centered card layout for login / signup / recovery / MFA screens. */
export default function AuthLayout({ kicker, title, subtitle, children }: Props) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/" className="no-underline">
          <span className="text-xl font-light tracking-tighter text-neutral-900">
            KWAMAIKO<span className="font-black">NYAMA</span>
          </span>
        </Link>
        <Link
          to="/"
          className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500 no-underline hover:text-neutral-900"
        >
          ← Home
        </Link>
      </div>
      <div className="mx-auto max-w-md px-4 pb-16 pt-8">
        <p className="mb-2 text-center text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
          {kicker}
        </p>
        <h1 className="mb-2 text-center text-2xl font-light tracking-tighter text-neutral-900">
          {title}
        </h1>
        {subtitle && (
          <p className="mb-8 text-center text-xs leading-relaxed text-neutral-500">
            {subtitle}
          </p>
        )}
        <div className="border border-neutral-200 bg-white p-6 shadow-sm md:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}

export const inputCls =
  "w-full border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-900";

export const labelCls =
  "mb-1.5 block text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-500";

export const primaryBtnCls =
  "w-full cursor-pointer bg-[#ffe500] px-5 py-3 text-xs font-bold uppercase tracking-wider text-neutral-900 transition-all hover:bg-neutral-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

export const errorBoxCls =
  "mb-4 border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700";

export const infoBoxCls =
  "mb-4 border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs leading-relaxed text-neutral-600";
