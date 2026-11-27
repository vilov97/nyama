import { useState } from "react";
import { Link } from "react-router-dom";

const navLinks = [
  { label: "Menu", href: "#menu" },
  { label: "About", href: "#about" },
  { label: "Hours", href: "#hours" },
];

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-neutral-100 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        {/* Logo */}
        <Link to="/" className="select-none no-underline">
          <span className="text-xl font-light tracking-tighter text-neutral-900">
            KWAMAIKO<span className="font-black">NYAMA</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500 no-underline transition-colors hover:text-neutral-900"
            >
              {link.label}
            </a>
          ))}
          <Link
            to="/login"
            className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500 no-underline transition-colors hover:text-neutral-900"
          >
            Sign in
          </Link>
          <Link
            to="/shop"
            className="cursor-pointer bg-[#ffe500] px-5 py-2 text-xs font-bold uppercase tracking-wider text-neutral-900 no-underline transition-all hover:bg-neutral-900 hover:text-white"
          >
            Order Now
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex flex-col gap-1 md:hidden"
          aria-label="Toggle menu"
        >
          <span
            className={`block h-[2px] w-5 bg-neutral-900 transition-transform ${
              mobileOpen ? "translate-y-[6px] rotate-45" : ""
            }`}
          />
          <span
            className={`block h-[2px] w-5 bg-neutral-900 transition-opacity ${
              mobileOpen ? "opacity-0" : ""
            }`}
          />
          <span
            className={`block h-[2px] w-5 bg-neutral-900 transition-transform ${
              mobileOpen ? "-translate-y-[6px] -rotate-45" : ""
            }`}
          />
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-neutral-100 bg-white px-4 pb-6 pt-4 md:hidden">
          <div className="flex flex-col gap-4">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500 no-underline transition-colors hover:text-neutral-900"
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/login"
              onClick={() => setMobileOpen(false)}
              className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500 no-underline transition-colors hover:text-neutral-900"
            >
              Sign in
            </Link>
            <Link
              to="/shop"
              onClick={() => setMobileOpen(false)}
              className="w-full cursor-pointer bg-[#ffe500] px-5 py-3 text-center text-xs font-bold uppercase tracking-wider text-neutral-900 no-underline transition-all hover:bg-neutral-900 hover:text-white"
            >
              Order Now
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
