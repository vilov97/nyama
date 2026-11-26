# Dispatch map — route planning for managers

**Scope decision:** this is a **static planning map, not live tracking.** No
position is ever streamed, polled or stored per-second. A pin is written once
when a customer sets their drop point; the map is a planning aid that a manager
refreshes on demand.

## What the manager gets

| Capability | Where |
|---|---|
| Customer drops plotted as pins, colour-coded by direction | `/manager` → *Dispatch map* |
| Legend per direction with live order counts | map overlay, top-left |
| Click any pin → order detail + assign / reassign / remove | map → side panel |
| Per-rider run: stop count vs. cap, planned distance, load bar | side panel → *Rider runs* |
| Overload warning before you over-assign | assign button + confirm dialog |
| Dashed line per rider run in driving order (toggleable) | map |

Pins are numbered by planned stop sequence; unassigned pins show `+`.

## Data model (applied to `nyama-dev`)

```sql
-- customers' reusable drop point
alter table public.profiles
  add column drop_address text,
  add column drop_lat     double precision,
  add column drop_lng     double precision,
  add column max_stops    integer not null default 5;  -- rider cap

-- per-order pin snapshot (so history survives a profile edit)
alter table public.orders
  add column drop_lat       double precision,
  add column drop_lng       double precision,
  add column route_id       uuid references public.routes(id) on delete set null,
  add column receiver       text,
  add column receiver_phone text;

-- named directions, one colour each
create table public.routes (id, name, color, created_at);
```

Seeded directions: Karen/Langata, Westlands/Parklands, Kilimani/Kileleshwa,
Eastlands/Embakasi, CBD/Industrial Area, Kikuyu/Ngong.

`routes` has RLS on: authenticated users may read; only managers/admins write.

## Capacities and distance

- `profiles.max_stops` — per-rider cap (default 5, 1–50). Managers see
  `n of cap`; at cap the row is amber ("Full"), above cap it is red
  ("Overloaded") and assignment asks for confirmation.
- Distances are **great-circle** (`haversineKm`), sequenced nearest-neighbour
  from the depot and always including the return leg. They are a planning
  estimate, not a road distance — expect reality to be 20–40% longer in Nairobi
  traffic. Do not quote these to customers.
- Depot default: `-1.2921, 36.8219` (`DEPOT` in `src/lib/dispatch.ts`) — change
  it to the real butchery point before go-live.

## Assigning without overloading

`assign()` in `src/pages/DispatchBoard.tsx`:

- **Assign / reassign** → upsert the `deliveries` row, move the order to
  `assigned`.
- **Remove from run** → delete the `deliveries` row and park the order back to
  `ready` (only if it was still `assigned`; a `picked_up` order is left alone so
  a rider's in-progress run is never silently rewritten).
- Capacity is checked against the rider's `max_stops` **before** writing, with
  an explicit confirm when exceeded.

## Security posture (verified with a faithful JWT probe)

`public.rls_probe_as(email)` builds a real claim set (`sub`, `role`,
`app_metadata.user_role`) then switches to the `authenticated` role, so RLS
actually evaluates:

| Role | orders | customer profiles | deliveries | routes |
|---|---|---|---|---|
| manager | 10 | 2 | 5 | 6 |
| rider | 0 | 0 | 4 (own) | 6 |
| admin | all | all | all | 6 |

Riders cannot enumerate orders or customers — dispatch data stays manager-side.

> **Harness caveat:** the Supabase SQL connector runs as `postgres`
> (`rolbypassrls = true`). Testing RLS with only `set_config('request.jwt.claims')`
> silently bypasses every policy and produces false "leaks". Always switch role
> too — `rls_probe_as()` does this correctly.

## CSP and Leaflet

Leaflet is loaded from `unpkg.com` at runtime rather than bundled, because our
CSP forbids inline `<style>`/`<script>`. `vercel.json` therefore allows
`https://unpkg.com` in `script-src` and `style-src`, and `img-src` includes
`blob:`. Pins are CSS-drawn `divIcon`s, so no marker images need whitelisting.
Tiles come from `openstreetmap.org` (already covered by `img-src https:`).

If you later self-host Leaflet under `/vendor/leaflet/`, drop `unpkg.com` from
the CSP — that is the tighter configuration and worth doing before production.

## Tests

`src/lib/dispatch.test.ts` — 18 tests: haversine symmetry/zero-distance,
nearest-neighbour determinism, never-worse-than-input ordering, return-leg
inclusion, capacity thresholds (including a zero/missing cap), metre/km
formatting and colour validation.

`src/pages/DispatchBoard.test.tsx` — 4 jsdom render tests against a chainable
Supabase stub that honours `.eq()` filters: the no-tracking promise, the
per-direction legend, rider-run capacity readout, and the unassigned list.

Total suite: 37 tests (`npm test`).
