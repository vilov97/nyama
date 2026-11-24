import { useEffect, useRef } from "react";

const schedule = [
  { day: "Monday — Friday", hours: "7:00 AM — 6:00 PM" },
  { day: "Saturday", hours: "7:00 AM — 4:00 PM" },
  { day: "Sunday", hours: "8:00 AM — 2:00 PM" },
];

export default function HoursAbout() {
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
    <section id="hours" className="border-b border-neutral-100">
      <div
        ref={ref}
        className="mx-auto max-w-5xl px-4 py-16 opacity-0 transition-all duration-700 ease-out md:py-20"
      >
        <div className="grid gap-12 md:grid-cols-2">
          {/* Hours */}
          <div>
            <span className="mb-4 block text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
              Operating Hours
            </span>
            <h2 className="mb-8 text-2xl font-light tracking-tighter md:text-3xl">
              When We Deliver
            </h2>

            <div className="mb-6 space-y-3">
              {schedule.map((s) => (
                <div
                  key={s.day}
                  className="flex items-center justify-between border-b border-neutral-100 pb-3"
                >
                  <span className="text-sm font-medium">{s.day}</span>
                  <span className="text-sm text-neutral-500">{s.hours}</span>
                </div>
              ))}
            </div>

            <div className="space-y-4 bg-neutral-50 p-5">
              <div>
                <p className="mb-1 text-xs font-bold text-neutral-900">
                  Same-Day Delivery Cutoff:
                </p>
                <p className="text-xs leading-relaxed text-neutral-500">
                  Orders placed before 4:00 PM are delivered same day. Orders
                  after 4:00 PM are delivered the next morning.
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-bold text-neutral-900">
                  Next-Day Time Windows:
                </p>
                <p className="text-xs leading-relaxed text-neutral-500">
                  8:00 AM — 10:00 AM · 10:00 AM — 12:00 PM · 12:00 PM — 2:00 PM
                </p>
              </div>
            </div>
          </div>

          {/* About */}
          <div id="about">
            <span className="mb-4 block text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
              About Us
            </span>
            <h2 className="mb-8 text-2xl font-light tracking-tighter md:text-3xl">
              The Kwamaiko Story
            </h2>

            <div className="space-y-4 text-sm leading-relaxed text-neutral-600">
              <div className="flex gap-4">
                <div className="hidden shrink-0 md:block">
                  <div className="flex h-12 w-12 items-center justify-center bg-[#ffe500] text-lg font-bold">
                    K
                  </div>
                </div>
                <p>
                  Kwamaiko Nyama is a Nairobi-based butchery and delivery
                  service specialising in premium goat meat, beef, and chicken.
                  We source from trusted local farmers and deliver fresh cuts
                  directly to your doorstep.
                </p>
              </div>
              <p>
                Whether you are hosting a weekend choma, stocking your
                restaurant, or just craving authentic Kenyan nyama, we bring the
                butchery to you. No more traffic, no more queues — just fresh
                meat, cut to your preference, delivered on time.
              </p>
              <div className="border-l-4 border-[#ffe500] bg-neutral-50 p-4">
                <p className="text-xs font-medium text-neutral-900">
                  "Quality. Freshness. Convenience. That's the Kwamaiko promise."
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
