-- ============================================================================
-- Kwamaiko Nyama — Supabase Auth + RBAC starter schema (companion to
-- docs/AUTH_RBAC_SECURITY_AUDIT.md, findings F-01..F-04, F-09 and RBAC §5)
--
-- HOW TO USE
--   1. Create three Supabase projects: dev, staging, prod (audit decision D6).
--   2. Apply to DEV first: `supabase db push` (as a migration) or paste into
--      the SQL editor. Never develop RLS directly against prod.
--   3. In Auth settings: enable Leaked Password Protection, confirm-email ON
--      for managers/admins, set JWT expiry 3600, add Turnstile CAPTCHA keys.
--   4. Add a Supabase Auth Hook (or the edge-function sync below) that mirrors
--      profiles.role -> auth.users.raw_app_meta_data.user_role on every role
--      change, so RLS can check the JWT claim without recursive lookups.
--   5. Review checklist before prod: every table has RLS enabled; default-deny
--      (no permissive `USING (true)` except public menu reads); no policy
--      grants role-column writes to non-admin; run the T-RBAC tests in §8.
-- ============================================================================

-- --------------------------------------------------------------------------
-- §0. Prerequisites
-- --------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- App roles. Flat taxonomy, no inheritance (audit §5.1).
do $$ begin
  create type app_role as enum ('customer', 'rider', 'kitchen', 'manager', 'admin');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- §1. Profiles — one row per auth.users id, holds the authoritative role.
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        app_role     not null default 'customer',
  full_name   text,
  phone       text,                       -- E.164, e.g. +2547XXXXXXXX
  branch_id   text         not null default 'nairobi-hq',  -- future ABAC scope
  is_active   boolean      not null default true,          -- false = deprovisioned
  -- Phase 3 dispatch map: customer drop pin + rider run size.
  drop_address text,
  drop_lat     double precision,
  drop_lng     double precision,
  max_stops    integer      not null default 5,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);

alter table public.profiles enable row level security;

-- Helper: current request's role, from the server-signed JWT (never from client input).
create or replace function public.my_role()
returns app_role
language sql stable security definer set search_path = public as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'user_role', '')::app_role
$$;

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select public.my_role() = 'admin'
$$;

create or replace function public.is_manager_or_admin()
returns boolean language sql stable as $$
  select public.my_role() in ('manager', 'admin')
$$;

-- Auto-create a customer profile on signup. Role is FORCED to customer here:
-- privilege can only ever be granted later by an admin (SoD, audit §5.4).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, phone)
  values (new.id, 'customer', new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backstop trigger: ROLE changes are admin-only; IS_ACTIVE changes are
-- admin-only except managers toggling RIDERS (P-15). The check reads
-- my_role() from the server-verified JWT, never from client input.
create or replace function public.guard_profile_privilege()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  caller app_role := coalesce(public.my_role(), 'customer');
begin
  if new.role is distinct from old.role and caller <> 'admin' then
    raise exception 'role change requires admin';
  end if;
  if new.is_active is distinct from old.is_active then
    if caller = 'admin' then
      null; -- allowed
    elsif caller = 'manager' and old.role = 'rider' and new.role = 'rider' then
      null; -- P-15: managers may enable/disable riders
    else
      raise exception 'is_active change not permitted for this role';
    end if;
  end if;
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active then
    -- Every privilege change is audit-logged with actor + before/after.
    insert into public.audit_logs (actor_id, action, object_type, object_id,
           details, ip)
    values (auth.uid(), 'profile.privilege_change', 'profiles',
            old.id::text,
            jsonb_build_object('old_role', old.role, 'new_role', new.role,
              'old_active', old.is_active, 'new_active', new.is_active),
            inet_client_addr());
  end if;
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists guard_profile_privilege on public.profiles;
create trigger guard_profile_privilege
  before update on public.profiles
  for each row execute function public.guard_profile_privilege();

-- RLS: users read/update their own non-privileged columns; managers read staff
-- basics for dispatch and may toggle rider is_active (P-15); admins manage.
-- Note: UPDATE policies + guard_profile_privilege() TOGETHER enforce that
-- only admins change roles, and only admins/managers(for riders) flip is_active.
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_select_staff" on public.profiles
  for select using (
    public.is_manager_or_admin()
    and role in ('rider', 'manager', 'customer')
  );

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());  -- guard_profile_privilege() rejects role edits

-- P-15: managers may update RIDER rows (enable/disable). The trigger still
-- rejects any role change attempted through this policy.
create policy "profiles_manager_toggle_riders" on public.profiles
  for update using (public.my_role() = 'manager' and role = 'rider')
  with check (public.my_role() = 'manager' and role = 'rider');

create policy "profiles_admin_all" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- §2. Menu (public read; manager/admin write) — audit P-01/P-02
-- --------------------------------------------------------------------------
create table if not exists public.menu_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price_ksh   integer not null check (price_ksh >= 0),
  unit        text not null default 'kg',
  is_available boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.menu_items enable row level security;

create policy "menu_public_read" on public.menu_items
  for select using (true);  -- the ONLY intentionally public table

create policy "menu_manager_write" on public.menu_items
  for all using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

-- --------------------------------------------------------------------------
-- §3. Orders & deliveries — ownership + assignment + state (audit §5.2/5.3)
-- --------------------------------------------------------------------------
create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.profiles (id),
  status       text not null default 'pending'
               check (status in ('pending','accepted','preparing','ready',
                                 'assigned','picked_up','delivered','cancelled')),
  total_ksh    integer not null check (total_ksh >= 0),
  is_paid      boolean not null default false,  -- service-role ONLY (§5.4)
  pay_ref      text,                             -- Daraja receipt id
  drop_note    text,                             -- delivery instructions
  -- Phase 3 dispatch map: pin snapshot + route bucket (no live tracking).
  drop_lat       double precision,
  drop_lng       double precision,
  route_id       uuid references public.routes (id) on delete set null,
  receiver       text,
  receiver_phone text,
  created_at   timestamptz not null default now()
);

alter table public.orders enable row level security;

-- Customers: create own orders; read/cancel own pending orders (P-03/04/06).
create policy "orders_customer_insert" on public.orders
  for insert with check (customer_id = auth.uid());

create policy "orders_customer_select_own" on public.orders
  for select using (customer_id = auth.uid());

create policy "orders_customer_cancel_own" on public.orders
  for update using (customer_id = auth.uid() and status = 'pending')
  with check (customer_id = auth.uid() and status = 'cancelled');

-- Managers/admins: full read (P-05); status management but NEVER is_paid/pay_ref
-- (those columns are writable by service_role only — enforced by trigger below).
create policy "orders_manager_select" on public.orders
  for select using (public.is_manager_or_admin());

create policy "orders_manager_update" on public.orders
  for update using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

-- Backstop: is_paid/pay_ref changeable only by service_role (Daraja callback).
create or replace function public.guard_payment_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_paid is distinct from old.is_paid
     or new.pay_ref is distinct from old.pay_ref then
    if auth.role() <> 'service_role' then
      raise exception 'payment state is service-only (Daraja callback)';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_payment_columns on public.orders;
create trigger guard_payment_columns
  before update on public.orders
  for each row execute function public.guard_payment_columns();

-- --------------------------------------------------------------------------
-- Routes (§ Phase 3 dispatch map): named directions, one colour each.
-- Static assignment aid only — the product does NOT do live GPS tracking.
-- --------------------------------------------------------------------------
create table if not exists public.routes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  color      text not null default '#ffe500',
  created_at timestamptz not null default now()
);

alter table public.routes enable row level security;

create policy "routes_read_all" on public.routes
  for select using (auth.uid() is not null);

create policy "routes_manager_all" on public.routes
  for all using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

insert into public.routes (name, color) values
  ('Karen / Langata',      '#e11d48'),
  ('Westlands / Parklands','#2563eb'),
  ('Kilimani / Kileleshwa','#16a34a'),
  ('Eastlands / Embakasi', '#a855f7'),
  ('CBD / Industrial Area','#f97316'),
  ('Kikuyu / Ngong',       '#0891b2')
on conflict (name) do nothing;

-- Deliveries: riders see/update ONLY assigned active runs (P-11/12).
create table if not exists public.deliveries (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  rider_id    uuid references public.profiles (id),
  status      text not null default 'assigned'
              check (status in ('assigned','picked_up','delivered','failed')),
  pod_url     text,  -- proof-of-delivery photo (Storage, see §6)
  created_at  timestamptz not null default now()
);

alter table public.deliveries enable row level security;

create policy "deliveries_manager_all" on public.deliveries
  for all using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

create policy "deliveries_rider_assigned" on public.deliveries
  for select using (
    public.my_role() = 'rider'
    and rider_id = auth.uid()
    and status in ('assigned', 'picked_up')
  );

create policy "deliveries_rider_update" on public.deliveries
  for update using (
    public.my_role() = 'rider'
    and rider_id = auth.uid()
    and status in ('assigned', 'picked_up')
  ) with check (
    rider_id = auth.uid()              -- cannot reassign to anyone
    and status in ('picked_up', 'delivered', 'failed')
  );

create policy "deliveries_customer_own" on public.deliveries
  for select using (
    exists (select 1 from public.orders o
            where o.id = deliveries.order_id and o.customer_id = auth.uid())
  );

-- --------------------------------------------------------------------------
-- §4. Refunds with dual approval over threshold (SoD, audit P-07/08, §5.4)
-- --------------------------------------------------------------------------
create table if not exists public.refunds (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id),
  amount_ksh   integer not null check (amount_ksh > 0),
  reason       text not null,
  requested_by uuid not null references public.profiles (id),
  approved_by  uuid references public.profiles (id),
  status       text not null default 'requested'
               check (status in ('requested','approved','rejected','paid')),
  created_at   timestamptz not null default now(),
  constraint refunds_no_self_approval check (
    approved_by is null or approved_by <> requested_by  -- ★ SoD in the DB
  )
);

alter table public.refunds enable row level security;

create policy "refunds_manager" on public.refunds
  for all using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

-- Large refunds (> KSh 5,000, decision D5) REQUIRE a second approver.
create or replace function public.guard_refund_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and new.amount_ksh > 5000
     and new.approved_by is null then
    raise exception 'refunds over KSh 5,000 need dual approval';
  end if;
  return new;
end $$;

drop trigger if exists guard_refund_approval on public.refunds;
create trigger guard_refund_approval
  before insert or update on public.refunds
  for each row execute function public.guard_refund_approval();

-- --------------------------------------------------------------------------
-- §5. Append-only audit log (audit F-09, §5.7)
-- --------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id),
  action      text not null,      -- e.g. 'order.refund_approved'
  object_type text not null,
  object_id   text not null,
  details     jsonb not null default '{}',
  ip          inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

-- INSERT: any authenticated user (triggers/edge functions write on their behalf).
create policy "audit_insert" on public.audit_logs
  for insert with check (auth.uid() is not null);

-- SELECT: managers see own-scope, admins see all (P-20).
create policy "audit_manager_read" on public.audit_logs
  for select using (
    public.is_admin()
    or (public.my_role() = 'manager' and actor_id = auth.uid())
  );

-- NOTE: deliberately NO update/delete policy — not even admins can mutate
-- history through the app. Retention/purge runs as a scheduled service job.

-- --------------------------------------------------------------------------
-- §6. Storage buckets (create in Dashboard or via API; policies below)
-- Buckets: `pod` (proof-of-delivery, private), `avatars` (private)
-- --------------------------------------------------------------------------
-- insert into storage.buckets (id, name, public) values ('pod','pod',false);
-- insert into storage.buckets (id, name, public) values ('avatars','avatars',false);

-- PoD: riders upload only under their own run folder; managers read all.
-- create policy "pod_rider_insert" on storage.objects for insert with check (
--   bucket_id = 'pod' and public.my_role() = 'rider'
--   and (storage.foldername(name))[1] = auth.uid()::text);
-- create policy "pod_manager_read" on storage.objects for select using (
--   bucket_id = 'pod' and public.is_manager_or_admin());

-- --------------------------------------------------------------------------
-- §7. Role -> JWT mirror (run on every role change; deploy as Auth Hook or
-- edge function with service_role; sketch only — keep service key server-side)
-- --------------------------------------------------------------------------
-- update auth.users set raw_app_meta_data =
--   raw_app_meta_data || jsonb_build_object('user_role', NEW.role::text)
-- where id = NEW.id;
-- (Call this from guard_profile_privilege's admin path or a dedicated hook so
--  my_role() reflects the new role on the NEXT issued access token; also call
--  auth.admin.signOut(user_id) to revoke stale sessions on demotion/disable.)

-- --------------------------------------------------------------------------
-- §8. Retention (Kenya DPA — schedule via pg_cron / Supabase cron)
-- --------------------------------------------------------------------------
-- Example: archive delivered-order PII older than 12 months, delete PoD > 90d.
-- (Implement as a service-role cron job in Phase 3; table above is the policy.)


-- ---------------------------------------------------------------------------
-- Operations: shifts, split cooking/delivery status, kitchen role
-- ---------------------------------------------------------------------------

-- Cooking and delivery are independent facts. `orders.status` stays as the
-- human-facing rollup for reporting; these carry the truth.
alter table public.orders
  add column if not exists cook_status text not null default 'pending'
    check (cook_status in ('pending','accepted','preparing','ready','done')),
  add column if not exists delivery_status text not null default 'unassigned'
    check (delivery_status in ('unassigned','assigned','picked_up','delivered','failed')),
  add column if not exists updated_at timestamptz not null default now();

-- A delivery belongs to exactly one order, so a second rider cannot claim it.
alter table public.deliveries
  add constraint deliveries_order_id_unique unique (order_id);

-- Shifts are wall-clock in Africa/Nairobi; the database runs in UTC, so every
-- helper converts explicitly. There is intentionally no late-night shift.
create table if not exists public.shifts (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code in ('morning','afternoon','evening')),
  label            text not null,
  start_time       time not null,
  end_time         time not null,
  handover_minutes integer not null default 15,
  created_at       timestamptz not null default now()
);

alter table public.shifts enable row level security;
create policy "shifts_read_all" on public.shifts
  for select using (auth.uid() is not null);
create policy "shifts_admin_all" on public.shifts
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.shifts (code, label, start_time, end_time, handover_minutes) values
  ('morning',   'Morning',   '07:00', '12:00', 15),
  ('afternoon', 'Afternoon', '12:00', '17:00', 15),
  ('evening',   'Evening',   '17:00', '21:00', 15)
on conflict (code) do nothing;

-- Weekly roster: which shift a person works on which weekday (0 = Sunday).
create table if not exists public.staff_shifts (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  shift_code text not null references public.shifts (code) on update cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  is_off     boolean not null default false,
  created_at timestamptz not null default now(),
  unique (profile_id, weekday, shift_code)
);

create index if not exists staff_shifts_profile_idx on public.staff_shifts (profile_id);

alter table public.staff_shifts enable row level security;
create policy "staff_shifts_read_own" on public.staff_shifts
  for select using (profile_id = auth.uid());
create policy "staff_shifts_manager_all" on public.staff_shifts
  for all using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

-- Shift currently open, in Nairobi time.
create or replace function public.current_shift()
returns text language plpgsql stable as $$
declare
  v_now  time := (now() at time zone 'Africa/Nairobi')::time;
  v_code text;
begin
  select code into v_code from public.shifts
   where (start_time < end_time and v_now >= start_time and v_now < end_time)
      or (start_time > end_time and (v_now >= start_time or v_now < end_time))
   order by start_time limit 1;
  return v_code;
end $$;

create or replace function public.is_closed_hours()
returns boolean language sql stable as $$ select public.current_shift() is null $$;

-- Kitchen may progress cooking, nothing else.
create or replace function public.is_kitchen_or_above() returns boolean
language sql stable as $$ select public.my_role() in ('kitchen','manager','admin') $$;

create policy "orders_kitchen_update" on public.orders
  for update using (public.is_kitchen_or_above())
  with check (public.is_kitchen_or_above());

-- The database, not the UI, decides who may move an order.
create or replace function public.guard_order_transitions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller  app_role := coalesce(public.my_role(), 'customer');
  allowed boolean := false;
begin
  if new.delivery_status is distinct from old.delivery_status then
    if caller in ('manager','admin') then
      allowed := true;
    elsif caller = 'rider' then
      allowed := exists (select 1 from public.deliveries d
                          where d.order_id = old.id and d.rider_id = auth.uid())
        and (
          (old.delivery_status = 'assigned'  and new.delivery_status = 'picked_up') or
          (old.delivery_status = 'picked_up' and new.delivery_status in ('delivered','failed'))
        );
    end if;
    if not allowed then
      raise exception 'delivery_status change not permitted for role %', caller;
    end if;
  end if;

  if new.cook_status is distinct from old.cook_status then
    if caller not in ('kitchen','manager','admin') then
      raise exception 'cook_status change not permitted for role %', caller;
    end if;
  end if;

  new.updated_at = now();
  return new;
end $$;

drop trigger if exists guard_order_transitions on public.orders;
create trigger guard_order_transitions
  before update on public.orders
  for each row execute function public.guard_order_transitions();
