# Nyama — operations design: who sees what, and how an order moves

A practical plan for running the butchery with admins, managers, kitchen staff and
riders in one system. Grounded in what the codebase already has, with the gaps
called out honestly.

---

## 1. The one idea everything hangs on

**One order = one row, and every role is a different *view* of that row — never a
copy.**

```
                        orders  (single source of truth)
                           │
      ┌──────────┬─────────┼──────────┬───────────┐
   Customer   Kitchen   Manager     Rider       Admin
    "where    "what do  "who takes  "what do     "is anyone
     is my     I cook    this?"      I drive     abusing this?"
     food?"    next?"                 next?"       ↓
      │          │         │           │        audit_logs
      └──────────┴─────────┴───────────┘
              all read/write the SAME row,
              filtered by Postgres RLS
```

The reason this matters: if the kitchen keeps its own list and the manager keeps
another, they drift. Someone cooks food nobody delivers; a rider arrives for an
order already cancelled. One row, many filtered views — that is the whole trick.

RLS does the filtering. The `profiles.role` + JWT `app_metadata.user_role` claim
already drive it, and the existing policies are correct (verified: rider sees 0
orders, 0 customer profiles; manager sees everything it needs).

---

## 2. Roles, honestly

| Role | Exists today | Should it? |
|---|---|---|
| `customer` | ✅ | Yes — orders, tracks, no dashboard |
| `rider` | ✅ | Yes — assigned runs + available pool |
| `manager` | ✅ | Yes — dispatch, assignment, staff toggle |
| `admin` | ✅ | Yes — users, roles, refunds, audit |
| `kitchen` | ❌ **missing** | **Yes, add it** |

### Why kitchen is its own role, not a manager

A kitchen user needs exactly one thing: *the next dishes to cook, in order*. They
must **not** see customer phone numbers, addresses, prices, or be able to assign
riders. If you give cooks a manager account you hand them the whole business.

Add it to the enum, and give it a view-only policy scoped to
`status IN ('accepted','preparing')` with `receiver_phone`, `drop_lat`/`drop_lng`
and `total_ksh` masked.

> **Migration note:** `app_role` is a Postgres enum. Adding a value is a one-line
> `ALTER TYPE ... ADD VALUE` and is safe, but it **cannot run inside a
> transaction block** on older Postgres — issue it alone.

### Permission matrix (the contract)

| Capability | Kitchen | Rider | Manager | Admin |
|---|:--:|:--:|:--:|:--:|
| See order items & notes | ✅ own queue | ✅ own run | ✅ all | ✅ all |
| See customer phone | ❌ | ✅ own run | ✅ | ✅ |
| See customer pin coordinates | ❌ | ✅ own run | ✅ | ✅ |
| See order total / payment | ❌ | ❌ | ✅ | ✅ |
| Accept an order | ❌ | ❌ | ✅ | ✅ |
| Mark preparing → ready | ✅ | ❌ | ✅ | ✅ |
| Assign / reassign rider | ❌ | ❌ | ✅ | ✅ |
| Claim an unassigned run | ❌ | ✅ | ✅ | ✅ |
| Advance picked_up → delivered | ❌ | ✅ own | ✅ | ✅ |
| Issue refund | ❌ | ❌ | 1st approval | 2nd approval |
| Change roles / disable users | ❌ | ❌ | riders only | ✅ |

If a row in that table ever needs a "sometimes", the design is wrong — pick one.

---

## 3. Order lifecycle — the contract

Your enum today:

```
pending → accepted → preparing → ready → assigned → picked_up → delivered
                                                          ↘ cancelled
```

That is a reasonable spine, but it implies things it shouldn't. Two corrections:

**(a) `assigned` is not a cooking stage.** It is a delivery fact. Being
"assigned" and "ready" can be true at once — a rider can be booked while the food
is still cooking. Forcing them onto one linear track causes real bugs: what
status is an order that's cooked but unrouted? Or routed but raw?

Split the two concerns:

```
cook_status:    pending → accepted → preparing → ready
delivery_status: unassigned → assigned → picked_up → delivered | failed
order_status:   open → completed | cancelled   (a rollup, for reporting)
```

Your current enum can be kept as the *rollup* so nothing breaks, while kitchen
drives `cook_status` and dispatch drives `delivery_status`. This is the single
highest-value schema change in the whole plan.

**(b) Who may set which status** — enforce in the DB, not just the UI:

| Transition | Allowed by |
|---|---|
| pending → accepted | manager, admin |
| accepted → preparing → ready | kitchen, manager, admin |
| any → assigned | manager, admin (or rider self-claim, see §6) |
| assigned → picked_up → delivered | the assigned rider only |
| any → cancelled | customer (while pending), manager, admin |

Implement with a `BEFORE UPDATE` trigger comparing `old.status`/`new.status`
against `my_role()` — the same pattern already used by
`guard_payment_columns`. UI-only rules get bypassed the first time someone opens
the API in a browser tab.

---

## 4. The dashboards

Design each around **one question the person asks all day**. Everything else is
secondary.

### Manager — "who takes this, and is anyone drowning?"

The screen you already have is close. Keep the map and add:

- **Queue strip across the top:** `Pending 4 · Cooking 3 · Ready 2 · Out 5 ·
  Late 1` — the shape of the shift in one glance
- **Left:** unassigned orders grouped by route, oldest first, with pin
- **Centre:** the map (already built)
- **Right:** rider list with `3/5 stops`, distance, and a red flag past capacity

The overload guard you have (confirm dialog at `max_stops`) is the right call.
Make it *hard* rather than a confirm — a manager under pressure clicks "yes" to
everything. Better: refuse the sixth stop and offer the nearest rider with
headroom.

### Kitchen — "what do I cook next?"

A single column. No map, no prices, no phone numbers.

```
┌──────────────────────────────────────┐
│ #4821  ·  accepted  ·  12 min ago    │
│  3 × Goat Choma Cut                  │
│  1 × Ugali                           │
│  Note: no chilli                     │
│              [ Start cooking ]       │
└──────────────────────────────────────┘
```

Sorted by accepted time, oldest first. One button per order. That's it — a cook
with wet hands on a phone doesn't need filters.

> This needs **`order_items`**, which you do not have yet. Orders carry only
> `total_ksh`, so the kitchen currently cannot know *what* to cook. Highest
> priority gap in this document.

### Rider — "what's next, and how far?"

Phone-first, one-handed, sunlight-readable.

```
┌────────────────────────────────────┐
│ Karen / Langata · 3 stops          │
│ ≈ 14.2 km · ~40 min                │
│                                    │
│  1  Njoroge   +254712…    1.2 km   │
│     Gate 2, green gate             │
│     [ Navigate ]  [ Delivered ]    │
└────────────────────────────────────┘
```

- Ordered by the nearest-neighbour sequence already implemented
- Each stop: one-tap **Navigate** (`https://maps.google.com/?daddr=lat,lng`), one-tap **Delivered**
- Never show another rider's run, or an order not assigned to them (RLS already guarantees this)
- Big buttons, no tiny targets

### Admin — "is anything wrong?"

Not an operations screen. Exceptions only:

- Refunds awaiting second approval
- Users disabled in the last 24h
- Orders stuck > 60 min in one status
- Audit trail (already built)

Admins should not be dispatching. If they are, the manager tool is failing.

---

## 5. The map (built) — how to use it

Already shipped: pins by route colour, per-rider line, `n/cap`, distance.

Two things to know:

1. **It is static, by design.** No live tracking. A pin is written once when the
   customer sets their drop point. This is a privacy choice and a cost choice —
   live tracking means a GPS ping every few seconds per rider.
2. **Give it real coordinates.** `DEPOT` is still a Nairobi-centre placeholder.
   Every distance and route line is measured from it, so right now they are all
   wrong.

**Trade-off worth stating plainly:** static planning plus "Navigate" hands-off is
~90% of the dispatch value at ~5% of the complexity. Live tracking is only worth
it if customers demand "where is my food *right now*" to the minute. Start
static; add tracking when a customer complains, not before.

---

## 6. Riders finding and accepting orders

You asked specifically about this. There are two models — pick one deliberately.

### Model A: Manager assigns (what you have)

Manager sees the board, assigns by pin. Predictable, controllable, no race
conditions. Cost: the manager is a bottleneck at peak.

### Model B: Rider self-claim from a pool

Unassigned ready orders appear to all riders within a radius; first tap wins.

Requires three things you don't have:

1. **`deliveries.order_id` must be UNIQUE.** Right now there is no constraint, so
   two riders could claim the same order simultaneously and you'd get duplicate
   runs. This is not theoretical — it is the classic double-claim bug.
2. **An atomic claim function**, so the check and the write are one step:
   ```sql
   -- returns the delivery id, or NULL if someone beat you to it
   claim_order(p_order uuid) returns uuid
   ```
   Implement as a single `INSERT ... ON CONFLICT (order_id) DO NOTHING RETURNING id`
   and **not** as "select then insert" — the two-step version races.
3. **A radius**, which needs a real depot coordinate and `earthdistance` or a
   simple bounding box.

### Recommendation

**Ship Model A now, build Model B behind a flag.** Assignment by a manager who
can see the whole board beats a free-for-all while you have a handful of riders.
Self-claim pays off past roughly 6–8 riders where one dispatcher can't keep up —
and it's the point where the double-claim constraint becomes mandatory, not
optional.

---

## 7. Real-time order tracking

You have **no realtime subscriptions** today — every screen loads on mount and on
a manual refresh. That's fine for a soft launch, wrong for a busy kitchen.

Supabase Realtime is the right tool and needs no new infrastructure:

```ts
supabase
  .channel("orders-live")
  .on("postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      () => void load())     // refetch; do NOT try to patch state by hand
  .subscribe();
```

Three rules that prevent the usual bugs:

1. **Refetch on change, don't merge.** Patching a local list from event payloads
   drifts the moment two events race or one arrives out of order.
2. **RLS applies to Realtime too** — riders only receive their own rows. Confirm
   with the `rls_probe_as` helper in `docs/checks/auth-health.sql`, which already
   caught me out once by pretending to be a superuser.
3. **Scope the subscription** — one channel per dashboard, filtered by what that
   screen shows, or you'll broadcast the whole order book to every device.

**Separately: "track orders in real-time" for customers ≠ rider GPS.** The
customer wants `preparing → ready → picked up → arriving`. That is status
real-time, not location real-time, and it's cheap. Don't conflate the two.

---

## 8. Alerts and notifications

Rank by "would someone lose money without this?"

| Alert | Recipient | Trigger | Urgency |
|---|---|---|---|
| New order | Kitchen + Manager | `orders` insert | **Must** |
| Order ready, no rider | Manager | `ready` & unassigned > 10 min | **Must** |
| Rider overloaded | Manager | assigned stops > `max_stops` | **Must** |
| Order stuck > 60 min | Manager + Admin | cron sweep | Should |
| Delivery failed | Manager | `delivery_status = failed` | Should |
| Refund awaiting approval | Admin | `refunds` insert | Should |
| Rider idle 30 min with work nearby | Rider | cron sweep | Nice |

**Channels, cheapest first:**

1. **In-app badge** — realtime count. Free. Do this first.
2. **Web Push** — needs a service worker + VAPID keys. Works when the tab is
   closed, which matters for kitchen tablets and riders on the move.
3. **SMS** — only for riders who need it offline. Costs money per message; use
   for exceptions only.
4. **Email** — wrong medium for operations. Keep it for the customer receipt.

**The trap to avoid:** firing a notification per DB row change. Ten orders in a
minute = ten pings. Batch instead — one "6 new orders waiting" nudge.

---

## 9. What's missing in your schema, ranked

Honest list, most-consequence first:

| # | Gap | Consequence if ignored |
|---|---|---|
| 1 | **No `order_items`** | Kitchen cannot know what to cook. Orders are a total and a note. |
| 2 | **No `kitchen` role** | You cannot give cooks a safe, minimal screen — only a manager account. |
| 3 | **`deliveries.order_id` not UNIQUE** | Duplicate delivery rows on the first double-claim or retry. |
| 4 | **One blended status enum** | Can't represent "cooked but unrouted"; kitchen and dispatch fight over one field. |
| 5 | **Status transitions not enforced in DB** | Any authenticated client can walk an order backwards. UI rules are suggestions. |
| 6 | **No realtime** | Every dashboard is stale until refreshed. |
| 7 | **`DEPOT` is a placeholder** | Every distance and route line is wrong. |
| 8 | **No recovery codes for MFA** | A lost phone locks a staff member out until an admin intervenes. |

Plus, from the earlier audit and still open: SMTP unconfigured (2 emails/hour),
password minimum of 6 server-side, no CAPTCHA, audit logging disabled.

---

## 10. Build order I'd recommend

Each step is small, ships independently, and leaves the system working.

**Now — unblock operations**
1. Add `order_items` (kitchen can't function without it)
2. Add `kitchen` role + its masked, view-only policy
3. Set the real `DEPOT` coordinate

**Next — make the flow honest**
4. Split cooked vs. delivered status, keep the old enum as a rollup
5. Enforce transitions in a trigger
6. Add `UNIQUE (order_id)` on `deliveries`

**Then — make it live**
7. Realtime on the three operational screens (refetch pattern)
8. In-app badges, then Web Push

**Later — scale and resilience**
9. Rider self-claim (atomic), behind a flag
10. Stuck-order sweeps, MFA recovery codes, email/SMTP hardening

---

## 11. The two questions that decide everything

Before building any of this, answer these:

1. **Who is the bottleneck at 7pm on a Saturday?** If it's the manager assigning
   riders, build self-claim. If it's the kitchen, build the kitchen screen first.
2. **Does anyone actually need minute-accurate tracking?** If customers just want
   "it's on the way", status realtime is enough and costs a tenth of GPS.

Everything else in this document is reversible. Those two aren't.
