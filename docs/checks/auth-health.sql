-- ---------------------------------------------------------------------------
-- Verify GoTrue can actually read the auth.users rows.
--
-- Why this exists: users inserted straight into auth.users with raw SQL can be
-- missing values that the GoTrue Go driver cannot scan (NULL into a bool or a
-- plain string). Sign-in then fails with the generic 500
--   "Database error querying schema"
-- which gives the app nothing to work with. This check surfaces the cause
-- before users hit it.
--
-- Run after any manual auth.users INSERT/UPDATE.
-- ---------------------------------------------------------------------------

-- 1. Columns GoTrue scans into non-nullable Go types. Any NULL here breaks login.
select
  email,
  instance_id,
  aud,
  role,
  is_super_admin,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token,
  raw_app_meta_data ? 'user_role' as has_role_claim
from auth.users
where is_super_admin              is null
   or confirmation_token          is null
   or recovery_token              is null
   or email_change                is null
   or email_change_token_new      is null
   or email_change_token_current  is null
   or phone_change                is null
   or phone_change_token          is null
   or reauthentication_token      is null
   or is_sso_user                 is null
   or is_anonymous                is null
   or raw_app_meta_data           is null
   or raw_user_meta_data          is null;

-- Expect ZERO rows. If any appear, repair with:
--   update auth.users set
--     is_super_admin              = coalesce(is_super_admin, false),
--     confirmation_token          = coalesce(confirmation_token, ''),
--     recovery_token              = coalesce(recovery_token, ''),
--     email_change                = coalesce(email_change, ''),
--     email_change_token_new      = coalesce(email_change_token_new, ''),
--     email_change_token_current  = coalesce(email_change_token_current, ''),
--     phone_change                = coalesce(phone_change, ''),
--     phone_change_token          = coalesce(phone_change_token, ''),
--     reauthentication_token      = coalesce(reauthentication_token, ''),
--     raw_app_meta_data           = coalesce(raw_app_meta_data,
--                                     '{"provider":"email","providers":["email"]}'::jsonb),
--     raw_user_meta_data          = coalesce(raw_user_meta_data, '{}'::jsonb)
--   where <same conditions>;

-- 2. Every user needs exactly one email identity or password login is rejected.
select u.email, count(i.id) as identities
from auth.users u
left join auth.identities i on i.user_id = u.id
group by u.email
having count(i.id) <> 1;

-- 3. The JWT role claim and the profile role must agree, or RLS and the UI
--    will disagree about what the user may do.
select u.email, u.raw_app_meta_data ->> 'user_role' as jwt_role, p.role as profile_role
from auth.users u
left join public.profiles p on p.id = u.id
where coalesce(u.raw_app_meta_data ->> 'user_role', '') <> coalesce(p.role::text, '')
   or p.id is null;
