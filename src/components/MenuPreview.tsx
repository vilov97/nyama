import { useEffect, useRef } from "react";

const items = [
  {
    name: "Goat Meat",
    description: "Choma Cut",
    price: 800,
    unit: "kg",
    popular: true,
  },
  {
    name: "Beef",
    description: "Choma Cut",
    price: 600,
    unit: "kg",
    popular: false,
  },
  {
    name: "Goat Ribs",
    description: "Full Rack",
    price: 900,
    unit: "kg",
    popular: false,
  },
  {
    name: "Mixed Grill",
    description: "Goat + Beef",
    price: 750,
    unit: "kg",
    popular: false,
  },
  {
    name: "Beef Strips",
    description: "Strips Cut",
    price: 650,
    unit: "kg",
    popular: false,
  },
  {
    name: "Chicken",
    description: "Kienyeji · Whole",
    price: 700,
    unit: "pc",
    popular: false,
  },
  {
    name: "Goat Soup Pack",
    description: "Mifupa · Soup Cut",
    price: 400,
    unit: "kg",
    popular: false,
  },
  {
    name: "Whole Goat",
    description: "Mbuzi Mzima",
    price: 800,
    unit: "kg",
    popular: false,
  },
];

export default function MenuPreview() {
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
    <section id="menu" className="border-b border-neutral-100">
      <div
        ref={ref}
        className="mx-auto max-w-5xl px-4 py-16 opacity-0 transition-all duration-700 ease-out md:py-20"
      >
        <span className="mb-4 block text-center text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
          Our Cuts
        </span>
        <h2 className="mb-12 text-center text-2xl font-light tracking-tighter md:text-3xl">
          Premium Selection
        </h2>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {items.map((item) => (
            <div
              key={item.name}
              className="group relative border border-neutral-200 p-4 text-center transition-all hover:border-[#ffe500]"
            >
              {item.popular && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#ffe500] px-2 py-0.5 text-[0.5rem] font-bold uppercase tracking-widest">
                  Popular
                </span>
              )}
              <p className="text-sm font-bold">{item.name}</p>
              <p className="text-[0.6rem] text-neutral-400">{item.description}</p>
              <p className="mt-2 text-sm font-bold">
                KSh {item.price.toLocaleString()}
                <span className="text-[0.55rem] font-normal text-neutral-400">
                  /{item.unit}
                </span>
              </p>
              <button className="mt-3 w-full cursor-pointer border border-neutral-200 py-1.5 text-[0.55rem] font-bold uppercase tracking-wider text-neutral-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-[#ffe500] hover:text-neutral-900">
                Add to Order
              </button>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <a
            href="#"
            className="inline-block border-2 border-neutral-900 px-8 py-3 text-xs font-bold uppercase tracking-wider text-neutral-900 no-underline transition-all hover:bg-neutral-900 hover:text-white"
          >
            View Full Menu
          </a>
        </div>
      </div>
    </section>
  );
}
