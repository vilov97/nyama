import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getSupabase, isSupabaseConfigured } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { homeForRole } from "../auth/roles";
import { basketTotal, itemCount, type MenuItem } from "../lib/basket";
import { cart, useCart } from "../lib/cart";
import { ALL, categories, visibleItems } from "../lib/catalogue";
import CartDrawer, { KSH, QtyStepper, Thumb } from "../components/CartDrawer";

/**
 * Public shop: browse by category, fill a cart, then check out.
 *
 * Anyone can browse and build a cart; an account is only needed at checkout.
 * The cart lives in the browser, so it survives the sign-in detour.
 */
export default function ShopPage() {
  const { user, role } = useAuth();
  const lines = useCart();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [category, setCategory] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError("The shop is not connected yet.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await getSupabase()
        .from("menu_items")
        .select("id, name, description, price_ksh, unit, is_available, category, image_url, sort_order");
      if (qErr) throw qErr;
      setMenu((data as MenuItem[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the shop.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cats = useMemo(() => categories(menu), [menu]);
  const items = useMemo(() => visibleItems(menu, category), [menu, category]);
  const units = itemCount(lines);
  const closeCart = useCallback(() => setCartOpen(false), []);

  const railBtn = (active: boolean) =>
    `flex shrink-0 cursor-pointer items-center justify-between gap-3 whitespace-nowrap border px-3 py-2 text-left text-xs font-semibold transition-colors lg:w-full lg:border-0 lg:border-l-2 ${
      active
        ? "border-neutral-900 bg-neutral-900 text-white lg:border-[#ffe500]"
        : "border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900 lg:border-transparent"
    }`;

  return (
    <div className="min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="no-underline">
            <span className="text-lg font-light tracking-tighter text-neutral-900">
              KWAMAIKO<span className="font-black">NYAMA</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            {user ? (
              <Link
                to={role === "customer" ? "/app" : homeForRole(role)}
                className="text-[0.65rem] font-bold uppercase tracking-widest text-neutral-500 no-underline hover:text-neutral-900"
              >
                {role === "customer" ? "My orders" : "Dashboard"}
              </Link>
            ) : (
              <Link
                to="/login"
                className="text-[0.65rem] font-bold uppercase tracking-widest text-neutral-500 no-underline hover:text-neutral-900"
              >
                Sign in
              </Link>
            )}
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="flex cursor-pointer items-center gap-2 border border-neutral-900 bg-neutral-900 px-3 py-2 text-[0.65rem] font-bold uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-neutral-900"
            >
              Cart
              <span className="bg-[#ffe500] px-1.5 py-0.5 tabular-nums text-neutral-900">{units}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6">
        <p className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-400">Shop</p>
        <h1 className="mb-1 text-2xl font-light tracking-tighter text-neutral-900">
          Fresh cuts, <span className="font-black">cut to order</span>
        </h1>
        <p className="mb-6 text-sm text-neutral-500">
          Delivered across Nairobi or collected at the butchery. Morning, afternoon and evening slots.
        </p>

        {error && (
          <div className="mb-6 border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            {error}{" "}
            <button type="button" onClick={() => void load()} className="cursor-pointer font-bold underline">
              Try again
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[190px_1fr]">
          {/* Category rail: a scrolling strip on phones, a sidebar on desktop. */}
          <nav aria-label="Categories" className="lg:sticky lg:top-20 lg:self-start">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:block lg:space-y-px lg:border lg:border-neutral-200 lg:bg-white lg:p-0">
              <button type="button" onClick={() => setCategory(ALL)} className={railBtn(category === ALL)}>
                All cuts
                <span className="font-mono text-[0.65rem] opacity-60">{menu.length}</span>
              </button>
              {cats.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  className={railBtn(category === c.key)}
                >
                  {c.label}
                  <span className="font-mono text-[0.65rem] opacity-60">{c.count}</span>
                </button>
              ))}
            </div>
          </nav>

          <section aria-label="Products">
            {loading ? (
              <p className="py-16 text-center text-xs uppercase tracking-widest text-neutral-400">Loading…</p>
            ) : items.length === 0 ? (
              <p className="border border-neutral-200 bg-white px-4 py-16 text-center text-sm text-neutral-500">
                Nothing here yet.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {items.map((item) => {
                  const line = lines.find((l) => l.menu_item_id === item.id);
                  const soldOut = item.is_available === false;
                  return (
                    <li key={item.id} className="flex flex-col border border-neutral-200 bg-white">
                      <div className="relative">
                        <Thumb
                          src={item.image_url}
                          name={item.name}
                          className={`aspect-square w-full ${soldOut ? "opacity-40 grayscale" : ""}`}
                        />
                        {soldOut && (
                          <span className="absolute left-2 top-2 bg-neutral-900 px-2 py-1 text-[0.55rem] font-bold uppercase tracking-widest text-white">
                            Sold out today
                          </span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col p-3">
                        <h2 className="text-sm font-bold leading-tight text-neutral-900">{item.name}</h2>
                        {item.description && (
                          <p className="mt-0.5 text-[0.7rem] leading-snug text-neutral-500">{item.description}</p>
                        )}
                        <p className="mt-2 text-base font-black tracking-tight tabular-nums text-neutral-900">
                          {KSH(item.price_ksh)}
                          <span className="text-[0.65rem] font-normal text-neutral-500"> /{item.unit}</span>
                        </p>
                        <div className="mt-auto pt-3">
                          {soldOut ? (
                            <p className="py-2 text-center text-[0.6rem] font-bold uppercase tracking-widest text-neutral-400">
                              Back soon
                            </p>
                          ) : line ? (
                            <div className="flex items-center justify-between gap-2">
                              <QtyStepper
                                qty={line.qty}
                                name={item.name}
                                onMinus={() => cart.removeOne(item.id)}
                                onPlus={() => cart.add(item)}
                              />
                              <span className="text-[0.6rem] font-bold uppercase tracking-widest text-green-700">
                                In cart
                              </span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => cart.add(item)}
                              className="w-full cursor-pointer border border-neutral-900 py-2 text-[0.65rem] font-bold uppercase tracking-widest text-neutral-900 transition-colors hover:bg-[#ffe500]"
                            >
                              Add to cart
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </main>

      {/* Always-visible route to checkout once there is something to buy. */}
      {units > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-900 bg-neutral-900">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="cursor-pointer text-left text-white"
            >
              <span className="block text-[0.55rem] font-bold uppercase tracking-[0.15em] text-[#ffe500]">
                {units} {units === 1 ? "item" : "items"} · view cart
              </span>
              <span className="text-lg font-black tracking-tighter tabular-nums">{KSH(basketTotal(lines))}</span>
            </button>
            <Link
              to="/checkout"
              className="bg-[#ffe500] px-5 py-3 text-xs font-bold uppercase tracking-widest text-neutral-900 no-underline hover:bg-white"
            >
              Checkout →
            </Link>
          </div>
        </div>
      )}

      <CartDrawer open={cartOpen} onClose={closeCart} signedIn={Boolean(user)} />
    </div>
  );
}
