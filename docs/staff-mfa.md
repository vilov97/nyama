# Staff MFA (TOTP) — enrolment and step-up

## Verified against the live project

Exercised end-to-end against `nyama-dev` with a disposable fixture, not just unit
tested:

| Step | Result |
|---|---|
| `POST /auth/v1/factors` (enrol) | 200, returns TOTP secret + QR |
| `POST /auth/v1/factors/{id}/challenge` | 200, challenge id |
| `POST /auth/v1/factors/{id}/verify` with a computed code | 200 |
| `auth.mfa_factors` row | `status = verified` |
| Password login while a factor is verified | 200 with **`aal: aal1`**, `factors[].status = verified` |
| Challenge + verify on that session | new token with **`aal: aal2`** and `amr: [totp, password]` |

So GoTrue's TOTP works. The gaps were in our UI.

## The bypass that existed

`AuthProvider` only checked *whether a verified factor existed*:

```ts
const verified = factors?.totp?.some((f) => f.status === "verified");
setMfaRequired(!verified);   // false ⇒ RequireRole lets them through
```

A staff member with a factor could sign in with a password only, ignore the MFA
prompt, and still reach `/admin` — because the session was fetched at `aal1` and
nothing looked at `aal`. MFA was advisory, not enforced.

## What is enforced now

`AuthProvider` also reads
`supabase.auth.mfa.getAuthenticatorAssuranceLevel()` and exposes:

- `mfaRequired` — no verified factor → `/mfa-enroll` (enrol)
- `mfaStepUpRequired` — verified factor but `currentLevel = aal1` and
  `nextLevel = aal2` → `/mfa-enroll` (verify)
- `aal` — `'aal1' | 'aal2' | null`, for display and debugging

`RequireRole` redirects on **either** flag, so an `aal1` staff session can no
longer reach a staff dashboard. A failed assurance-level or factor lookup fails
**closed** (treated as "still owes a factor") rather than open.

`MfaEnrollPage` now handles both paths: it enrols a new factor when none exists,
and challenges the existing one when the user only owes a second factor. Errors
from Supabase are surfaced instead of a generic "try again", and an expired
challenge tells the user to reload for a fresh one.

`src/auth/mfaGate.test.ts` (7 tests) pins the rule, including "never let an aal1
admin through" across several allow-lists.

## The one exemption: the test manager

`rbac-manager@kwamaiko.test` is a shared test login, so nobody can hold an
authenticator for it. Its account carries `app_metadata.mfa_exempt = true`, and
`staffMfaRequired()` in `src/auth/roles.ts` lets a **manager** with that flag in
on a password alone.

- The flag lives in `auth.users.raw_app_meta_data`, which only the service role
  can write. A signed-in user cannot set it on themselves.
- Only the boolean `true` counts.
- Admins are never exempt, whatever the flag says.

Before real staff use the site, delete the account or remove the flag:

```sql
update auth.users
   set raw_app_meta_data = raw_app_meta_data - 'mfa_exempt'
 where email = 'rbac-manager@kwamaiko.test';
```

No real manager account should ever carry this flag. To list every account that
does: `select email from auth.users where raw_app_meta_data ? 'mfa_exempt';`

## Operational notes

- Admins cannot lock themselves out through this flow: enrolment is only
  reachable while authenticated, and recovery is a Dashboard-side factor reset
  (Authentication → Users → the user → delete factors), then sign in again.
- Lost device: delete the factor in the Dashboard. There is no self-serve
  recovery path yet — worth adding recovery codes before real staff onboarding.
- `mfa_max_enrolled_factors` is 10 by default; the UI enrolls one.
