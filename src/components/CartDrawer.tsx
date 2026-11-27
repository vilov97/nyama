import { useEffect } from "react";
import { Link } from "react-router-dom";
import { basketTotal, itemCount, MAX_QTY_PER_LINE, type BasketLine } from "../lib/basket";
import { cart, useCart } from "../lib/cart";

export const KSH = (n: number) => `KSh ${n.toLocaleString("en-KE")}`;

/** − qty + control shared by the shop cards, the cart drawer and checkout. */
export function QtyStepper({
  qty,
  name,
  onMinus,
  onPlus,
  size = "md",
}: {
  qty: number;
  name: string;
  onMinus: () => void;
  onPlus: () => void;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-7 w-7 text-sm" : "h-9 w-9 text-base";
  return (
    <div className="inline-flex items-center border border-neutral-900">
      <button
        type="button"
        onClick={onMinus}
        aria-label={`Remove one ${name}`}
        className={`${box} cursor-pointer font-bold text-neutral-900 transition-colors hover:bg-neutral-100`}
      >
        −
      </button>
      <span
        aria-live="polite"
        className={`${size === "sm" ? "w-7 text-xs" : "w-9 text-sm"} text-center font-bold tabular-nums`}
      >
        {qty}
      </span>
      <button
        type="button"
        onClick={onPlus}
        disabled={qty >= MAX_QTY_PER_LINE}
        aria-label={`Add one ${name}`}
        className={`${box} cursor-pointer bg-neutral-900 font-bold text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40`}
      >
        +
      </button>
    </div>
  );
}

export function Thumb({ src, name, className }: { src?: string | null; name: string; className: string }) {
  if (src) {
    return <img src={src} alt="" loading="lazy" className={`${className} bg-white object-cover`} />;
  }
  return (
    <div
      aria-hidden
      className={`${className} flex items-center justify-center bg-neutral-100 text-lg font-black text-neutral-300`}
    >
      {name.charAt(0)}
    </div>
  );
}

/** One editable cart line. Used in the drawer and in the checkout summary. */
export function CartLine({ line }: { line: BasketLine }) {
  return (
    <li className="flex gap-3 py-3">
      <Thumb src={line.image_url} name={line.name} className="h-16 w-16 shrink-0 border border-neutral-200" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-tight text-neutral-900">{line.name}</p>
          <p className="shrink-0 text-sm font-bold tabular-nums text-neutral-900">
            {KSH(line.unit_price_ksh * line.qty)}
          </p>
        </div>
        <p className="mt-0.5 text-[0.7rem] text-neutral-500">
          {KSH(line.unit_price_ksh)} / {line.unit}
        </p>
        <div className="mt-2 flex items-center justify-between">
          <QtyStepper
            size="sm"
            qty={line.qty}
            name={line.name}
            onMinus={() => cart.removeOne(line.menu_item_id)}
            onPlus={() => cart.add({ id: line.menu_item_id, name: line.name, description: null, price_ksh: line.unit_price_ksh, unit: line.unit, image_url: line.image_url })}
          />
          <button
            type="button"
            onClick={() => cart.removeLine(line.menu_item_id)}
            className="cursor-pointer text-[0.6rem] font-bold uppercase tracking-widest text-neutral-400 hover:text-red-600"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Slide-over cart. The subtotal here is goods only: delivery or pickup is
 * chosen at checkout, so no fee is implied before the customer has decided.
 */
export default function CartDrawer({
  open,
  onClose,
  signedIn,
}: {
  open: boolean;
  onClose: () => void;
  signedIn: boolean;
}) {
  const lines = useCart();
  const units = itemCount(lines);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-[1200] ${open ? "" : "pointer-events-none"}`}
      // Closed, the panel is only slid off-screen. `inert` keeps its buttons
      // out of the tab order and away from screen readers until it is opened.
      inert={!open}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-neutral-900/50 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-light tracking-tighter text-neutral-900">
              Your <span className="font-black">cart</span>
            </h2>
            <span className="bg-[#ffe500] px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-900">
              {units} {units === 1 ? "item" : "items"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            tabIndex={open ? 0 : -1}
            className="cursor-pointer px-2 py-1 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-500 hover:text-neutral-900"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5">
          {lines.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-neutral-500">Nothing in your cart yet.</p>
              <button
                type="button"
                onClick={onClose}
                tabIndex={open ? 0 : -1}
                className="mt-4 cursor-pointer border border-neutral-900 px-5 py-2 text-[0.65rem] font-bold uppercase tracking-widest text-neutral-900 hover:bg-neutral-900 hover:text-white"
              >
                Browse the cuts
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {lines.map((l) => (
                <CartLine key={l.menu_item_id} line={l} />
              ))}
            </ul>
          )}
        </div>

        {lines.length > 0 && (
          <footer className="border-t border-neutral-200 px-5 py-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-500">
                  Subtotal
                </p>
                <p className="mt-0.5 text-[0.7rem] text-neutral-500">
                  Delivery or pickup is chosen at checkout.
                </p>
              </div>
              <p className="text-2xl font-black tracking-tighter tabular-nums text-neutral-900">
                {KSH(basketTotal(lines))}
              </p>
            </div>
            <Link
              to="/checkout"
              tabIndex={open ? 0 : -1}
              className="mt-4 block bg-[#ffe500] px-5 py-3.5 text-center text-xs font-bold uppercase tracking-widest text-neutral-900 no-underline transition-colors hover:bg-neutral-900 hover:text-[#ffe500]"
            >
              Checkout →
            </Link>
            {!signedIn && (
              <p className="mt-2 text-center text-[0.7rem] text-neutral-500">
                You sign in or create an account on the next step. Your cart is kept.
              </p>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}
