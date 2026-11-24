import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const portals = [
  {
    title: "Manager",
    subtitle: "Command Center",
    tagline: "Kitchen · Riders · Routes",
    href: "/manager",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    title: "Rider",
    subtitle: "Field Interface",
    tagline: "Runs · Navigate · Deliver",
    href: "/ride",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
  },
  {
    title: "Customer",
    subtitle: "Online Shop",
    tagline: "Order · Track · Enjoy",
    href: "/app",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
    ),
  },
];

export default function Portals() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("opacity-100", "translate-y-0");
          el.classList.remove("opacity-0", "translate-y-6");
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="border-b border-neutral-100 bg-neutral-50">
      <div
        ref={ref}
        className="mx-auto max-w-5xl px-4 py-16 opacity-0 transition-all duration-700 ease-out md:py-20"
      >
        <span className="mb-4 block text-center text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
          Team Access
        </span>
        <h2 className="mb-12 text-center text-2xl font-light tracking-tighter md:text-3xl">
          Staff Portals
        </h2>

        <div className="mx-auto grid max-w-2xl gap-4 md:grid-cols-3">
          {portals.map((portal) => (
            <Link
              key={portal.title}
              to={portal.href}
              className="group block border border-neutral-200 bg-white px-6 py-8 text-center no-underline transition-all hover:border-[#ffe500] hover:bg-[#fffdf0]"
            >
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center bg-neutral-100 text-neutral-500 transition-colors group-hover:bg-[#ffe500] group-hover:text-neutral-900">
                {portal.icon}
              </div>
              <p className="mb-1 text-sm font-bold text-neutral-900">
                {portal.title}
              </p>
              <p className="mb-1 text-[0.6rem] font-mono text-neutral-400">
                {portal.subtitle}
              </p>
              <p className="text-[0.55rem] text-neutral-300">{portal.tagline}</p>
            </Link>
          ))}
        </div>

        <p className="mt-8 text-center text-[0.6rem] text-neutral-400">
          Staff sign in with provisioned accounts · Customers can{" "}
          <Link to="/signup" className="underline hover:text-neutral-900">
            create an account
          </Link>
        </p>
      </div>
    </section>
  );
}
