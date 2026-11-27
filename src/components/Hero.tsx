import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

export default function Hero() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
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
    <section className="relative overflow-hidden border-b border-neutral-100">
      {/* Background texture */}
      <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,229,0,0.03)_50%,transparent_75%,rgba(255,229,0,0.02)_100%)] bg-[length:20px_20px]" />

      <div
        ref={sectionRef}
        className="mx-auto max-w-5xl px-4 pb-24 pt-16 text-center opacity-0 transition-all duration-700 ease-out md:pb-32 md:pt-24"
      >
        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-1.5 shadow-sm">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-500">
            Authentic Kenyan Nyama Choma
          </span>
        </div>

        {/* Headline */}
        <h1 className="mb-6 text-4xl font-light leading-none tracking-tighter md:text-6xl lg:text-7xl">
          Fresh Meat,
          <br />
          Delivered to
          <br />
          <span className="relative inline-block">
            <span className="relative z-10">Your Door</span>
            <span className="absolute bottom-1 left-0 right-0 z-0 h-3 bg-[#ffe500]/40" />
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mb-10 max-w-md text-sm leading-relaxed text-neutral-500">
          Premium goat, beef, and chicken cuts from our butchery. Order online
          and get it delivered same-day or scheduled for tomorrow.
        </p>

        {/* CTAs */}
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/shop"
            className="inline-block bg-[#ffe500] px-8 py-3.5 text-xs font-bold uppercase tracking-wider text-neutral-900 no-underline transition-all hover:bg-neutral-900 hover:text-white"
          >
            Order Now
          </Link>
          <a
            href="#about"
            className="inline-block border-2 border-neutral-900 px-8 py-3.5 text-xs font-bold uppercase tracking-wider text-neutral-900 no-underline transition-all hover:bg-neutral-900 hover:text-white"
          >
            Learn More
          </a>
        </div>

        {/* Stats row */}
        <div className="mt-16 grid grid-cols-3 gap-4 border-t border-neutral-100 pt-8">
          <div>
            <p className="text-2xl font-bold tracking-tighter">50+</p>
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-neutral-400">
              Farmers
            </p>
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tighter">2K+</p>
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-neutral-400">
              Deliveries
            </p>
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tighter">4.9★</p>
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-neutral-400">
              Rating
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
