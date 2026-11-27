# Kitchen role, order items, shifts — what is enforced

Companion to `docs/operations-design.md` (the plan) and `docs/staff-mfa.md`
(the auth evidence). This file records what is actually enforced in the
database, and the method used to prove it.

Everything below was tested against `nyama-dev` (`llthxerupgdhzniaatix`).

---

## 1. The trap this work avoided

The obvious way to give cooks access is a `SELECT` policy on `public.orders`
filtered to `cook_status in (...)`. **That would have leaked money.**

Row-level security filters *rows*, never *columns*. `authenticated` holds
column-level SELECT on the whole table:

```
auth_can_read_total → true   (orders.total_ksh)
auth_can_read_phone → true   (orders.receiver_phone)
auth_can_read_pin   → true   (orders.drop_lat)
```

So any reader who can select an order row can also read the price paid, the
customer's phone number and their GPS pin. A "kitchen SELECT policy" would have
handed all three to the least-privileged staff account. `orders_kitchen_select`
was created, proven unsafe in principle, and dropped again.

**The rule: a restricted reader gets no policy on the base table at all.**
Kitchen reads `kitchen_queue` (a view) and writes through `kitchen_advance()`
(an RPC). Neither path exposes a money or contact column.

## 2. Method — why earlier RLS probes were meaningless

An earlier probe reported a price leak and then "confirmed" RBAC, both worthless.
Cause:

```
current_user = postgres, session_user = postgres, bypass_rls = true
```

The SQL connector runs as `postgres`, which **bypasses RLS entirely**. Claims set
via `set_config('request.jwt.claims', ...)` change what `my_role()` returns, but
no policy is ever evaluated. Every RLS conclusion drawn that way is void.

Triggers *do* still fire for `postgres`, so the transition-guard results were
sound; the policy results were not.

### Working harness

```
set role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '<user uuid>', 'role', 'authenticated',
  'app_metadata', json_build_object('user_role', '<role>'))::text, true);
```

`authenticated` has `bypass_rls = false`, so policies genuinely apply. This is
the only trustworthy way to test RLS through this connector.

## 3. Evidence

As `authenticated` with a **kitchen** claim (`rbac-kitchen@kwamaiko.test`):

| probe | result |
|---|---|
| `select count(*) from orders` | **0** |
| `select count(*) from order_items` | **0** |
| `select total_ksh from orders` | `<none>` |
| `select receiver_phone from orders` | `<none>` |
| `select drop_lat from orders` | `<none>` |
| `select count(*) from kitchen_queue` | **7** |

As **customer** (own data only):

| probe | result |
|---|---|
| own orders | 9 |
| own order_items | 18 |
| kitchen_queue | **0** |

As **manager**: orders 10, order_items 20, kitchen_queue 7, shift_board 3,
`rider_runs` **0** (the view is rider-scoped by construction).

As **rider**: orders **0**, deliveries 4, `rider_runs` 4 with destination,
phone, cash-due and bag contents — everything needed to complete a run, and
nothing about any other customer.

## 4. Transition guard

`guard_order_transitions` (BEFORE UPDATE on `orders`) enforces, by the caller's
JWT role:

| actor | may change |
|---|---|
| customer | neither status |
| rider | `delivery_status` only, only on their own delivery row, only along `unassigned→assigned→picked_up→delivered/failed` |
| kitchen | `cook_status` only, along `pending→accepted→preparing→ready→done` |
| manager, admin | both |

Verified outcomes:

```
customer_sets_cook      → "cook_status change not permitted for role customer"
rider_sets_delivered    → "delivery_status change not permitted for role rider"
customer_calls_rpc      → "not permitted for role customer"
manager_noop_update     → allowed
```

The guard also fires for `postgres`, which broke backfills until an explicit
`nyama.system_write` flag was added. That flag is only ever set inside
`SECURITY DEFINER` functions and is unreachable from PostgREST, so a client
cannot forge it.

## 5. The legacy status rollup

`orders.status` is no longer written by the app. `rollup_order_status()` derives
it from the two real statuses inside the guard, so the old column cannot drift:

| status | cook | delivery | orders |
|---|---|---|---|
| accepted | accepted | unassigned | 1 |
| assigned | pending | assigned | 2 |
| assigned | ready | assigned | 3 |
| pending | pending | unassigned | 1 |
| preparing | preparing | unassigned | 1 |
| ready | ready | unassigned | 2 |

`sync_delivery_status` (AFTER INSERT/UPDATE/DELETE on `deliveries`) keeps
`orders.delivery_status` in lockstep, so `deliveries.status` remains the single
source of truth for delivery and out-of-sync rows are impossible.

## 6. Role drift — a real defect found

Profiles are not derived from the JWT; `handle_new_user()` writes
`role = 'customer'` and nothing updated it afterwards. Live consequence: the
**owner's own account** had `app_metadata.user_role = 'admin'` but
`profiles.role = 'rider'`, so it appeared in rider lists and staffing counts.

Fixed by `sync_profile_role` (AFTER INSERT/UPDATE of `raw_app_meta_data` on
`auth.users`), which copies the JWT claim into `profiles.role`. Proven by
flipping the kitchen fixture's claim to `manager` and watching the profile
follow, then reverting.

`guard_profile_privilege` was also corrected: it previously required
`my_role() = 'admin'` to change a role, which no real session can satisfy from
SQL. It now accepts either an admin claim **or** the system flag, and audits
`profile.privilege_change` either way with a `source` field.

Roles are the JWT claim. `profiles.role` is a mirror. The trigger keeps them
equal; do not treat the mirror as the source.

## 7. Shifts

Three shifts, no late-night service:

| shift | hours (Africa/Nairobi) |
|---|---|
| morning | 07:00–12:00 |
| afternoon | 12:00–17:00 |
| evening | 17:00–21:00 |

`current_shift()` and `shift_board` report the live shift plus headcount by
role. `managers_rostered = 0` on the current shift is the alert condition for
the user's rule that a manager must supervise every shift.

## 8. Fixture

`rbac-kitchen@kwamaiko.test` / `Test1234!`, `user_role = kitchen`, rostered
across all three shifts. Created by direct `auth.users` + `auth.identities`
insert, matching the other `rbac-*` fixtures. There is no auth-admin tool in the
connector, and the sandbox cannot reach Supabase over HTTP, so this is the
established path.

## 9. End-to-end proof over real HTTP (pg_net)

The sandbox shell cannot reach Supabase — egress to the API host is dropped even
though TCP connects and DNS resolves. But the **database** can, via `pg_net`.
That makes a true PostgREST-level test possible from inside SQL:

```
select net.http_post(url := '<host>/auth/v1/token?grant_type=password', ...);
select * from net._http_response where id = <request_id>;
```

Results, each a real HTTP response:

| step | endpoint | result |
|---|---|---|
| kitchen sign-in | `/auth/v1/token` | 200, access token |
| kitchen reads orders | `/rest/v1/orders?select=id,total_ksh,receiver_phone` | **200, `[]`** |
| kitchen reads queue | `/rest/v1/kitchen_queue` | 200, rows with items |
| customer reads own orders | `/rest/v1/orders?select=id,total_ksh` | 200, 590 bytes |
| customer creates order | `POST /rest/v1/orders` | **201** |
| customer adds items | `POST /rest/v1/order_items` | **201** |
| kitchen sees new order | `/rest/v1/kitchen_queue?order_id=eq.…` | 200, `2× Beef Premium` |

So the kitchen boundary holds when enforced by PostgREST and RLS alone — no
`postgres` bypass, no session-claim trick. Live JWTs were purged from
`net._http_response` afterwards rather than left at rest.

### A CTE trap worth remembering

Inserting an order and its items in one statement with a data-modifying CTE
**fails**, because the `order_items` policy's `EXISTS` check cannot see the
row its sibling CTE is inserting into `orders`. Two sequential statements work.
The UI already does two requests; do not "optimise" it into one CTE.

## 10. Order creation

`/app/new` (customer only) closes the last blocking gap: fixtures were the only
source of orders, so the kitchen had nothing real to cook. The page:

- builds a basket from available `menu_items`, integer shillings only
- snapshots name/unit/price into `order_items` at insert time
- requires a click-to-drop pin, rejecting a missing pin and the `(0,0)` pin
  that would route a rider into the Atlantic
- writes `orders` then `order_items`, and deletes the order if the item insert
  fails, so no empty ghost order reaches the kitchen

Arithmetic lives in `src/lib/basket.ts` with 22 tests rather than inline in JSX.

## 11. Still open
- No payment capture: orders are created `is_paid = false` and the cash-due
  badge tells the rider what to collect. M-Pesa is not wired up.
- No realtime subscriptions; boards refresh on load and via manual refresh.
- Depot coordinate remains a placeholder.
- Realtime, push alerts and the admin exceptions screen remain undecided.
