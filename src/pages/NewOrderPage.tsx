import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type * as LeafletNs from "leaflet";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import PortalShell, { portalErrorCls, smallBtnCls } from "../auth/PortalShell";
import { useLeafletMap } from "../lib/leaflet";
import { DEPOT } from "../lib/dispatch";
import {
  addToBasket,
  basketTotal,
  itemCount,
  orderBlocker,
  removeLine,
  removeOneFromBasket,
  toOrderItems,
  type BasketLine,
  type MenuItem,
} from "../lib/basket";

const KSH = (n: number) => `KSh ${n.toLocaleString()}`;

/**
 * Place an order: pick items, drop a pin, confirm.
 *
 * The pin is mandatory — dispatch routes by coordinates, so an order without
 * one is unusable. This is a static pin-drop, not live location: the customer
 * taps where to deliver, once.
 *
 * Writes orders then order_items. The order is created first because
 * order_items.order_id must reference a real row; if the item insert fails the
 * order is deleted again so no empty ghost order reaches the kitchen.
 */
export default function NewOrderPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [receiver, setReceiver] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [dropNote, setDropNote] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [pinError, setPinError] = useState(false);

  const layerRef = useRef<LeafletNs.LayerGroup | null>(null);
  const LRef = useRef<typeof LeafletNs | null>(null);
  const pinRef = useRef(pin);
  pinRef.current = pin;

  const { containerRef } = useLeafletMap([DEPOT.lat, DEPOT.lng], 13, (L, map) => {
    LRef.current = L;
    if (!layerRef.current) layerRef.current = L.layerGroup().addTo(map);

    L.circleMarker([DEPOT.lat, DEPOT.lng], {
      radius: 6,
      color: "#171717",
      weight: 2,
      fillColor: "#ffe500",
      fillOpacity: 1,
    })
      .bindTooltip("Butchery", { direction: "top" })
      .addTo(layerRef.current);

    map.on("click", (e: LeafletNs.LeafletMouseEvent) => {
      setPin({ lat: e.latlng.lat, lng: e.latlng.lng });
      setPinError(false);
    });
  });

  // Redraw the marker whenever the pin changes.
  useEffect(() => {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.eachLayer((l) => {
      if (l instanceof L.CircleMarker && (l.options as { radius?: number }).radius === 9) {
        layer.removeLayer(l);
      }
    });
    if (!pin) return;
    L.circleMarker([pin.lat, pin.lng], {
      radius: 9,
      color: "#171717",
      weight: 3,
      fillColor: "#ffe500",
      fillOpacity: 1,
    })
      .bindTooltip("Deliver here", { direction: "top", permanent: false })
      .addTo(layer);
  }, [pin]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await getSupabase()
        .from("menu_items")
        .select("id, name, description, price_ksh, unit, is_available")
        .eq("is_available", true)
        .order("name");
      if (qErr) throw qErr;
      setMenu((data as MenuItem[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the menu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(() => basketTotal(lines), [lines]);
  const units = useMemo(() => itemCount(lines), [lines]);
  const blocker = orderBlocker({
    lines,
    lat: pin?.lat ?? null,
    lng: pin?.lng ?? null,
    receiver,
  });

  const place = async () => {
    if (!user) return;
    if (blocker) {
      setError(blocker);
      if (!pin) setPinError(true);
      return;
    }
    setPlacing(true);
    setError(null);

    const sb = getSupabase();
    let orderId: string | null = null;
    try {
      const { data: order, error: oErr } = await sb
        .from("orders")
        .insert({
          customer_id: user.id,
          status: "pending",
          total_ksh: total,
          is_paid: false,
          receiver: receiver.trim(),
          receiver_phone: receiverPhone.trim() || null,
          drop_note: dropNote.trim() || null,
          drop_lat: pin!.lat,
          drop_lng: pin!.lng,
        })
        .select("id")
        .single();
      if (oErr) throw oErr;
      orderId = (order as { id: string }).id;

      const { error: iErr } = await sb
        .from("order_items")
        .insert(toOrderItems(lines).map((row) => ({ ...row, order_id: orderId })));
      if (iErr) throw iErr;

      navigate("/app", { replace: true });
    } catch (e) {
      // Do not leave a half-built order behind: it would show up in the
      // kitchen queue with nothing to cook.
      if (orderId) await sb.from("orders").delete().eq("id", orderId);
      setError(e instanceof Error ? e.message : "Could not place the order.");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <PortalShell kicker="Customer · New order" title="What can we cut for you?">
      {error && <div className={portalErrorCls}>{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        {/* ---------------- Menu ---------------- */}
        <div>
          <p className="mb-2 text-[0.55rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
            Menu
          </p>
          {loading ? (
            <p className="py-8 text-center text-xs uppercase tracking-widest text-neutral-400">
              Loading…
            </p>
          ) : menu.length === 0 ? (
            <p className="border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
              Nothing available right now.
            </p>
          ) : (
            <div className="space-y-px border border-neutral-200 bg-neutral-200">
              {menu.map((item) => {
                const inBasket = lines.find((l) => l.menu_item_id === item.id);
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 bg-white px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-900">{item.name}</p>
                      <p className="truncate text-[0.7rem] text-neutral-500">
                        {KSH(item.price_ksh)} / {item.unit}
                        {item.description ? ` · ${item.description}` : ""}
                      </p>
                    </div>
                    {inBasket ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => setLines((l) => removeOneFromBasket(l, item.id))}
                          className="h-7 w-7 cursor-pointer border border-neutral-300 text-sm font-bold text-neutral-700 hover:border-neutral-900"
                          aria-label={`Remove one ${item.name}`}
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-bold">{inBasket.qty}</span>
                        <button
                          onClick={() => setLines((l) => addToBasket(l, item))}
                          className="h-7 w-7 cursor-pointer border border-neutral-900 bg-neutral-900 text-sm font-bold text-white"
                          aria-label={`Add one ${item.name}`}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setLines((l) => addToBasket(l, item))}
                        className={`${smallBtnCls} shrink-0`}
                      >
                        Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---------------- Basket + delivery ---------------- */}
        <div className="space-y-4">
          <div className="border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-3 py-2">
              <p className="text-[0.55rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
                Your order · {units} {units === 1 ? "item" : "items"}
              </p>
            </div>
            {lines.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-neutral-400">
                Nothing chosen yet.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {lines.map((l) => (
                  <li key={l.menu_item_id} className="flex items-center gap-2 px-3 py-2">
                    <span className="w-6 shrink-0 font-mono text-xs font-bold text-neutral-900">
                      {l.qty}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.8rem] text-neutral-800">{l.name}</p>
                      <p className="text-[0.65rem] text-neutral-400">
                        {KSH(l.unit_price_ksh)} / {l.unit}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[0.75rem] text-neutral-700">
                      {KSH(l.unit_price_ksh * l.qty)}
                    </span>
                    <button
                      onClick={() => setLines((x) => removeLine(x, l.menu_item_id))}
                      className="shrink-0 cursor-pointer px-1 text-neutral-300 hover:text-red-600"
                      aria-label={`Remove ${l.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-baseline justify-between border-t border-neutral-200 px-3 py-2.5">
              <span className="text-[0.6rem] font-bold uppercase tracking-widest text-neutral-500">
                Total
              </span>
              <span className="font-mono text-sm font-bold text-neutral-900">{KSH(total)}</span>
            </div>
          </div>

          <div className="border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-3 py-2">
              <p className="text-[0.55rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
                Delivery
              </p>
            </div>
            <div className="space-y-2 p-3">
              <input
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                placeholder="Who receives it?"
                className="w-full border border-neutral-300 px-2.5 py-2 text-sm outline-none focus:border-neutral-900"
              />
              <input
                value={receiverPhone}
                onChange={(e) => setReceiverPhone(e.target.value)}
                placeholder="Phone (optional)"
                inputMode="tel"
                className="w-full border border-neutral-300 px-2.5 py-2 text-sm outline-none focus:border-neutral-900"
              />
              <input
                value={dropNote}
                onChange={(e) => setDropNote(e.target.value)}
                placeholder="Gate, floor, landmark (optional)"
                className="w-full border border-neutral-300 px-2.5 py-2 text-sm outline-none focus:border-neutral-900"
              />
            </div>
          </div>

          <div className={`border bg-white ${pinError && !pin ? "border-red-400" : "border-neutral-200"}`}>
            <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
              <p className="text-[0.55rem] font-bold uppercase tracking-[0.15em] text-neutral-400">
                Drop pin
              </p>
              <p
                className={`text-[0.6rem] font-bold uppercase tracking-wider ${
                  pin ? "text-green-700" : "text-neutral-400"
                }`}
              >
                {pin ? "set" : "tap the map"}
              </p>
            </div>
            <div ref={containerRef} className="h-[220px] w-full bg-neutral-100" />
            {pin && (
              <p className="px-3 py-1.5 font-mono text-[0.6rem] text-neutral-400">
                {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
              </p>
            )}
          </div>

          <button
            disabled={placing || blocker !== null}
            onClick={() => void place()}
            className={`w-full cursor-pointer border py-3 text-[0.65rem] font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed ${
              blocker === null
                ? "border-neutral-900 bg-[#ffe500] text-neutral-900 hover:bg-neutral-900 hover:text-[#ffe500]"
                : "border-neutral-200 bg-neutral-100 text-neutral-400"
            }`}
          >
            {placing ? "Placing…" : blocker ?? `Place order · ${KSH(total)}`}
          </button>
        </div>
      </div>
    </PortalShell>
  );
}
