import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type * as LeafletNs from "leaflet";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import PortalShell from "../auth/PortalShell";
import { depotIcon, pinIcon, useLeafletMap } from "../lib/leaflet";
import { DEPOT } from "../lib/dispatch";
import { itemCount, reconcileBasket, type BasketChange, type MenuItem } from "../lib/basket";
import { cart, useCart } from "../lib/cart";
import {
  buildOrderPayload,
  checkoutBlocker,
  checkoutSteps,
  firstAvailableSlot,
  orderTotals,
  slotDays,
  slotLabel,
  SUBSTITUTION_LABEL,
  type CheckoutField,
  type CheckoutForm,
  type CheckoutOptions,
  type Substitution,
} from "../lib/checkout";
import { CartLine, KSH } from "../components/CartDrawer";

const inputCls =
  "w-full border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-900";
const labelCls = "mb-1 block text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-500";

const SHIFT_LABEL: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

type Pin = { lat: number; lng: number };

/**
 * Checkout: cart → delivery → payment, on one page.
 *
 * The page never computes what the customer owes for the server. It sends what
 * was chosen to place_order(), which prices the order from the database and
 * returns the real total. The numbers shown here are a preview of that.
 */
export default function CheckoutPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const lines = useCart();

  const [options, setOptions] = useState<CheckoutOptions | null>(null);
  const [changes, setChanges] = useState<BasketChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [tried, setTried] = useState(false);
  const [activeDay, setActiveDay] = useState<string | null>(null);

  const [form, setForm] = useState<CheckoutForm>({
    fulfilment: "delivery",
    when: "asap",
    slotDate: null,
    windowCode: null,
    receiver: "",
    phone: "",
    address: "",
    dropNote: "",
    kitchenNote: "",
    pin: null,
    substitution: "call_me",
  });
  const set = useCallback(
    <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) =>
      setForm((f) => ({ ...f, [key]: value })),
    []
  );

  /** Slots, today's menu, and the last delivery details to save retyping. */
  const load = useCallback(
    async (prefill: boolean) => {
      if (!user) return;
      setLoading(true);
      try {
        const sb = getSupabase();
        const [optRes, menuRes, profileRes, lastRes] = await Promise.all([
          sb.rpc("checkout_options"),
          sb
            .from("menu_items")
            .select("id, name, description, price_ksh, unit, is_available, category, image_url, sort_order"),
          sb.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
          sb
            .from("orders")
            .select("receiver, receiver_phone, drop_address, drop_note, drop_lat, drop_lng")
            .eq("fulfilment", "delivery")
            .order("created_at", { ascending: false })
            .limit(1),
        ]);
        if (optRes.error) throw optRes.error;
        if (menuRes.error) throw menuRes.error;
        setOptions(optRes.data as CheckoutOptions);

        const fresh = reconcileBasket(cart.get(), (menuRes.data as MenuItem[]) ?? []);
        if (fresh.changes.length > 0) {
          cart.replace(fresh.lines);
          setChanges(fresh.changes);
        }

        if (prefill) {
          const last = (lastRes.data?.[0] ?? null) as {
            receiver: string | null;
            receiver_phone: string | null;
            drop_address: string | null;
            drop_note: string | null;
            drop_lat: number | null;
            drop_lng: number | null;
          } | null;
          const profile = profileRes.data as { full_name: string | null; phone: string | null } | null;
          setForm((f) => ({
            ...f,
            receiver: f.receiver || last?.receiver || profile?.full_name || "",
            phone: f.phone || last?.receiver_phone || profile?.phone || "",
            address: f.address || last?.drop_address || "",
            dropNote: f.dropNote || last?.drop_note || "",
            pin:
              f.pin ??
              (last?.drop_lat != null && last?.drop_lng != null
                ? { lat: last.drop_lat, lng: last.drop_lng }
                : null),
          }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load checkout.");
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  // Keep "when" valid as the customer switches between delivery and pickup.
  useEffect(() => {
    if (!options) return;
    const slots = options.slots[form.fulfilment];
    const chosen = slots.find((s) => s.slot_date === form.slotDate && s.window_code === form.windowCode);
    if (form.when === "asap" && !options.asap[form.fulfilment]) {
      const first = firstAvailableSlot(slots);
      setForm((f) => ({
        ...f,
        when: "scheduled",
        slotDate: first?.slot_date ?? null,
        windowCode: first?.window_code ?? null,
      }));
      setActiveDay(first?.slot_date ?? null);
    } else if (form.when === "scheduled" && !chosen?.available) {
      const first = firstAvailableSlot(slots);
      setForm((f) => ({ ...f, slotDate: first?.slot_date ?? null, windowCode: first?.window_code ?? null }));
      setActiveDay(first?.slot_date ?? null);
    }
  }, [options, form.fulfilment, form.when, form.slotDate, form.windowCode]);

  const totals = orderTotals(lines, form.fulfilment, options?.delivery_fee_ksh ?? 0);
  const blocker = checkoutBlocker(form, lines, options);
  const steps = checkoutSteps(form, lines, options);
  const days = useMemo(
    () => (options ? slotDays(options.slots[form.fulfilment], options.today) : []),
    [options, form.fulfilment]
  );
  const shownDay = days.find((d) => d.date === activeDay) ?? days.find((d) => d.anyAvailable) ?? days[0];
  const fieldError = (field: CheckoutField) =>
    tried && blocker?.field === field ? (
      <p className="mt-1.5 text-xs font-semibold text-red-600">{blocker.message}</p>
    ) : null;

  const place = async () => {
    setTried(true);
    setError(null);
    if (blocker) {
      document.getElementById(`co-${blocker.field}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setPlacing(true);
    try {
      const { data, error: rpcErr } = await getSupabase().rpc("place_order", {
        p: buildOrderPayload(form, lines),
      });
      if (rpcErr) throw rpcErr;
      setPlaced(true);
      cart.clear();
      navigate("/app", { replace: true, state: { placed: data } });
    } catch (e) {
      // The server's messages are written for customers; show them as they are.
      setError(e instanceof Error ? e.message : "Could not place the order.");
      // A slot may have filled or a cut sold out while the page was open.
      void load(false);
    } finally {
      setPlacing(false);
    }
  };

  if (lines.length === 0 && !placed) {
    return (
      <PortalShell kicker="Customer · Checkout" title="Checkout">
        {changes.length > 0 && <ChangesNotice changes={changes} />}
        <div className="border border-neutral-200 bg-white px-4 py-16 text-center">
          <p className="text-sm text-neutral-500">Your cart is empty.</p>
          <Link
            to="/shop"
            className="mt-4 inline-block bg-[#ffe500] px-6 py-3 text-xs font-bold uppercase tracking-widest text-neutral-900 no-underline hover:bg-neutral-900 hover:text-[#ffe500]"
          >
            Go to the shop
          </Link>
        </div>
      </PortalShell>
    );
  }

  const placeButton = (
    <>
      <button
        type="button"
        disabled={placing || loading}
        onClick={() => void place()}
        className="w-full cursor-pointer bg-[#ffe500] px-5 py-4 text-xs font-bold uppercase tracking-widest text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-[#ffe500] disabled:cursor-wait disabled:opacity-60"
      >
        {placing ? "Placing your order…" : `Place order · ${KSH(totals.total)}`}
      </button>
      {tried && blocker && (
        <p className="mt-2 text-center text-xs font-semibold text-red-600">{blocker.message}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </>
  );

  return (
    <PortalShell kicker="Customer · Checkout" title="Checkout">
      <Stepper cart={steps.cart} delivery={steps.delivery} />
      {changes.length > 0 && <ChangesNotice changes={changes} />}

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_360px]">
        {/* ------------------------------------------------ Summary (step 1) */}
        <aside className="lg:sticky lg:top-4 lg:order-2">
          <Section title={`Your cart · ${itemCount(lines)} ${itemCount(lines) === 1 ? "item" : "items"}`}>
            <ul className="-mt-3 divide-y divide-neutral-100">
              {lines.map((l) => (
                <CartLine key={l.menu_item_id} line={l} />
              ))}
            </ul>
            <Link
              to="/shop"
              className="text-[0.6rem] font-bold uppercase tracking-widest text-neutral-500 hover:text-neutral-900"
            >
              + Add more cuts
            </Link>
            <dl className="mt-4 space-y-1.5 border-t border-neutral-200 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-500">Subtotal</dt>
                <dd className="tabular-nums text-neutral-900">{KSH(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">
                  {form.fulfilment === "delivery" ? "Delivery · Nairobi" : "Pickup at the butchery"}
                </dt>
                <dd className="tabular-nums text-neutral-900">{totals.fee > 0 ? KSH(totals.fee) : "Free"}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-neutral-200 pt-2">
                <dt className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-neutral-500">Total</dt>
                <dd className="text-2xl font-black tracking-tighter tabular-nums text-neutral-900">
                  {KSH(totals.total)}
                </dd>
              </div>
            </dl>
            <div className="mt-4 hidden lg:block">{placeButton}</div>
          </Section>
        </aside>

        {/* ----------------------------------------------- Delivery (step 2) */}
        <div className="space-y-5 lg:order-1">
          <Section title="How do you want it?">
            <div role="radiogroup" aria-label="Delivery or pickup" className="grid grid-cols-2 gap-2">
              <Choice
                checked={form.fulfilment === "delivery"}
                onSelect={() => set("fulfilment", "delivery")}
                title="Delivery"
                detail={options ? `${KSH(options.delivery_fee_ksh)} · Nairobi` : "Nairobi"}
              />
              <Choice
                checked={form.fulfilment === "pickup"}
                onSelect={() => set("fulfilment", "pickup")}
                title="Pickup"
                detail="Free · collect at the butchery"
              />
            </div>
          </Section>

          <Section title={form.fulfilment === "delivery" ? "Who receives it" : "Who collects it"}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div id="co-receiver">
                <label htmlFor="receiver" className={labelCls}>Name</label>
                <input
                  id="receiver"
                  value={form.receiver}
                  onChange={(e) => set("receiver", e.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  className={inputCls}
                />
                {fieldError("receiver")}
              </div>
              <div id="co-phone">
                <label htmlFor="phone" className={labelCls}>Mobile number</label>
                <input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0712 345 678"
                  className={inputCls}
                />
                {fieldError("phone")}
              </div>
            </div>
          </Section>

          {form.fulfilment === "delivery" && (
            <Section title="Where to">
              <div className="space-y-3">
                <div id="co-address">
                  <label htmlFor="address" className={labelCls}>Street, building, house</label>
                  <input
                    id="address"
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                    autoComplete="street-address"
                    maxLength={200}
                    placeholder="Ngong Road, Greenhouse, apartment 4B"
                    className={inputCls}
                  />
                  {fieldError("address")}
                </div>
                <div>
                  <label htmlFor="dropNote" className={labelCls}>Landmark or instructions for the rider (optional)</label>
                  <input
                    id="dropNote"
                    value={form.dropNote}
                    onChange={(e) => set("dropNote", e.target.value)}
                    maxLength={300}
                    placeholder="Blue gate opposite the church. Call at the gate."
                    className={inputCls}
                  />
                </div>
                <div id="co-pin">
                  <PinMap pin={form.pin} onChange={(p) => set("pin", p)} invalid={tried && blocker?.field === "pin"} />
                  {fieldError("pin")}
                </div>
              </div>
            </Section>
          )}

          <div id="co-when">
            <Section title={form.fulfilment === "delivery" ? "When should it arrive" : "When will you collect"}>
              <div role="radiogroup" aria-label="Timing" className="grid grid-cols-2 gap-2">
                <Choice
                  checked={form.when === "asap"}
                  disabled={options ? !options.asap[form.fulfilment] : false}
                  onSelect={() => set("when", "asap")}
                  title={form.fulfilment === "delivery" ? "Deliver now" : "As soon as it is ready"}
                  detail={
                    !options
                      ? "…"
                      : options.asap[form.fulfilment]
                        ? `Within about ${form.fulfilment === "delivery" ? options.asap_minutes : options.pickup_minutes} min`
                        : options.open_now
                          ? "Too close to closing today"
                          : "We are closed right now"
                  }
                />
                <Choice
                  checked={form.when === "scheduled"}
                  onSelect={() => set("when", "scheduled")}
                  title="Pick a time"
                  detail="Choose a day and a slot"
                />
              </div>

              {form.when === "scheduled" && (
                <div className="mt-4">
                  <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                    {days.map((d) => (
                      <button
                        key={d.date}
                        type="button"
                        onClick={() => setActiveDay(d.date)}
                        className={`shrink-0 cursor-pointer border px-3 py-1.5 text-[0.65rem] font-bold uppercase tracking-wider transition-colors ${
                          shownDay?.date === d.date
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : d.anyAvailable
                              ? "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-900"
                              : "border-neutral-200 bg-neutral-50 text-neutral-300"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {shownDay?.slots.map((s) => {
                      const chosen = form.slotDate === s.slot_date && form.windowCode === s.window_code;
                      return (
                        <button
                          key={s.window_code}
                          type="button"
                          disabled={!s.available}
                          aria-pressed={chosen}
                          onClick={() => setForm((f) => ({ ...f, slotDate: s.slot_date, windowCode: s.window_code }))}
                          className={`cursor-pointer border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed ${
                            chosen
                              ? "border-neutral-900 bg-[#ffe500]"
                              : s.available
                                ? "border-neutral-300 bg-white hover:border-neutral-900"
                                : "border-neutral-200 bg-neutral-50"
                          }`}
                        >
                          <span className={`block text-sm font-bold tabular-nums ${s.available ? "text-neutral-900" : "text-neutral-300"}`}>
                            {slotLabel(s)}
                          </span>
                          <span
                            className={`block text-[0.6rem] font-semibold uppercase tracking-wider ${
                              s.available ? (chosen ? "text-neutral-900" : "text-green-700") : "text-neutral-400"
                            }`}
                          >
                            {s.available
                              ? `${SHIFT_LABEL[s.shift_code] ?? ""} · ${s.left_count <= 3 ? `${s.left_count} left` : "available"}`
                              : s.reason === "full"
                                ? "Full"
                                : "Closed"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {fieldError("when")}
            </Section>
          </div>

          <Section title="For the butcher">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="substitution" className={labelCls}>If a cut is not available</label>
                <select
                  id="substitution"
                  value={form.substitution}
                  onChange={(e) => set("substitution", e.target.value as Substitution)}
                  className={inputCls}
                >
                  {(Object.keys(SUBSTITUTION_LABEL) as Substitution[]).map((k) => (
                    <option key={k} value={k}>{SUBSTITUTION_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="kitchenNote" className={labelCls}>How you want it cut (optional)</label>
                <input
                  id="kitchenNote"
                  value={form.kitchenNote}
                  onChange={(e) => set("kitchenNote", e.target.value)}
                  maxLength={300}
                  placeholder="Small pieces for stew, fat trimmed"
                  className={inputCls}
                />
              </div>
            </div>
          </Section>

          {/* ---------------------------------------------- Payment (step 3) */}
          <Section title="Payment">
            <div className="border border-neutral-900 bg-white px-3 py-3">
              <p className="text-sm font-bold text-neutral-900">
                {form.fulfilment === "delivery" ? "Pay on delivery" : "Pay at the counter"}
              </p>
              <p className="mt-0.5 text-xs text-neutral-600">
                {form.fulfilment === "delivery"
                  ? `M-Pesa or cash to the rider when your order arrives: ${KSH(totals.total)}.`
                  : `M-Pesa or cash when you collect: ${KSH(totals.total)}.`}
              </p>
            </div>
            <p className="mt-2 text-[0.7rem] text-neutral-500">
              Paying from your phone at checkout (M-Pesa Express) is not switched on yet.
            </p>
          </Section>

          <div className="lg:hidden">{placeButton}</div>
        </div>
      </div>
    </PortalShell>
  );
}

/* -------------------------------------------------------------------------- */

function Stepper({ cart: cartDone, delivery }: { cart: boolean; delivery: boolean }) {
  const steps = [
    { label: "Cart", done: cartDone },
    { label: "Delivery", done: cartDone && delivery },
    { label: "Payment", done: false },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="mb-6 flex items-center" aria-label="Checkout steps">
      {steps.map((s, i) => (
        <li key={s.label} className="flex flex-1 items-center last:flex-none" aria-current={i === current ? "step" : undefined}>
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center text-[0.65rem] font-bold ${
              s.done
                ? "bg-neutral-900 text-[#ffe500]"
                : i === current
                  ? "bg-[#ffe500] text-neutral-900"
                  : "bg-neutral-200 text-neutral-500"
            }`}
          >
            {s.done ? "✓" : i + 1}
          </span>
          <span
            className={`ml-2 text-[0.6rem] font-bold uppercase tracking-[0.15em] ${
              s.done || i === current ? "text-neutral-900" : "text-neutral-400"
            }`}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <span className={`mx-3 h-px flex-1 ${s.done ? "bg-neutral-900" : "bg-neutral-200"}`} />
          )}
        </li>
      ))}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}

function Choice({
  checked,
  disabled,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={`flex cursor-pointer items-start gap-2.5 border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed ${
        checked
          ? "border-neutral-900 bg-neutral-900 text-white"
          : disabled
            ? "border-neutral-200 bg-neutral-50 text-neutral-400"
            : "border-neutral-300 bg-white text-neutral-900 hover:border-neutral-900"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          checked ? "border-[#ffe500]" : "border-neutral-400"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#ffe500]" />}
      </span>
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className={`block text-[0.7rem] ${checked ? "text-neutral-300" : disabled ? "text-neutral-400" : "text-neutral-500"}`}>
          {detail}
        </span>
      </span>
    </button>
  );
}

function ChangesNotice({ changes }: { changes: BasketChange[] }) {
  return (
    <div className="mb-5 border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
      <strong>Your cart was updated to match today&apos;s menu.</strong>
      <ul className="mt-1 list-inside list-disc">
        {changes.map((c, i) => (
          <li key={i}>
            {c.kind === "removed"
              ? `${c.name} is not available today and was removed.`
              : `${c.name} is now ${KSH(c.to)} (was ${KSH(c.from)}).`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Drop-pin map. The customer taps where the order should arrive, or shares
 * their position once. This is a single static pin: nothing is tracked.
 */
function PinMap({ pin, onChange, invalid }: { pin: Pin | null; onChange: (p: Pin) => void; invalid: boolean }) {
  const LRef = useRef<typeof LeafletNs | null>(null);
  const markerRef = useRef<LeafletNs.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const { containerRef, mapRef } = useLeafletMap([DEPOT.lat, DEPOT.lng], 12, (L, map) => {
    LRef.current = L;
    L.marker([DEPOT.lat, DEPOT.lng], { icon: depotIcon(L), title: "Butchery" })
      .bindTooltip("Butchery", { direction: "top" })
      .addTo(map);
    map.on("click", (e: LeafletNs.LeafletMouseEvent) => {
      setNote(null);
      onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    setReady(true);
  });

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!pin) return;
    markerRef.current = L.marker([pin.lat, pin.lng], {
      icon: pinIcon(L, "#171717", "•", true),
      title: "Deliver here",
    }).addTo(map);
    if (!map.getBounds().contains([pin.lat, pin.lng])) map.setView([pin.lat, pin.lng], 15);
  }, [pin, ready, mapRef]);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setNote("This device cannot share a location. Tap the map instead.");
      return;
    }
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChangeRef.current({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      () => {
        setLocating(false);
        setNote("Could not get your location. Tap the map where we should deliver.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={labelCls}>Drop a pin where we should deliver</span>
        <span
          className={`text-[0.6rem] font-bold uppercase tracking-wider ${pin ? "text-green-700" : "text-neutral-400"}`}
        >
          {pin ? "Pin set" : "Tap the map"}
        </span>
      </div>
      <div className={`border ${invalid ? "border-red-500" : "border-neutral-300"}`}>
        <div ref={containerRef} className="h-[260px] w-full bg-neutral-100" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="cursor-pointer border border-neutral-900 px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white disabled:opacity-50"
        >
          {locating ? "Locating…" : "Use my location"}
        </button>
        <p className="text-[0.7rem] text-neutral-500">
          {note ?? "Used once to place the pin. We do not track your location."}
        </p>
      </div>
    </div>
  );
}
