import { basketTotal, isValidPin, type BasketLine } from "./basket";

/**
 * Pure checkout rules: totals, validation, time-slot labels, order progress.
 *
 * The server (place_order) enforces all of this again and is the authority.
 * These functions exist so the customer is told what is missing before they
 * press the button, and so every dashboard words a due time the same way.
 */

/** The shop runs on Nairobi time whatever the viewer's device says. */
export const SHOP_TZ = "Africa/Nairobi";

export type Fulfilment = "delivery" | "pickup";
export type When = "asap" | "scheduled";
export type Substitution = "call_me" | "best_match" | "leave_out";

export const SUBSTITUTION_LABEL: Record<Substitution, string> = {
  call_me: "Call me first",
  best_match: "Give me the closest cut",
  leave_out: "Leave it out and charge me less",
};

export type Slot = {
  slot_date: string; // YYYY-MM-DD, shop time
  window_code: string;
  shift_code: "morning" | "afternoon" | "evening";
  starts_at: string;
  ends_at: string;
  left_count: number;
  available: boolean;
  reason: "too_late" | "full" | null;
};

export type CheckoutOptions = {
  delivery_fee_ksh: number;
  asap_minutes: number;
  pickup_minutes: number;
  open_now: boolean;
  today: string;
  asap: Record<Fulfilment, boolean>;
  slots: Record<Fulfilment, Slot[]>;
};

export type CheckoutForm = {
  fulfilment: Fulfilment;
  when: When;
  slotDate: string | null;
  windowCode: string | null;
  receiver: string;
  phone: string;
  address: string;
  dropNote: string;
  kitchenNote: string;
  pin: { lat: number; lng: number } | null;
  substitution: Substitution;
};

/* ------------------------------------------------------------------ phone */

/**
 * Kenyan mobile number to +2547XXXXXXXX / +2541XXXXXXXX, or null.
 * Mirrors public.normalize_ke_phone() in the database.
 */
export function normalizeKePhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-()]/g, "");
  const m = /^(?:\+?254|0)([17]\d{8})$/.exec(compact);
  return m ? `+254${m[1]}` : null;
}

/* ----------------------------------------------------------------- totals */

export function orderTotals(
  lines: readonly BasketLine[],
  fulfilment: Fulfilment,
  deliveryFeeKsh: number
): { subtotal: number; fee: number; total: number } {
  const subtotal = basketTotal(lines);
  const fee = fulfilment === "delivery" ? deliveryFeeKsh : 0;
  return { subtotal, fee, total: subtotal + fee };
}

/* ------------------------------------------------------------- validation */

export type CheckoutField = "cart" | "receiver" | "phone" | "address" | "pin" | "when";

export type Blocker = { field: CheckoutField; message: string };

/** The first thing stopping this order, or null when it can be placed. */
export function checkoutBlocker(
  form: CheckoutForm,
  lines: readonly BasketLine[],
  options: CheckoutOptions | null
): Blocker | null {
  if (lines.length === 0) return { field: "cart", message: "Your cart is empty." };
  if (form.receiver.trim().length < 2) {
    return { field: "receiver", message: "Tell us who is receiving the order." };
  }
  if (!normalizeKePhone(form.phone)) {
    return { field: "phone", message: "Enter a Kenyan mobile number, for example 0712 345 678." };
  }
  if (form.fulfilment === "delivery") {
    if (form.address.trim().length < 3) {
      return { field: "address", message: "Add the street, building or house." };
    }
    if (!isValidPin(form.pin?.lat ?? null, form.pin?.lng ?? null)) {
      return { field: "pin", message: "Drop your pin on the map." };
    }
  }
  if (form.when === "asap") {
    if (options && !options.asap[form.fulfilment]) {
      return { field: "when", message: "We cannot finish an order before closing. Pick a time slot." };
    }
  } else {
    const slot = options?.slots[form.fulfilment].find(
      (s) => s.slot_date === form.slotDate && s.window_code === form.windowCode
    );
    if (!slot) return { field: "when", message: "Pick a time slot." };
    if (!slot.available) return { field: "when", message: "That time slot is no longer open." };
  }
  return null;
}

/** Which of the three checkout steps are complete, for the stepper. */
export function checkoutSteps(
  form: CheckoutForm,
  lines: readonly BasketLine[],
  options: CheckoutOptions | null
): { cart: boolean; delivery: boolean } {
  const blocker = checkoutBlocker(form, lines, options);
  return { cart: lines.length > 0, delivery: blocker === null };
}

/** Request body for the place_order() RPC. Prices are deliberately absent. */
export function buildOrderPayload(form: CheckoutForm, lines: readonly BasketLine[]) {
  const delivery = form.fulfilment === "delivery";
  const scheduled = form.when === "scheduled";
  return {
    fulfilment: form.fulfilment,
    when: form.when,
    slot_date: scheduled ? form.slotDate : null,
    window_code: scheduled ? form.windowCode : null,
    receiver: form.receiver.trim(),
    receiver_phone: normalizeKePhone(form.phone) ?? form.phone.trim(),
    drop_address: delivery ? form.address.trim() : null,
    drop_note: delivery ? form.dropNote.trim() || null : null,
    drop_lat: delivery ? (form.pin?.lat ?? null) : null,
    drop_lng: delivery ? (form.pin?.lng ?? null) : null,
    kitchen_note: form.kitchenNote.trim() || null,
    substitution: form.substitution,
    items: lines.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty, note: l.note })),
  };
}

/* ------------------------------------------------------------------ times */

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHOP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14:30" in shop time. */
export function shopTime(iso: string | Date): string {
  return timeFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "2026-11-28" in shop time. */
export function shopDate(iso: string | Date): string {
  const parts = dateFmt.formatToParts(typeof iso === "string" ? new Date(iso) : iso);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** "Today", "Tomorrow" or "Sun 29 Nov" for a shop-time calendar date. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

export function slotLabel(slot: Pick<Slot, "starts_at" | "ends_at">): string {
  return `${shopTime(slot.starts_at)} – ${shopTime(slot.ends_at)}`;
}

export type SlotDay = { date: string; label: string; slots: Slot[]; anyAvailable: boolean };

/** Group the flat slot list by day, in order, for the day chips. */
export function slotDays(slots: readonly Slot[], today: string): SlotDay[] {
  const days: SlotDay[] = [];
  for (const slot of slots) {
    let day = days.find((d) => d.date === slot.slot_date);
    if (!day) {
      day = { date: slot.slot_date, label: dayLabel(slot.slot_date, today), slots: [], anyAvailable: false };
      days.push(day);
    }
    day.slots.push(slot);
    if (slot.available) day.anyAvailable = true;
  }
  return days;
}

/** The earliest slot that can still be booked, to preselect. */
export function firstAvailableSlot(slots: readonly Slot[]): Slot | null {
  return slots.find((s) => s.available) ?? null;
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const days = Math.floor(minutes / (24 * 60));
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export type DueTone = "later" | "ok" | "soon" | "late";

/**
 * One wording of "when is this due" for the kitchen, the rider, dispatch and
 * the customer. `soon` starts 20 minutes before the deadline.
 */
export function dueLabel(
  order: { due_from: string; due_by: string },
  now: Date
): { text: string; tone: DueTone } {
  const from = new Date(order.due_from).getTime();
  const by = new Date(order.due_by).getTime();
  const t = now.getTime();
  if (t < from) {
    const day = dayLabel(shopDate(order.due_from), shopDate(now));
    return { text: `${day} · ${shopTime(order.due_from)} – ${shopTime(order.due_by)}`, tone: "later" };
  }
  if (t > by) {
    return { text: `Late by ${duration(Math.floor((t - by) / 60000))}`, tone: "late" };
  }
  const left = Math.ceil((by - t) / 60000);
  return {
    text: `Due by ${shopTime(order.due_by)} · ${duration(left)} left`,
    tone: left <= 20 ? "soon" : "ok",
  };
}

/** True when the order's window starts today or earlier, in shop time. */
export function isDueToday(dueFrom: string, now: Date): boolean {
  return shopDate(dueFrom) <= shopDate(now);
}

/* --------------------------------------------------------------- progress */

export type OrderProgress = {
  steps: string[];
  /** Index of the step the order has reached. */
  current: number;
  state: "active" | "done" | "cancelled" | "failed";
};

/** Customer-facing progress, read from the two real statuses, not the rollup. */
export function orderProgress(order: {
  status: string;
  cook_status: string;
  delivery_status: string;
  fulfilment: Fulfilment;
}): OrderProgress {
  const cooking = order.cook_status === "accepted" || order.cook_status === "preparing";
  const cooked = order.cook_status === "ready" || order.cook_status === "done";

  if (order.fulfilment === "pickup") {
    const steps = ["Received", "Preparing", "Ready to collect", "Collected"];
    if (order.status === "cancelled") return { steps, current: 0, state: "cancelled" };
    if (order.cook_status === "done") return { steps, current: 3, state: "done" };
    return { steps, current: cooked ? 2 : cooking ? 1 : 0, state: "active" };
  }

  const steps = ["Received", "Preparing", "Ready", "On the way", "Delivered"];
  if (order.status === "cancelled") return { steps, current: 0, state: "cancelled" };
  if (order.delivery_status === "failed") return { steps, current: 3, state: "failed" };
  if (order.delivery_status === "delivered") return { steps, current: 4, state: "done" };
  if (order.delivery_status === "picked_up") return { steps, current: 3, state: "active" };
  return { steps, current: cooked ? 2 : cooking ? 1 : 0, state: "active" };
}
