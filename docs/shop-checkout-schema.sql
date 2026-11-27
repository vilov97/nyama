-- =============================================================================
-- Shop, checkout and order timing
-- Applied to nyama-dev as two migrations, in this order:
--   shop_catalogue_settings_and_order_fields   (sections 1-4 of this file)
--   place_order_slots_and_role_write_paths     (sections 5-9 of this file)
--
-- What this adds
--   1. Catalogue fields on menu_items (category, image, sort order).
--   2. shop_settings (one row) and delivery_windows (six, two per shift).
--   3. Order fields: delivery or pickup, fee, due window, substitution rule,
--      street address, note for the kitchen.
--   4. place_order(): the ONLY way to create an order. Prices and the fee are
--      read from the database, never from the browser.
--   5. rider_advance(): riders finish a run through an RPC.
--   6. kitchen_queue / rider_runs rebuilt with due times.
--
-- Three defects this closes (each reproduced before the change):
--   a. A customer could POST /orders with total_ksh = 1. The INSERT policy only
--      checked customer_id. Direct inserts are now removed.
--   b. A rider could not mark a run delivered or failed: 42501. Postgres applies
--      SELECT policies to the row AFTER an update, and the rider's SELECT policy
--      only admits 'assigned' and 'picked_up'.
--   c. rollup_order_status() could return 'failed', which orders_status_check
--      rejected.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catalogue
-- ---------------------------------------------------------------------------
alter table public.menu_items
  add column if not exists category   text    not null default 'other',
  add column if not exists image_url  text,
  add column if not exists sort_order integer not null default 100;

update public.menu_items set category = 'goat',     sort_order = 10, image_url = '/menu/goat-choma-cut.jpg' where name = 'Goat Choma Cut';
update public.menu_items set category = 'goat',     sort_order = 20, image_url = '/menu/goat-ribs.jpg'      where name = 'Goat Ribs';
update public.menu_items set category = 'goat',     sort_order = 30, image_url = '/menu/whole-goat.jpg'     where name = 'Whole Goat';
update public.menu_items set category = 'goat',     sort_order = 40, image_url = '/menu/goat-soup-pack.jpg' where name = 'Goat Soup Pack';
update public.menu_items set category = 'beef',     sort_order = 10, image_url = '/menu/beef-premium.jpg'   where name = 'Beef Premium';
update public.menu_items set category = 'beef',     sort_order = 20, image_url = '/menu/beef-strips.jpg'    where name = 'Beef Strips';
update public.menu_items set category = 'chicken',  sort_order = 10, image_url = '/menu/chicken.jpg'        where name = 'Chicken';
update public.menu_items set category = 'platters', sort_order = 10, image_url = '/menu/mixed-grill.jpg'    where name = 'Mixed Grill';

-- ---------------------------------------------------------------------------
-- 2. Settings and delivery windows
-- ---------------------------------------------------------------------------
create table if not exists public.shop_settings (
  id               boolean primary key default true check (id),
  delivery_fee_ksh integer not null default 200 check (delivery_fee_ksh >= 0),
  asap_minutes     integer not null default 90  check (asap_minutes between 15 and 480),
  pickup_minutes   integer not null default 45  check (pickup_minutes between 10 and 480),
  days_ahead       integer not null default 6   check (days_ahead between 0 and 30),
  updated_at       timestamptz not null default now()
);
insert into public.shop_settings (id) values (true) on conflict (id) do nothing;

alter table public.shop_settings enable row level security;
drop policy if exists shop_settings_read on public.shop_settings;
create policy shop_settings_read on public.shop_settings for select using (true);
drop policy if exists shop_settings_admin_update on public.shop_settings;
create policy shop_settings_admin_update on public.shop_settings
  for update using (public.is_admin()) with check (public.is_admin());
revoke all on public.shop_settings from anon, authenticated;
grant select on public.shop_settings to anon, authenticated;
grant update on public.shop_settings to authenticated;

-- Every window sits inside exactly one shift, so every scheduled order belongs
-- to exactly one manager on duty.
create table if not exists public.delivery_windows (
  code       text primary key,
  shift_code text not null references public.shifts (code),
  start_time time not null,
  end_time   time not null,
  capacity   integer not null default 12 check (capacity >= 0),
  is_active  boolean not null default true,
  check (start_time < end_time)
);
insert into public.delivery_windows (code, shift_code, start_time, end_time) values
  ('m1', 'morning',   '08:00', '10:00'),
  ('m2', 'morning',   '10:00', '12:00'),
  ('a1', 'afternoon', '12:00', '14:30'),
  ('a2', 'afternoon', '14:30', '17:00'),
  ('e1', 'evening',   '17:00', '19:00'),
  ('e2', 'evening',   '19:00', '21:00')
on conflict (code) do nothing;

alter table public.delivery_windows enable row level security;
drop policy if exists delivery_windows_read on public.delivery_windows;
create policy delivery_windows_read on public.delivery_windows for select using (true);
drop policy if exists delivery_windows_manager_update on public.delivery_windows;
create policy delivery_windows_manager_update on public.delivery_windows
  for update using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());
revoke all on public.delivery_windows from anon, authenticated;
grant select on public.delivery_windows to anon, authenticated;
grant update on public.delivery_windows to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Order fields
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists fulfilment       text    not null default 'delivery',
  add column if not exists subtotal_ksh     integer,
  add column if not exists delivery_fee_ksh integer not null default 0,
  add column if not exists due_from         timestamptz,
  add column if not exists due_by           timestamptz,
  add column if not exists is_scheduled     boolean not null default false,
  add column if not exists window_code      text references public.delivery_windows (code),
  add column if not exists substitution     text    not null default 'call_me',
  add column if not exists drop_address     text,
  add column if not exists kitchen_note     text;

-- The backfill is a system write: the transition guard must not judge it.
select set_config('nyama.system_write', 'on', false);
update public.orders
   set subtotal_ksh = coalesce(subtotal_ksh, total_ksh),
       due_from     = coalesce(due_from, created_at),
       due_by       = coalesce(due_by, created_at + interval '90 minutes');
select set_config('nyama.system_write', 'off', false);

alter table public.orders
  alter column subtotal_ksh set not null,
  alter column due_from set not null,
  alter column due_from set default now(),
  alter column due_by set not null,
  alter column due_by set default now() + interval '90 minutes';

alter table public.orders drop constraint if exists orders_fulfilment_check;
alter table public.orders add constraint orders_fulfilment_check
  check (fulfilment in ('delivery', 'pickup'));
alter table public.orders drop constraint if exists orders_substitution_check;
alter table public.orders add constraint orders_substitution_check
  check (substitution in ('call_me', 'best_match', 'leave_out'));
alter table public.orders drop constraint if exists orders_money_check;
alter table public.orders add constraint orders_money_check
  check (subtotal_ksh >= 0 and delivery_fee_ksh >= 0 and total_ksh = subtotal_ksh + delivery_fee_ksh);
alter table public.orders drop constraint if exists orders_due_check;
alter table public.orders add constraint orders_due_check check (due_by > due_from);

-- Defect (c): the rollup can produce 'failed'; pickup adds 'collected'.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up',
                    'delivered', 'failed', 'collected', 'cancelled'));

create index if not exists orders_due_by_idx on public.orders (due_by);

-- ---------------------------------------------------------------------------
-- 4. Status rollup, now aware of pickup
-- ---------------------------------------------------------------------------
drop function if exists public.rollup_order_status(text, text);
create or replace function public.rollup_order_status(p_cook text, p_delivery text, p_fulfilment text)
returns text language sql immutable as $$
  select case
    when p_fulfilment = 'pickup' and p_cook = 'done' then 'collected'
    when p_delivery = 'delivered' then 'delivered'
    when p_delivery = 'failed'    then 'failed'
    when p_delivery = 'picked_up' then 'picked_up'
    when p_delivery = 'assigned'  then 'assigned'
    when p_cook in ('ready', 'done') then 'ready'
    when p_cook = 'preparing'     then 'preparing'
    when p_cook = 'accepted'      then 'accepted'
    else 'pending'
  end;
$$;

create or replace function public.guard_order_transitions()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  caller  app_role := coalesce(public.my_role(), 'customer');
  allowed boolean := false;
  sys     text := coalesce(current_setting('nyama.system_write', true), 'off');
begin
  if sys = 'on' then
    -- A cancelled order stays cancelled, whoever writes to it.
    if old.status is distinct from 'cancelled' then
      new.status = public.rollup_order_status(new.cook_status, new.delivery_status, new.fulfilment);
    end if;
    new.updated_at = now();
    return new;
  end if;

  if new.delivery_status is distinct from old.delivery_status then
    if caller in ('manager', 'admin') then
      allowed := true;
    end if;
    if not allowed then
      raise exception 'delivery_status change not permitted for role %', caller;
    end if;
  end if;

  if new.cook_status is distinct from old.cook_status then
    if caller not in ('kitchen', 'manager', 'admin') then
      raise exception 'cook_status change not permitted for role %', caller;
    end if;
  end if;

  -- Money, timing and fulfilment are fixed at checkout. Only a manager edits them.
  if caller not in ('manager', 'admin') and (
       new.total_ksh        is distinct from old.total_ksh
    or new.subtotal_ksh     is distinct from old.subtotal_ksh
    or new.delivery_fee_ksh is distinct from old.delivery_fee_ksh
    or new.fulfilment       is distinct from old.fulfilment
    or new.due_from         is distinct from old.due_from
    or new.due_by           is distinct from old.due_by
    or new.customer_id      is distinct from old.customer_id
  ) then
    raise exception 'order terms cannot be changed by role %', caller;
  end if;

  -- Cancellation is a customer/manager act; do not let a rollup resurrect it.
  if new.status is distinct from 'cancelled' then
    new.status = public.rollup_order_status(new.cook_status, new.delivery_status, new.fulfilment);
  end if;
  new.updated_at = now();
  return new;
end $$;

-- deliveries is the source of truth for the rider leg. Its own RLS and
-- rider_advance() decide who may write; the mirror onto orders is a system write.
create or replace function public.sync_delivery_status()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  prev text := coalesce(current_setting('nyama.system_write', true), 'off');
begin
  perform set_config('nyama.system_write', 'on', true);
  if tg_op = 'DELETE' then
    update public.orders set delivery_status = 'unassigned'
     where id = old.order_id and delivery_status in ('assigned', 'picked_up');
    perform set_config('nyama.system_write', prev, true);
    return old;
  end if;
  update public.orders
     set delivery_status = case new.status
                             when 'assigned'  then 'assigned'
                             when 'picked_up' then 'picked_up'
                             when 'delivered' then 'delivered'
                             when 'failed'    then 'failed'
                             else 'assigned' end
   where id = new.order_id;
  perform set_config('nyama.system_write', prev, true);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Slots and checkout options
-- ---------------------------------------------------------------------------
create or replace function public.normalize_ke_phone(p text)
returns text language sql immutable as $$
  select '+254' || m[1]
    from regexp_match(regexp_replace(coalesce(p, ''), '[\s\-()]', '', 'g'),
                      '^(?:\+?254|0)([17][0-9]{8})$') as m;
$$;

-- When an "as soon as possible" order would be due, or null if the shop is
-- closed or too close to closing to finish it.
create or replace function public.asap_due(p_fulfilment text)
returns timestamptz language sql stable security definer set search_path to 'public' as $$
  with s as (select * from public.shop_settings where id),
  t as (
    select now() + make_interval(mins => case when p_fulfilment = 'pickup'
                                              then s.pickup_minutes else s.asap_minutes end) as due,
           (((now() at time zone 'Africa/Nairobi')::date + (select max(end_time) from public.shifts))
              at time zone 'Africa/Nairobi') as closes
      from s
  )
  select case when public.current_shift() is not null and t.due <= t.closes then t.due end from t;
$$;

-- Bookable windows for the next few days. Returns counts only, never orders.
create or replace function public.delivery_slots(p_fulfilment text default 'delivery')
returns table (
  slot_date   date,
  window_code text,
  shift_code  text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  left_count  integer,
  available   boolean,
  reason      text
) language sql stable security definer set search_path to 'public' as $$
  with s as (
    select make_interval(mins => case when p_fulfilment = 'pickup'
                                      then pickup_minutes else asap_minutes end) as lead,
           days_ahead
      from public.shop_settings where id
  ),
  days as (
    select (now() at time zone 'Africa/Nairobi')::date + g as d
      from s, generate_series(0, s.days_ahead) as g
  ),
  slots as (
    select d.d as slot_date, w.code, w.shift_code, w.capacity,
           (d.d + w.start_time) at time zone 'Africa/Nairobi' as starts_at,
           (d.d + w.end_time)   at time zone 'Africa/Nairobi' as ends_at
      from days d cross join public.delivery_windows w
     where w.is_active
  ),
  booked as (
    select o.window_code, (o.due_from at time zone 'Africa/Nairobi')::date as d, count(*)::int as n
      from public.orders o
     where o.is_scheduled and o.status <> 'cancelled' and o.due_by > now()
     group by 1, 2
  )
  select sl.slot_date, sl.code, sl.shift_code, sl.starts_at, sl.ends_at,
         greatest(sl.capacity - coalesce(b.n, 0), 0),
         (now() + s.lead <= sl.ends_at) and coalesce(b.n, 0) < sl.capacity,
         case when now() + s.lead > sl.ends_at then 'too_late'
              when coalesce(b.n, 0) >= sl.capacity then 'full' end
    from slots sl
    cross join s
    left join booked b on b.window_code = sl.code and b.d = sl.slot_date
   order by sl.starts_at;
$$;

create or replace function public.checkout_options()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  s public.shop_settings;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into s from public.shop_settings where id;
  return jsonb_build_object(
    'delivery_fee_ksh', s.delivery_fee_ksh,
    'asap_minutes',     s.asap_minutes,
    'pickup_minutes',   s.pickup_minutes,
    'open_now',         public.current_shift() is not null,
    'today',            (now() at time zone 'Africa/Nairobi')::date,
    'asap', jsonb_build_object(
      'delivery', public.asap_due('delivery') is not null,
      'pickup',   public.asap_due('pickup') is not null),
    'slots', jsonb_build_object(
      'delivery', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.delivery_slots('delivery') x),
      'pickup',   (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.delivery_slots('pickup') x))
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6. place_order: the only way an order is created
-- ---------------------------------------------------------------------------
create or replace function public.place_order(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid      uuid := auth.uid();
  v_role     app_role := coalesce(public.my_role(), 'customer');
  v_fulfil   text := coalesce(p->>'fulfilment', 'delivery');
  v_when     text := coalesce(p->>'when', 'asap');
  v_sub      text := coalesce(p->>'substitution', 'call_me');
  v_receiver text := btrim(coalesce(p->>'receiver', ''));
  v_phone    text := public.normalize_ke_phone(p->>'receiver_phone');
  v_address  text := nullif(btrim(coalesce(p->>'drop_address', '')), '');
  v_note     text := nullif(btrim(coalesce(p->>'drop_note', '')), '');
  v_knote    text := nullif(btrim(coalesce(p->>'kitchen_note', '')), '');
  v_lat      double precision;
  v_lng      double precision;
  v_fee      integer := 0;
  v_subtotal integer;
  v_lines    integer;
  v_missing  text;
  v_from     timestamptz;
  v_by       timestamptz;
  v_window   text;
  v_date     date;
  v_slot     record;
  v_id       uuid;
  v_req      jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in to place an order.' using errcode = '42501';
  end if;
  if v_role <> 'customer' then
    raise exception 'Staff accounts cannot place customer orders.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and is_active) then
    raise exception 'This account cannot place orders.' using errcode = '42501';
  end if;

  if v_fulfil not in ('delivery', 'pickup') then
    raise exception 'Choose delivery or pickup.' using errcode = '22023';
  end if;
  if v_sub not in ('call_me', 'best_match', 'leave_out') then
    raise exception 'Unknown substitution choice.' using errcode = '22023';
  end if;
  if char_length(v_receiver) not between 2 and 80 then
    raise exception 'Tell us who is receiving the order.' using errcode = '22023';
  end if;
  if v_phone is null then
    raise exception 'Enter a Kenyan mobile number, for example 0712 345 678.' using errcode = '22023';
  end if;
  if coalesce(char_length(v_note), 0) > 300 or coalesce(char_length(v_knote), 0) > 300
     or coalesce(char_length(v_address), 0) > 200 then
    raise exception 'One of the notes is too long.' using errcode = '22023';
  end if;

  -- Where
  if v_fulfil = 'delivery' then
    v_lat := (p->>'drop_lat')::double precision;
    v_lng := (p->>'drop_lng')::double precision;
    if v_lat is null or v_lng is null or (v_lat = 0 and v_lng = 0)
       or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      raise exception 'Drop your pin on the map.' using errcode = '22023';
    end if;
    if v_address is null or char_length(v_address) < 3 then
      raise exception 'Add the street, building or house.' using errcode = '22023';
    end if;
    select delivery_fee_ksh into v_fee from public.shop_settings where id;
  else
    v_address := null;
    v_note := null;
  end if;

  -- When
  if v_when = 'asap' then
    v_by := public.asap_due(v_fulfil);
    if v_by is null then
      raise exception 'We cannot finish an order before closing. Pick a time slot instead.'
        using errcode = '22023';
    end if;
    v_from := now();
  elsif v_when = 'scheduled' then
    v_date   := (p->>'slot_date')::date;
    v_window := p->>'window_code';
    -- One booking at a time per slot, so capacity cannot be oversold.
    perform pg_advisory_xact_lock(hashtext('slot:' || v_date::text || ':' || coalesce(v_window, '')));
    select * into v_slot from public.delivery_slots(v_fulfil) s
     where s.slot_date = v_date and s.window_code = v_window;
    if not found then
      raise exception 'That time slot does not exist.' using errcode = '22023';
    end if;
    if not v_slot.available then
      raise exception 'That time slot is %.',
        case v_slot.reason when 'full' then 'full' else 'no longer open' end
        using errcode = '22023';
    end if;
    v_from := v_slot.starts_at;
    v_by   := v_slot.ends_at;
  else
    raise exception 'Choose when you want the order.' using errcode = '22023';
  end if;

  -- What: prices come from menu_items, not from the request.
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Your cart is empty.' using errcode = '22023';
  end if;
  if jsonb_array_length(p->'items') > 40 then
    raise exception 'Too many lines in one order.' using errcode = '22023';
  end if;

  -- Merge duplicate lines, then price them from the catalogue.
  select jsonb_agg(jsonb_build_object('id', x.id, 'qty', x.qty, 'note', x.note)) into v_req
    from (select (e->>'menu_item_id')::uuid as id,
                 sum((e->>'qty')::integer)::integer as qty,
                 max(nullif(btrim(e->>'note'), '')) as note
            from jsonb_array_elements(p->'items') e
           group by 1) x;

  if exists (select 1 from jsonb_to_recordset(v_req) as r(id uuid, qty integer, note text)
              where r.id is null or r.qty is null or r.qty < 1 or r.qty > 99) then
    raise exception 'Quantities must be between 1 and 99.' using errcode = '22023';
  end if;

  select string_agg(coalesce(m.name, 'an item we no longer sell'), ', ') into v_missing
    from jsonb_to_recordset(v_req) as r(id uuid, qty integer, note text)
    left join public.menu_items m on m.id = r.id
   where m.id is null or not m.is_available;
  if v_missing is not null then
    raise exception 'No longer available: %. Remove it to continue.', v_missing
      using errcode = '22023';
  end if;

  select sum(r.qty * m.price_ksh)::integer, count(*)::integer into v_subtotal, v_lines
    from jsonb_to_recordset(v_req) as r(id uuid, qty integer, note text)
    join public.menu_items m on m.id = r.id;

  insert into public.orders (
    customer_id, status, total_ksh, subtotal_ksh, delivery_fee_ksh, is_paid, fulfilment,
    receiver, receiver_phone, drop_address, drop_note, kitchen_note, drop_lat, drop_lng,
    due_from, due_by, is_scheduled, window_code, substitution)
  values (
    v_uid, 'pending', v_subtotal + v_fee, v_subtotal, v_fee, false, v_fulfil,
    v_receiver, v_phone, v_address, v_note, v_knote, v_lat, v_lng,
    v_from, v_by, v_when = 'scheduled', case when v_when = 'scheduled' then v_window end, v_sub)
  returning id into v_id;

  insert into public.order_items (order_id, menu_item_id, name_snapshot, unit, qty, unit_price_ksh, note)
  select v_id, m.id, m.name, m.unit, r.qty, m.price_ksh, r.note
    from jsonb_to_recordset(v_req) as r(id uuid, qty integer, note text)
    join public.menu_items m on m.id = r.id
   order by m.category, m.sort_order, m.name;

  return jsonb_build_object(
    'order_id', v_id, 'lines', v_lines,
    'subtotal_ksh', v_subtotal, 'delivery_fee_ksh', v_fee, 'total_ksh', v_subtotal + v_fee,
    'due_from', v_from, 'due_by', v_by);
end $$;

-- Defect (a): no more direct inserts. place_order() is the only door.
drop policy if exists orders_customer_insert on public.orders;
drop policy if exists order_items_customer_insert on public.order_items;

-- ---------------------------------------------------------------------------
-- 7. Kitchen and rider write paths
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_advance(p_order_id uuid, p_next text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  cur text; st text; ful text;
begin
  if not public.is_kitchen_or_above() then
    raise exception 'not permitted for role %', coalesce(public.my_role()::text, 'anon')
      using errcode = '42501';
  end if;

  select cook_status, status, fulfilment into cur, st, ful from public.orders where id = p_order_id;
  if cur is null then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;
  if st = 'cancelled' then
    raise exception 'order was cancelled' using errcode = '22023';
  end if;

  if (cur, p_next) not in (('pending','accepted'),('accepted','preparing'),('preparing','ready'),('ready','done')) then
    raise exception 'cannot move cook_status from % to %', cur, p_next using errcode = '22023';
  end if;
  -- 'done' means handed over the counter. A delivery order leaves with a rider instead.
  if p_next = 'done' and ful <> 'pickup' then
    raise exception 'only pickup orders are handed over at the counter' using errcode = '22023';
  end if;

  perform set_config('nyama.system_write', 'on', true);
  update public.orders set cook_status = p_next where id = p_order_id;
  perform set_config('nyama.system_write', 'off', true);

  return jsonb_build_object('order_id', p_order_id, 'cook_status', p_next);
end $$;

-- Defect (b): riders finish a run here, not with a table UPDATE.
create or replace function public.rider_advance(p_delivery_id uuid, p_next text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  cur text; owner uuid;
begin
  if public.my_role() is distinct from 'rider' then
    raise exception 'not permitted for role %', coalesce(public.my_role()::text, 'anon')
      using errcode = '42501';
  end if;

  select status, rider_id into cur, owner from public.deliveries where id = p_delivery_id;
  if cur is null or owner is distinct from auth.uid() then
    -- Same answer for "not yours" and "does not exist".
    raise exception 'run not found' using errcode = 'P0002';
  end if;

  if (cur, p_next) not in (('assigned','picked_up'),('picked_up','delivered'),('picked_up','failed')) then
    raise exception 'cannot move a run from % to %', cur, p_next using errcode = '22023';
  end if;

  update public.deliveries set status = p_next where id = p_delivery_id;
  return jsonb_build_object('delivery_id', p_delivery_id, 'status', p_next);
end $$;

drop policy if exists deliveries_rider_update on public.deliveries;

-- ---------------------------------------------------------------------------
-- 8. Role views
-- ---------------------------------------------------------------------------
drop view if exists public.kitchen_queue;
create view public.kitchen_queue as
  select o.id as order_id,
         o.cook_status,
         o.delivery_status,
         o.fulfilment,
         o.created_at,
         o.due_from,
         o.due_by,
         o.is_scheduled,
         -- Work for today (or overdue) versus booked for a later day.
         (o.due_from at time zone 'Africa/Nairobi')::date
           <= (now() at time zone 'Africa/Nairobi')::date as is_today,
         o.receiver,
         o.substitution,
         o.kitchen_note,
         coalesce((select jsonb_agg(jsonb_build_object(
                            'name', i.name_snapshot, 'qty', i.qty, 'unit', i.unit, 'note', i.note)
                          order by i.created_at, i.name_snapshot)
                     from public.order_items i where i.order_id = o.id), '[]'::jsonb) as items
    from public.orders o
   where o.status <> 'cancelled'
     and o.cook_status in ('pending', 'accepted', 'preparing', 'ready')
     and o.delivery_status not in ('picked_up', 'delivered', 'failed')
     and public.is_kitchen_or_above();

drop view if exists public.rider_runs;
create view public.rider_runs as
  select d.id as delivery_id,
         d.order_id,
         d.status as delivery_status,
         d.created_at,
         o.receiver,
         o.receiver_phone,
         o.drop_address,
         o.drop_lat,
         o.drop_lng,
         o.drop_note,
         o.total_ksh,
         o.is_paid,
         o.cook_status,
         o.due_from,
         o.due_by,
         o.is_scheduled,
         coalesce((select jsonb_agg(jsonb_build_object('name', i.name_snapshot, 'qty', i.qty, 'unit', i.unit)
                          order by i.created_at, i.name_snapshot)
                     from public.order_items i where i.order_id = o.id), '[]'::jsonb) as items
    from public.deliveries d
    join public.orders o on o.id = d.order_id
   where d.rider_id = auth.uid()
     and d.status in ('assigned', 'picked_up')
     and public.my_role() = 'rider';

revoke all on public.kitchen_queue, public.rider_runs from public, anon, authenticated;
grant select on public.kitchen_queue, public.rider_runs to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.place_order(jsonb)        from public, anon;
revoke all on function public.checkout_options()        from public, anon;
revoke all on function public.delivery_slots(text)      from public, anon;
revoke all on function public.asap_due(text)            from public, anon;
revoke all on function public.rider_advance(uuid, text) from public, anon;
grant execute on function public.place_order(jsonb)        to authenticated;
grant execute on function public.checkout_options()        to authenticated;
grant execute on function public.delivery_slots(text)      to authenticated;
grant execute on function public.asap_due(text)            to authenticated;
grant execute on function public.rider_advance(uuid, text) to authenticated;
