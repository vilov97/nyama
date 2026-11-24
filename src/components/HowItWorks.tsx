import { useEffect, useRef } from "react";

const steps = [
  {
    number: "01",
    title: "Select Your Cuts",
    description:
      "Choose from our menu of premium goat meat, beef, ribs, whole chicken, and mixed grills.",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
    ),
  },
  {
    number: "02",
    title: "Set Delivery Pin",
    description:
      "Drop a pin on your exact location. Same-day or next-day delivery with time windows.",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    number: "03",
    title: "Receive & Enjoy",
    description:
      "Track your order live. Fresh nyama arrives at your door, ready for the grill.",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
];

export default function HowItWorks() {
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
    <section className="border-b border-neutral-100">
      <div
        ref={ref}
        className="mx-auto max-w-5xl px-4 py-16 opacity-0 transition-all duration-700 ease-out md:py-20"
      >
        <span className="mb-4 block text-center text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
          How It Works
        </span>
        <h2 className="mb-12 text-center text-2xl font-light tracking-tighter md:text-3xl">
          Three Simple Steps
        </h2>

        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group border border-neutral-200 p-6 text-center transition-all hover:border-neutral-900"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center bg-[#ffe500] text-neutral-900 transition-colors group-hover:bg-neutral-900 group-hover:text-[#ffe500]">
                {step.icon}
              </div>
              <div className="mb-3 text-2xl font-bold text-[#ffe500]">
                {step.number}
              </div>
              <h3 className="mb-2 text-sm font-bold">{step.title}</h3>
              <p className="text-xs leading-relaxed text-neutral-500">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
