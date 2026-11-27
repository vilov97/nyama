import { describe, expect, it } from "vitest";
import type { BasketLine } from "./basket";
import { parseStoredCart } from "./cart";
import {
  buildOrderPayload,
  checkoutBlocker,
  checkoutSteps,
  dayLabel,
  dueLabel,
  firstAvailableSlot,
  isDueToday,
  normalizeKePhone,
  orderProgress,
  orderTotals,
  shopDate,
  shopTime,
  slotDays,
  slotLabel,
  type CheckoutForm,
  type CheckoutOptions,
  type Slot,
} from "./checkout";

const lines: BasketLine[] = [
  { menu_item_id: "beef", name: "Beef Premium", unit: "kg", unit_price_ksh: 720, qty: 2, note: null },
  { menu_item_id: "ribs", name: "Goat Ribs", unit: "kg", unit_price_ksh: 900, qty: 1, note: null },
];

const slot = (over: Partial<Slot>): Slot => ({
  slot_date: "2026-11-28",
  window_code: "m2",
  shift_code: "morning",
  starts_at: "2026-11-28T07:00:00+00:00", // 10:00 in Nairobi
  ends_at: "2026-11-28T09:00:00+00:00", // 12:00 in Nairobi
  left_count: 12,
  available: true,
  reason: null,
  ...over,
});

const options: CheckoutOptions = {
  delivery_fee_ksh: 200,
  asap_minutes: 90,
  pickup_minutes: 45,
  open_now: true,
  today: "2026-11-27",
  asap: { delivery: true, pickup: true },
  slots: {
    delivery: [
      slot({ slot_date: "2026-11-27", window_code: "e1", available: false, reason: "too_late" }),
      slot({ slot_date: "2026-11-27", window_code: "e2" }),
      slot({}),
      slot({ window_code: "a1", available: false, reason: "full", left_count: 0 }),
    ],
    pickup: [slot({})],
  },
};

const form: CheckoutForm = {
  fulfilment: "delivery",
  when: "asap",
  slotDate: null,
  windowCode: null,
  receiver: "Wanjiru",
  phone: "0712 345 678",
  address: "Ngong Rd, Plot 4",
  dropNote: "Blue gate",
  kitchenNote: "",
  pin: { lat: -1.3, lng: 36.78 },
  substitution: "call_me",
};

describe("normalizeKePhone", () => {
  it("accepts the ways Kenyans write a mobile number", () => {
    expect(normalizeKePhone("0712 345 678")).toBe("+254712345678");
    expect(normalizeKePhone("0712-345-678")).toBe("+254712345678");
    expect(normalizeKePhone("+254 712 345 678")).toBe("+254712345678");
    expect(normalizeKePhone("254712345678")).toBe("+254712345678");
    expect(normalizeKePhone("0110 000 001")).toBe("+254110000001");
  });

  it("rejects landlines, short numbers and other countries", () => {
    expect(normalizeKePhone("0812345678")).toBeNull();
    expect(normalizeKePhone("07123")).toBeNull();
    expect(normalizeKePhone("+447911123456")).toBeNull();
    expect(normalizeKePhone("")).toBeNull();
  });
});

describe("orderTotals", () => {
  it("adds the delivery fee to a delivery order", () => {
    expect(orderTotals(lines, "delivery", 200)).toEqual({ subtotal: 2340, fee: 200, total: 2540 });
  });

  it("charges no fee for pickup", () => {
    expect(orderTotals(lines, "pickup", 200)).toEqual({ subtotal: 2340, fee: 0, total: 2340 });
  });
});

describe("checkoutBlocker", () => {
  it("passes a complete delivery order", () => {
    expect(checkoutBlocker(form, lines, options)).toBeNull();
  });

  it("reports problems in the order the page asks for them", () => {
    expect(checkoutBlocker(form, [], options)?.field).toBe("cart");
    expect(checkoutBlocker({ ...form, receiver: " " }, lines, options)?.field).toBe("receiver");
    expect(checkoutBlocker({ ...form, phone: "12345" }, lines, options)?.field).toBe("phone");
    expect(checkoutBlocker({ ...form, address: "" }, lines, options)?.field).toBe("address");
    expect(checkoutBlocker({ ...form, pin: null }, lines, options)?.field).toBe("pin");
  });

  it("rejects the zero pin", () => {
    expect(checkoutBlocker({ ...form, pin: { lat: 0, lng: 0 } }, lines, options)?.field).toBe("pin");
  });

  it("does not ask a pickup customer for an address or a pin", () => {
    const pickup: CheckoutForm = { ...form, fulfilment: "pickup", address: "", pin: null };
    expect(checkoutBlocker(pickup, lines, options)).toBeNull();
  });

  it("blocks ASAP when the shop cannot finish before closing", () => {
    const closed: CheckoutOptions = { ...options, asap: { delivery: false, pickup: true } };
    expect(checkoutBlocker(form, lines, closed)?.field).toBe("when");
    expect(checkoutBlocker({ ...form, fulfilment: "pickup" }, lines, closed)).toBeNull();
  });

  it("requires a real, open slot when scheduling", () => {
    const scheduled: CheckoutForm = { ...form, when: "scheduled" };
    expect(checkoutBlocker(scheduled, lines, options)?.message).toBe("Pick a time slot.");
    expect(
      checkoutBlocker({ ...scheduled, slotDate: "2026-11-28", windowCode: "m2" }, lines, options)
    ).toBeNull();
    expect(
      checkoutBlocker({ ...scheduled, slotDate: "2026-11-28", windowCode: "a1" }, lines, options)?.message
    ).toBe("That time slot is no longer open.");
  });

  it("drives the stepper", () => {
    expect(checkoutSteps(form, lines, options)).toEqual({ cart: true, delivery: true });
    expect(checkoutSteps({ ...form, pin: null }, lines, options)).toEqual({ cart: true, delivery: false });
    expect(checkoutSteps(form, [], options)).toEqual({ cart: false, delivery: false });
  });
});

describe("buildOrderPayload", () => {
  it("never sends a price, so the browser cannot set one", () => {
    const body = JSON.stringify(buildOrderPayload(form, lines));
    expect(body).not.toMatch(/price|total|fee/);
    expect(buildOrderPayload(form, lines).items).toEqual([
      { menu_item_id: "beef", qty: 2, note: null },
      { menu_item_id: "ribs", qty: 1, note: null },
    ]);
  });

  it("normalises the phone and trims text", () => {
    const p = buildOrderPayload({ ...form, receiver: "  Wanjiru ", dropNote: "  " }, lines);
    expect(p.receiver).toBe("Wanjiru");
    expect(p.receiver_phone).toBe("+254712345678");
    expect(p.drop_note).toBeNull();
  });

  it("strips the address and pin from a pickup order", () => {
    const p = buildOrderPayload({ ...form, fulfilment: "pickup" }, lines);
    expect([p.drop_address, p.drop_note, p.drop_lat, p.drop_lng]).toEqual([null, null, null, null]);
  });

  it("only sends a slot when one was chosen", () => {
    expect(buildOrderPayload({ ...form, slotDate: "2026-11-28", windowCode: "m2" }, lines).slot_date).toBeNull();
    const p = buildOrderPayload({ ...form, when: "scheduled", slotDate: "2026-11-28", windowCode: "m2" }, lines);
    expect([p.slot_date, p.window_code]).toEqual(["2026-11-28", "m2"]);
  });
});

describe("shop time", () => {
  it("formats in Nairobi time whatever the device zone is", () => {
    expect(shopTime("2026-11-28T07:00:00+00:00")).toBe("10:00");
    expect(shopTime("2026-11-27T21:30:00+00:00")).toBe("00:30");
    expect(slotLabel(slot({}))).toBe("10:00 – 12:00");
  });

  it("rolls the calendar date at Nairobi midnight, not UTC midnight", () => {
    expect(shopDate("2026-11-27T20:59:00+00:00")).toBe("2026-11-27");
    expect(shopDate("2026-11-27T21:00:00+00:00")).toBe("2026-11-28");
  });

  it("names days the way the slot picker shows them", () => {
    expect(dayLabel("2026-11-27", "2026-11-27")).toBe("Today");
    expect(dayLabel("2026-11-28", "2026-11-27")).toBe("Tomorrow");
    expect(dayLabel("2026-11-29", "2026-11-27")).toBe("Sun 29 Nov");
    expect(dayLabel("2026-12-01", "2026-11-30")).toBe("Tomorrow");
  });

  it("groups slots by day and flags days with nothing left", () => {
    const days = slotDays(options.slots.delivery, options.today);
    expect(days.map((d) => [d.label, d.slots.length, d.anyAvailable])).toEqual([
      ["Today", 2, true],
      ["Tomorrow", 2, true],
    ]);
    expect(slotDays([slot({ available: false, reason: "full" })], options.today)[0]!.anyAvailable).toBe(false);
  });

  it("preselects the earliest open slot", () => {
    expect(firstAvailableSlot(options.slots.delivery)?.window_code).toBe("e2");
    expect(firstAvailableSlot([])).toBeNull();
  });
});

describe("dueLabel", () => {
  const order = { due_from: "2026-11-27T15:00:00Z", due_by: "2026-11-27T16:30:00Z" }; // 18:00–19:30 EAT

  it("counts down an order that is in progress", () => {
    expect(dueLabel(order, new Date("2026-11-27T15:30:00Z"))).toEqual({
      text: "Due by 19:30 · 1 h left",
      tone: "ok",
    });
  });

  it("turns urgent 20 minutes before the deadline", () => {
    expect(dueLabel(order, new Date("2026-11-27T16:09:00Z")).tone).toBe("ok");
    expect(dueLabel(order, new Date("2026-11-27T16:10:00Z"))).toEqual({
      text: "Due by 19:30 · 20 min left",
      tone: "soon",
    });
  });

  it("says how late a missed order is", () => {
    expect(dueLabel(order, new Date("2026-11-27T16:42:00Z"))).toEqual({ text: "Late by 12 min", tone: "late" });
    expect(dueLabel(order, new Date("2026-11-29T17:00:00Z")).text).toBe("Late by 2 days");
  });

  it("shows the window for an order booked ahead", () => {
    const booked = { due_from: "2026-11-28T07:00:00Z", due_by: "2026-11-28T09:00:00Z" };
    expect(dueLabel(booked, new Date("2026-11-27T15:30:00Z"))).toEqual({
      text: "Tomorrow · 10:00 – 12:00",
      tone: "later",
    });
    expect(dueLabel(booked, new Date("2026-11-28T05:00:00Z")).text).toBe("Today · 10:00 – 12:00");
  });

  it("knows which orders belong to today's board", () => {
    const now = new Date("2026-11-27T15:30:00Z");
    expect(isDueToday("2026-11-27T16:00:00Z", now)).toBe(true);
    expect(isDueToday("2026-11-25T09:00:00Z", now)).toBe(true); // overdue still shows
    expect(isDueToday("2026-11-28T07:00:00Z", now)).toBe(false);
  });
});

describe("orderProgress", () => {
  const base = { status: "pending", cook_status: "pending", delivery_status: "unassigned", fulfilment: "delivery" as const };

  it("walks a delivery from received to delivered", () => {
    expect(orderProgress(base).current).toBe(0);
    expect(orderProgress({ ...base, cook_status: "preparing" }).current).toBe(1);
    expect(orderProgress({ ...base, cook_status: "ready" }).current).toBe(2);
    expect(orderProgress({ ...base, cook_status: "ready", delivery_status: "picked_up" }).current).toBe(3);
    expect(orderProgress({ ...base, cook_status: "ready", delivery_status: "delivered" })).toMatchObject({
      current: 4,
      state: "done",
    });
  });

  it("does not claim the food is ready just because a rider was assigned early", () => {
    expect(orderProgress({ ...base, status: "assigned", delivery_status: "assigned" }).current).toBe(0);
  });

  it("walks a pickup to collected in four steps", () => {
    const pickup = { ...base, fulfilment: "pickup" as const };
    expect(orderProgress(pickup).steps).toHaveLength(4);
    expect(orderProgress({ ...pickup, cook_status: "ready" }).current).toBe(2);
    expect(orderProgress({ ...pickup, cook_status: "done", status: "collected" })).toMatchObject({
      current: 3,
      state: "done",
    });
  });

  it("reports cancelled and failed orders as such", () => {
    expect(orderProgress({ ...base, status: "cancelled" }).state).toBe("cancelled");
    expect(orderProgress({ ...base, delivery_status: "failed", status: "failed" }).state).toBe("failed");
  });
});

describe("parseStoredCart", () => {
  const good = { menu_item_id: "beef", name: "Beef Premium", unit: "kg", unit_price_ksh: 720, qty: 2, note: null };

  it("reads back what the cart wrote", () => {
    expect(parseStoredCart(JSON.stringify([good]))).toEqual([{ ...good, image_url: null }]);
  });

  it("returns an empty cart for missing or corrupt storage", () => {
    expect(parseStoredCart(null)).toEqual([]);
    expect(parseStoredCart("{not json")).toEqual([]);
    expect(parseStoredCart('{"a":1}')).toEqual([]);
  });

  it("discards tampered lines rather than trusting them", () => {
    const raw = JSON.stringify([
      good,
      { ...good, menu_item_id: "x", qty: -3 },
      { ...good, menu_item_id: "y", unit_price_ksh: 1.5 },
      { ...good, menu_item_id: "z", qty: "2" },
      { ...good }, // duplicate id
      null,
    ]);
    expect(parseStoredCart(raw).map((l) => l.menu_item_id)).toEqual(["beef"]);
  });

  it("caps a stored quantity at the per-line maximum", () => {
    expect(parseStoredCart(JSON.stringify([{ ...good, qty: 5000 }]))[0]!.qty).toBe(99);
  });
});
