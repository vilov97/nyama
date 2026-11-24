# Authentication & RBAC Security Audit — Kwamaiko Nyama

| Field | Value |
|---|---|
| **Date** | 2026-11-24 |
| **Auditor role** | Senior software architect / security engineer (authN/authZ) |
| **Repo** | `vilov97/nyama`, branch `arena/e2549ab7-nyama` (from `7f4e0f1`) |
| **Scope** | Login/authentication design, session & token handling, RBAC design & enforcement, credential policy, brute-force/abuse controls, CSRF/session fixation, logging & auditability, compliance |
| **Method** | Full-repo source review (every file), architecture gap analysis against OWASP ASVS 4.0 / OWASP Top 10:2021 / NIST 800-63B, STRIDE threat model |
| **Companion files** | `docs/supabase-auth-schema.sql` (reference schema + RLS), `docs/frontend-auth-reference.md` (copy-paste React/Supabase code + config) |

---

## Executive summary (for leadership)

**Verdict: there is currently no login system and no RBAC implementation in this repository — at all.** The codebase is a static marketing homepage (React 19 + Vite + Tailwind, no backend, no database, no auth provider, no tests, no CI). The three "Staff Portals" on the homepage (Manager / Rider / Customer) are dead links (`href="#"`) with zero access control behind them.

That is actually **good news at this stage**: there are no live credentials, sessions, or customer records to breach, and no legacy auth to unwind. The risk is entirely **forward-looking** — if ordering, tracking, rider-dispatch, or staff tooling is built on the current client-only architecture without an authN/authZ layer, every portal, order, address, phone number, and payment reference becomes exposed by default.

**Top 5 risks (all pre-implementation gaps, prioritized):**

| # | Risk | Severity | Effort to fix |
|---|---|---|---|
| 1 | Staff portals (Manager/Rider) have no authentication — anyone reaching the future URLs is trusted | **Critical** | M (build auth once, correctly) |
| 2 | No authorization/RBAC layer — no roles, permissions, or server-side enforcement points exist | **Critical** | M |
| 3 | No backend trust boundary — pure SPA means any future "role check in React" is bypassable | **Critical** | M (Supabase + RLS) |
| 4 | No audit logging, lockout, rate limiting, MFA, or recovery design for staff accounts | **High** | S–M |
| 5 | Kenya Data Protection Act 2019 obligations (consent, retention, breach notification, ODPC registration) unaddressed | **High** | S (process) + M (tooling) |

**Recommended path:** adopt **Supabase Auth + Postgres Row-Level Security (RLS)** as the backend/IDP (it matches the connected Supabase + Vercel toolchain), keep the Vite SPA for the public storefront, and enforce every permission in RLS — never in React alone. Add TOTP MFA for Manager accounts, phone OTP or passwordless for customers (Kenya is a mobile-first, M-Pesa-centric market), Turnstile CAPTCHA + rate limits on auth endpoints, and security headers via `vercel.json`. **Estimated total: ~4–6 person-weeks** phased over 4 milestones (§7). The highest-leverage decision is Phase 0 (IDP + session architecture), because it constrains everything after it.

**What this report delivers:** prioritized findings with severity (§3), threat model + attack scenarios + OWASP mapping (§4), a complete RBAC design with permission matrix and enforcement points (§5), a recommended auth architecture with alternatives (§6), a phased migration plan (§7), test cases + CI/CD integration (§8), compliance notes (§9), and copy-paste implementation starters in the two companion files.

---

## 1. Inventory — what actually exists

### 1.1 Stack (verified from source)

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | React 19.2 + Vite 7 + Tailwind 4, TypeScript strict | `package.json`, `vite.config.ts`, `tsconfig.json` |
| Backend / API | **None** — no server code, no routes, no functions | repo-wide search: zero matches |
| Database | **None** | — |
| Auth provider / IDP | **None** — no Supabase/Auth0/Firebase/Clerk SDK, no login form, no token handling | `package.json` deps: only `clsx`, `react`, `react-dom`, `tailwind-merge` |
| Session / cookies / JWT | **None** | — |
| RBAC (roles, guards, policies) | **None** | `Portals.tsx` links are `href="#"` placeholders |
| Router | None (`react-router` not installed; anchor-scroll single page) | `src/App.tsx` |
| Tests / CI / lint | None | no test files, no workflows, no eslint config |
| Deployment config | None (`vercel.json` absent; `vite-plugin-singlefile` inlines all JS/CSS into one HTML file) | `vite.config.ts` |
| Secrets / env | None (nothing to leak — but also no `.env.example` convention) | — |

### 1.2 Authentication control checklist (result: 0 of 14 present)

| Control | Status |
|---|---|
| Login / signup / logout flows | ❌ absent |
| Password policy / credential storage | ❌ N/A — no credentials exist |
| Session handling / token storage / refresh rotation | ❌ absent |
| Cookie flags (`HttpOnly`/`Secure`/`SameSite`) | ❌ N/A — no cookies set |
| SSO / OAuth / OIDC | ❌ absent |
| MFA (TOTP/WebAuthn/SMS) | ❌ absent |
| Account recovery / reset | ❌ absent |
| Rate limiting / lockout / CAPTCHA | ❌ absent |
| CSRF protection | ❌ N/A today; required if cookie sessions are adopted |
| Session-fixation defenses | ❌ N/A today; required with any session design |
| Role/permission definitions | ❌ absent (3 role *names* implied by UI only) |
| Server-side enforcement (API/DB) | ❌ absent — no server or DB |
| Audit logging of authZ decisions | ❌ absent |
| Security headers (CSP/HSTS/XFO) | ❌ absent |

### 1.3 Implied (not implemented) role taxonomy — from `src/components/Portals.tsx`

| Portal card | Subtitle / tagline in UI | Inferred responsibilities |
|---|---|---|
| **Manager** | "Command Center" — Kitchen · Riders · Routes | Menu/pricing, order dispatch, rider assignment, refunds, reports, staff management |
| **Rider** | "Field Interface" — Runs · Navigate · Deliver | View assigned deliveries, update delivery status, navigate, proof-of-delivery |
| **Customer** | "Online Shop" — Order · Track · Enjoy | Browse menu, place orders, pay (M-Pesa), track delivery, order history |

These three labels are the **entirety** of the current "RBAC definition." §5 turns them into a real taxonomy.

### 1.4 Ancillary observations (non-auth, recorded for completeness)

- `vite-plugin-singlefile` inlines the whole bundle into a single HTML file. Fine for a static brochure; dangerous later if any secret or per-user data ever enters the bundle (it becomes cacheable, shareable, undeletable). When auth is added, either drop `singlefile` or enforce a strict "no secrets, no PII in the bundle" rule with a CI check.
- Google Fonts is loaded from a third-party CDN (`@import` in `src/index.css`) with no `integrity`/`preconnect` and no cookie/consent consideration — minor privacy/CSP note for §9.
- Footer social icons link nowhere (`<span>`, no anchors) — not a security issue, but confirms the site is a pre-launch prototype.

---

## 2. Assumptions, context & open questions

The prompt template says context "will be provided" — it wasn't, so the audit proceeds on evidence plus the toolchain signals in this workspace (Supabase + Vercel connectors active). All assumptions are explicit and each maps to a decision in §10.

**A1. Target stack:** React SPA (keep) + **Supabase** (Postgres + Auth/GoTrue + RLS + Storage) + **Vercel** hosting. Rationale: zero backend to preserve, team already oriented to Supabase/Vercel, RLS gives server-side enforcement without operating an API server.
**A2. Market:** Nairobi, Kenya — mobile-first users, phone numbers as primary identifiers, **M-Pesa (Daraja API)** as the expected payment rail, English/Swahili users.
**A3. Data:** orders will carry names, phone numbers, delivery PINs/addresses (precise geolocation), order contents, M-Pesa receipts — i.e., personal data under Kenya's Data Protection Act 2019, but **no health data** (HIPAA not applicable, §9).
**A4. Scale:** single butchery, handful of managers/kitchen staff, small rider fleet, hundreds–thousands of customers. RBAC can be simple (3–5 roles) but must be *server-enforced*.
**A5. Threat actors:** opportunistic web attackers, credential-stuffing botnets, curious/malicious insiders (rider, ex-staff), fraudsters (fake delivery updates, refund abuse), and M-Pesa social-engineering targeting customers.

**Open questions for the product owner (do not block Phase 0):**

1. Will riders use personal Android phones (unmanaged) or company devices? (Affects session lifetime + MFA options.)
2. Is M-Pesa Daraja confirmed for payments, or card/cash-on-delivery too? (Affects PCI/M-Pesa scope and whether the app ever touches payment credentials — it must not.)
3. Single Nairobi branch or multi-branch/kitchen from day one? (Affects whether "branch" becomes an ABAC attribute.)
4. Any EU/UK customers (tourists/diaspora ordering)? (Affects GDPR exposure.)

---

## 3. Findings register (prioritized)

Severity scale: **Critical** = account/data takeover or total access-control failure · **High** = direct path to compromise or compliance breach · **Medium** = defense-in-depth weakness · **Low** = hardening opportunity. "Effort" is incremental build effort in the §7 plan (S < 3d · M 3–10d · L > 10d, per item); "Risk" is implementation risk.

### F-01 — Staff portals have no authentication (Critical)

- **Evidence:** `src/components/Portals.tsx` — Manager/Rider/Customer cards link to `href="#"`; no login form, route guard, or IDP anywhere in the repo.
- **Impact:** the moment real portal pages ship on the current architecture, whoever guesses the URL *is* the manager. Kitchen, rider, route, and customer data would be world-readable.
- **OWASP:** A01:2021 Broken Access Control; A07:2021 Identification & Authentication Failures. ASVS 2.1, 3.1.
- **Remediation:** implement Phase 0–1 (§7): Supabase Auth, login per persona, `RequireRole` route guards *backed by RLS* (never UI-only). Starter code: `docs/frontend-auth-reference.md` §1–3; schema: `docs/supabase-auth-schema.sql`.
- **Effort: M · Risk: Low** (greenfield; no migration of legacy sessions).

### F-02 — No authorization / RBAC layer (Critical)

- **Evidence:** zero role definitions, permission checks, or policies in code; no backend to enforce them in.
- **Impact:** privilege escalation is guaranteed by construction — any future permission check living only in React is removable in DevTools.
- **OWASP:** A01:2021 (function/object-level authZ), A04:2021 Insecure Design. ASVS 4.1.
- **Remediation:** adopt the §5 taxonomy + permission matrix; enforce in **Postgres RLS** (authoritative) with React guards as UX only; add negative RBAC tests (§8).
- **Effort: M · Risk: Low-Medium** (RLS policy bugs fail closed if default-deny; test matrix mitigates).

### F-03 — No backend trust boundary; client-only architecture (Critical)

- **Evidence:** `package.json` has no server framework; `vite.config.ts` builds a single static file; no API routes or edge functions.
- **Impact:** without a server/DB policy layer, *every* authorization decision is client-side and therefore advisory. This is the root cause behind F-01/F-02.
- **OWASP:** A01, A04 Insecure Design.
- **Remediation:** introduce Supabase Postgres + RLS as the trust boundary (no custom API server required at this scale); all reads/writes go through RLS-authenticated queries; service-role key lives **only** in edge functions/CI secrets, never in the bundle. See §6.
- **Effort: M · Risk: Low.**

### F-04 — PII & order-data handling undefined (High)

- **Evidence:** ordering/tracking flows are described in UI copy ("Set Delivery Pin", "Track your order live") with no data model, minimization, retention, or consent design.
- **Impact:** delivery PINs (precise geolocation) + phone numbers + names are high-sensitivity under Kenya DPA 2019; riders over-collecting customer data and indefinite retention are the likely failure modes.
- **OWASP:** A02 Cryptographic Failures (if stored/transmitted insecurely), A09 Security Logging failures (over-logging PII).
- **Remediation:** define the data dictionary (§5.6 + §9): collect minimum (name, phone, PIN, window), TLS-only, encrypt PII columns (`pgcrypto`), mask phone/PIN for riders to assigned-run-only via RLS, 12-month retention default, consent checkbox + privacy notice before launch.
- **Effort: M · Risk: Low.**

### F-05 — Missing security headers & transport policy (Medium → High at launch)

- **Evidence:** no `vercel.json`, no CSP/HSTS/XFO/Referrer-Policy; third-party font CDN without integrity.
- **Impact:** XSS impact amplification, clickjacking of future portals, downgrade/MITM on insecure networks (public Wi-Fi is common for riders).
- **Remediation:** add the `vercel.json` header set in `docs/frontend-auth-reference.md` §6 (CSP, HSTS with preload, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`); enforce HTTPS-only + HSTS at the Vercel project level; `preconnect` + `display=swap` for fonts (or self-host to remove the third party).
- **Effort: S · Risk: Low.**

### F-06 — No brute-force / abuse controls designed (High)

- **Evidence:** no login exists, so no rate limiting, lockout, or CAPTCHA exists either.
- **Impact:** password/OTP endpoints are the #1 credential-stuffing target from day one.
- **OWASP:** A07:2021. ASVS 2.2 (anti-automation).
- **Remediation:** enable Supabase Auth rate limits + leaked-password protection; add Cloudflare Turnstile CAPTCHA on login/signup/reset (Supabase has native CAPTCHA support); progressive backoff + 5-attempt soft lockout with generic error messages (no user-enumeration); alerting on spikes (§8). Config checklist in companion doc §5.
- **Effort: S · Risk: Low.**

### F-07 — No session / token design (High)

- **Evidence:** no sessions, cookies, or JWTs in the codebase.
- **Impact:** ad-hoc session design later is where fixation, over-long lifetimes, and `localStorage`-token XSS theft enter.
- **OWASP:** A02, A07. ASVS 3.2–3.7.
- **Remediation:** decision in §6.3 — **recommended:** keep SPA + Supabase PKCE flow with short access-token lifetimes (≤1h), refresh-token rotation, "log out all devices" for staff, and strict CSP to protect `localStorage` tokens; **stronger alternative:** Next.js on Vercel with `@supabase/ssr` `HttpOnly`+`Secure`+`SameSite=Lax` cookies. Either way: idle timeout 30 min (staff) / 7 days remember-me (customers, optional), absolute max 24h (staff), rotate on privilege change, revoke server-side on role revocation.
- **Effort: S (SPA) / M (SSR migration) · Risk: Low / Medium.**

### F-08 — No MFA or account-recovery design for staff (High)

- **Evidence:** no second factor or recovery flow of any kind.
- **Impact:** manager accounts (refunds, payouts, PII export) protected by a single password are the highest-value target; rider phones are losable/stealable.
- **OWASP:** A07. ASVS 2.8 (MFA), 2.5 (recovery).
- **Remediation:** **require TOTP MFA for `manager`/`admin`** (Supabase `auth.mfa.*` APIs; enrollment snippet in companion doc §4); optional TOTP + SMS OTP for riders; customer recovery via email link or phone OTP with single-use, ≤1h expiry tokens; break-glass admin recovery procedure documented offline; generic success messages to block enumeration.
- **Effort: S–M · Risk: Low.**

### F-09 — No audit logging or monitoring (High)

- **Evidence:** no logging of any kind; no error-tracking or analytics wiring.
- **Impact:** refund fraud, rider impersonation, or manager misuse would be undetectable and unprovable (also a Kenya DPA accountability problem).
- **OWASP:** A09:2021 Logging & Monitoring Failures.
- **Remediation:** append-only `audit_logs` table (actor, action, object, before/after hash, IP, user-agent; §5.7 + SQL file §5), RLS: managers read, nobody updates/deletes; ship Postgres + Auth logs to a Vercel log drain (Logflare/BetterStack); alert on: ≥5 failed logins/5min, role changes, refund > threshold, logins from new devices for staff.
- **Effort: S–M · Risk: Low.**

### F-10 — Secrets & environment management undefined (Medium)

- **Evidence:** no `.env` convention existed (`.gitignore` added by this audit); future Supabase anon/service keys, Daraja credentials, and CAPTCHA secrets have no home.
- **Impact:** service-role key or Daraja consumer secret committed to git or inlined by `vite-plugin-singlefile` = full database/payment compromise. The anon key is public-by-design; the service key must never reach the browser.
- **OWASP:** A02, A07 (hardcoded credentials — pre-empted).
- **Remediation:** `.env.example` convention (added), Vercel environment variables per environment, service-role key only in edge functions/server, `gitleaks` in CI (§8), documented key-rotation runbook.
- **Effort: S · Risk: Low.**

### F-11 — Supply-chain & dependency hygiene (Medium)

- **Evidence:** no lockfile auditing in CI, no Dependabot/Renovate, React 19 + Vite 7 current as of audit date (good), but no process to stay current.
- **Impact:** frontend dependency compromise → session-token theft.
- **Remediation:** `npm audit` + Dependabot in CI (§8), pin + review major upgrades, Subresource Integrity where CDN assets are used.
- **Effort: S · Risk: Low.**

### F-12 — Privacy lifecycle: consent, retention, breach response (Medium, High if launch-adjacent)

- **Evidence:** no privacy notice, consent capture, retention schedule, or breach runbook.
- **Impact:** Kenya DPA 2019 enforcement (ODPC) exposure; customer trust.
- **Remediation:** §9 checklist — privacy notice + checkout consent, data-retention SQL (auto-archive), 72-hour breach notification runbook, ODPC registration as data controller/processor.
- **Effort: S (docs) + M (retention automation) · Risk: Low.**

---

## 4. Security analysis

### 4.1 Assets & actors

| Asset (value) | Actors (motivation) |
|---|---|
| Customer PII: name, phone, delivery PIN/geolocation, order history | Attackers (fraud/robbery — delivery PINs are physical-safety data), malicious insider riders |
| Manager functions: menu/pricing, dispatch, refunds, rider assignment, reports/PII export | Attackers (fraud), disgruntled ex-staff |
| Rider functions: assigned runs, status updates, proof-of-delivery | Attackers (fake "delivered" to steal meat), account buyers |
| M-Pesa payment references (STK push receipts, phone numbers) | Fraudsters (fake-payment social engineering) |
| Credentials/sessions (staff + customer) | Credential-stuffing botnets, phone thieves |
| Business data: pricing, margins, farmer/supplier lists | Competitors |

### 4.2 STRIDE summary (target system, post-build)

| Threat | Example | Mitigated by |
|---|---|---|
| **Spoofing** (rider/manager impersonation) | Stolen password → dispatch fraud | MFA for staff (F-08), short sessions (F-07), lockout (F-06) |
| **Tampering** (order/delivery data) | Rider marks чужой order delivered; customer edits price | RLS object-level policies (§5.5), audit log (F-09) |
| **Repudiation** (refund/order disputes) | "I never authorized that refund" | Append-only audit log with actor+IP (F-09) |
| **Information disclosure** (PII leak) | Rider scrapes all customer PINs | RLS: riders see only assigned runs, masked fields (F-04) |
| **Denial of service** (auth endpoints) | OTP/Login bombing | Rate limits + CAPTCHA (F-06) |
| **Elevation of privilege** (customer→manager) | JWT/`app_metadata` tampering, IDOR on role update | Roles only in server-set claims + `profiles` trigger; no client role writes (§5.5) |

### 4.3 Attack scenarios (concrete, testable)

1. **Portal URL guessing (F-01):** attacker navigates to `/manager` once portals ship. *Expected post-fix:* unauthenticated → login redirect; authenticated non-manager → 403 + audit event. Test: `T-SEC-01`.
2. **React-only guard bypass (F-02/F-03):** attacker strips `RequireRole` in DevTools or calls the API directly with a customer token. *Expected:* RLS denies; UI shows "not authorized." Test: `T-RBAC-*` matrix (§8).
3. **Credential stuffing on login (F-06):** botnet replays breached passwords. *Expected:* Turnstile challenge after N attempts, soft lockout, generic "invalid credentials," alerts fire. Test: `T-SEC-04`.
4. **Rider phone theft (F-07/F-08):** thief opens rider PWA. *Expected:* short idle timeout forces re-auth; manager can revoke all sessions; thief sees at most one active run (RLS), no customer history. Test: `T-SEC-05`.
5. **Refund fraud by staff (SoD, §5.6):** manager issues refund to own M-Pesa. *Expected:* refunds above KSh X require second-manager approval + reason code; all refunds audit-logged with before/after. Test: `T-RBAC-06`.
6. **Fake M-Pesa confirmation (payments):** customer/rider claims payment with forged SMS. *Expected:* order state advances **only** on Daraja callback validation (server-side, signed), never on user assertion. (Payment integration phase; noted here so the state machine is designed correctly now.)
7. **Ex-staff access (lifecycle):** fired rider keeps accessing runs. *Expected:* deprovisioning runbook — disable `auth.users`, revoke sessions, role → `none`, audit event — executed < 1h. Test: `T-RBAC-08`.

### 4.4 OWASP mapping

| OWASP Top 10:2021 | Relevance | Where handled |
|---|---|---|
| A01 Broken Access Control | The central risk (F-01/02/03) | §5 (RBAC), RLS starter, §8 tests |
| A02 Cryptographic Failures | TLS, PII encryption, token storage | F-04, F-07, §6.3 |
| A03 Injection | Future search/order inputs; RLS policy injection via careless `auth.jwt()` use | Parameterized Supabase client (no raw SQL from client); policy review checklist in SQL file |
| A04 Insecure Design | Client-only trust | F-03, §6 |
| A05 Misconfiguration | Headers, Supabase defaults (email confirmations, leaked-password protection off by default) | F-05, companion doc §5 |
| A06 Vulnerable Components | npm supply chain | F-11, §8 CI |
| A07 AuthN Failures | Credential policy, MFA, lockout, enumeration | F-06/07/08 |
| A08 Data/Software Integrity | Single-file bundle tampering, Daraja callback validation | F-04/F-11, scenario 6 |
| A09 Logging Failures | No audit trail | F-09 |
| A10 SSRF | Low today; relevant when fetching farmer/supplier URLs or receipt images | Validate/allowlist outbound fetches in edge functions |

---

## 5. RBAC design (target)

### 5.1 Role taxonomy (recommended: 4 roles + service)

| Role | Persona | Trust level | MFA | Session |
|---|---|---|---|---|
| `customer` | Self-registered buyer | Low | Optional (SMS OTP available) | 7-day sliding, remember-me optional |
| `rider` | Staff, provisioned by manager | Medium | Recommended TOTP; required on new device | 12h absolute, 30-min idle |
| `manager` | Staff, provisioned by admin/owner | High | **Required TOTP** (enforced) | 12h absolute, 30-min idle |
| `admin` | Owner / 1–2 people; user & role management, key rotation | Highest | **Required TOTP + break-glass procedure** | 8h absolute, 15-min idle |
| `service` | Edge functions / Daraja callbacks (service-role key) | System | N/A (key + IP/JWT validation) | N/A |

Notes: start with exactly these four human roles (least privilege; no `superadmin`- creep). `kitchen` can be split from `manager` later if the kitchen display needs a narrower role — the permission table below already isolates kitchen actions so the split is cheap. Role hierarchy is **flat** (no inheritance) to avoid transitive-privilege surprises; "manager can do rider things" is encoded explicitly per permission (see `dispatch:view_all` vs `delivery:update_assigned`).

### 5.2 Permission matrix (granular, least-privilege)

Key: ✅ allowed · ❌ denied · 🔸 conditional (condition in notes).

| # | Permission | customer | rider | manager | admin |
|---|---|---|---|---|---|
| P-01 | `menu:read` (public menu/prices) | ✅ | ✅ | ✅ | ✅ |
| P-02 | `menu:write` (items, prices, availability) | ❌ | ❌ | ✅ | ✅ |
| P-03 | `order:create` (own orders) | ✅ | ❌ | 🔸 phone-orders only | ✅ |
| P-04 | `order:read_own` | ✅ | ❌ | ❌ | ✅ |
| P-05 | `order:read_all` | ❌ | ❌ | ✅ | ✅ |
| P-06 | `order:cancel_own` (before kitchen accept) | ✅ | ❌ | ❌ | ✅ |
| P-07 | `order:refund` (≤ KSh 5,000, reason code) | ❌ | ❌ | ✅ | ✅ |
| P-08 | `order:refund_large` (> KSh 5,000) | ❌ | ❌ | 🔸 dual-approval | ✅ |
| P-09 | `dispatch:assign_rider` | ❌ | ❌ | ✅ | ✅ |
| P-10 | `dispatch:view_all` (routes, all runs) | ❌ | ❌ | ✅ | ✅ |
| P-11 | `delivery:read_assigned` (own active runs + masked customer contact) | ❌ | ✅ | ✅ | ✅ |
| P-12 | `delivery:update_assigned` (picked_up → delivered + PoD photo) | ❌ | ✅ | ✅ | ✅ |
| P-13 | `delivery:read_customer_history` | ❌ | ❌ | 🔸 support-case only | ✅ |
| P-14 | `customer:read_pii` (full phone/PIN) | own only | 🔸 assigned-run only, masked after delivery+24h | ✅ | ✅ |
| P-15 | `staff:create_rider` / `staff:disable_rider` | ❌ | ❌ | ✅ | ✅ |
| P-16 | `staff:manage_managers` (create/disable/promote) | ❌ | ❌ | ❌ | ✅ |
| P-17 | `role:assign` (any role change) | ❌ | ❌ | ❌ | ✅ |
| P-18 | `reports:read_sales` | ❌ | ❌ | ✅ | ✅ |
| P-19 | `reports:export_pii` (CSV with phones/addresses) | ❌ | ❌ | 🔸 approval + logged | ✅ |
| P-20 | `audit:read` | ❌ | ❌ | ✅ (own scope) | ✅ (all) |

### 5.3 Dynamic attributes (ABAC layering on top of RBAC — keep small)

Enforce in RLS using row attributes + JWT claims; do not proliferate roles for these:

| Attribute | Source | Used by |
|---|---|---|
| `orders.customer_id = auth.uid()` | row + JWT `sub` | P-04 (ownership) |
| `deliveries.rider_id = auth.uid()` AND `status IN ('assigned','picked_up')` | row + JWT | P-11/P-12 (assignment + state) |
| `orders.status = 'pending'` | row | P-06 (cancel window) |
| `orders.total <= 5000` | row | P-07/P-08 (refund threshold) |
| `profiles.branch_id` (future) | JWT app claim + row | multi-branch scoping when needed |
| `request.time` within shift window (future) | edge function | rider actions outside shift → step-up check |

### 5.4 Separation of duties (SoD)

| Conflict | Rule | Enforcement |
|---|---|---|
| Refund large sums solo | `order:refund_large` needs **two distinct** manager/admin approvals | `refunds` table: `requested_by ≠ approved_by`, DB CHECK constraint + RLS |
| Dispatch self-dealing | rider cannot assign runs to self; cannot reassign | No `dispatch:*` grant to `rider` (P-09 ❌) |
| Role self-escalation | nobody can change their own role; managers can't create managers | `profiles.role` writable by `admin` only (trigger + RLS); P-16/P-17 |
| Audit tampering | nobody (including admin) updates/deletes `audit_logs` via app | RLS: INSERT by system, SELECT by manager/admin, no UPDATE/DELETE |
| Payment state | order `paid` set only by Daraja-callback edge function (`service`), never by user-facing clients | RLS: `paid`/payment columns writable by `service_role` only |

### 5.5 Enforcement points (defense in depth — authoritative layer marked ★)

| Layer | Mechanism | Role |
|---|---|---|
| **Postgres RLS ★** | `docs/supabase-auth-schema.sql` policies: default-deny, per-role + ownership + state checks | **Authoritative.** Every read/write evaluated here |
| Edge functions (service role) | Daraja callbacks, refund dual-approval, PII export jobs; validate JWT + role claim server-side | Trusted intermediary for cross-row/multi-step ops |
| React router guards | `RequireAuth` / `RequireRole` (companion doc §2–3) | UX only: redirect + 403 page. Assumed bypassable |
| UI element hiding | Hide buttons by permission | UX only, never a control |
| Storage policies | PoD photos: rider-write-own-run, manager-read; customer avatars: own-only | ★ for files |
| DB constraints/triggers | `requested_by ≠ approved_by`, profile-on-signup, role-change audit trigger | ★ integrity backstop |

**Role-claim plumbing (anti-escalation):** the client-visible role comes from `profiles.role` read through RLS (users can read only their own row's role) **and** is mirrored into `auth.jwt() -> app_metadata.user_role` via a Supabase Auth Hook (or edge-function sync on role change) so RLS can check it without recursive table lookups. Clients can never write `app_metadata` or `profiles.role` (RLS + trigger reject). Reference implementation in the SQL file §2–4.

### 5.6 Escalation paths & mitigations

| Path | How it would be attempted | Mitigation |
|---|---|---|
| Customer → rider/manager via profile update | `PATCH profiles SET role='manager'` | RLS denies role-column writes for non-admin; trigger raises exception; attempt audit-logged |
| JWT tampering (`user_role` claim) | Re-sign or edit token | Tokens are server-signed (HS256/ES256); verification in RLS/Postgres, not in JS |
| IDOR on orders/deliveries | Iterate `order_id`s | Ownership/assignment predicates in every SELECT/UPDATE policy (negative tests §8) |
| Stale role after demotion | Demoted rider reuses old access token | Short access lifetimes (≤1h) + server-side session revocation on role change (admin runbook) + RLS re-checks claims per request |
| Support-case PII creep (P-13/P-19) | Manager bulk-exports customers | Export requires reason + approval, rate-limited, fully audit-logged; quarterly access review |
| Service-key leak | Key found in bundle/git | `gitleaks` CI, key only in edge-function secrets, rotation runbook, minimal service-role usage |

### 5.7 Auditability

Every sensitive action writes to `audit_logs(actor_id, action, object_type, object_id, before_hash, after_hash, ip, user_agent, created_at)` via trigger or edge function; managers read own-scope, admins read all; retention ≥ 1 year (append-only, partitioned); weekly review of role changes + refunds + exports. Schema + triggers: SQL file §5.

---

## 6. Authentication architecture (recommended)

### 6.1 IDP decision

| Option | Fit for this project | Verdict |
|---|---|---|
| **A. Supabase Auth (GoTrue) + RLS (recommended)** | Postgres + auth + RLS + storage in one; generous free tier; M-Pesa/phone-OTP friendly; team already on Supabase+Vercel; no API server to operate | **Adopt** |
| B. Clerk / Auth0 | Excellent DX/MFA, but adds a second user store to sync with Postgres + per-seat cost as riders grow | Fallback if Supabase MFA/ hooks prove limiting |
| C. Firebase Auth | Good phone-auth, but Firestore-or-split-brain with Postgres; RLS-equivalent rules are weaker for relational data | Not recommended |
| D. Self-built (Passport/bcrypt/custom JWT) | Full control, full liability (lockout, rotation, breach-checks all hand-rolled) | Reject — unjustified risk at this scale |

### 6.2 Login UX per persona (recommended)

| Persona | Primary login | Second factor / step-up | Recovery |
|---|---|---|---|
| Customer | Phone OTP (SMS) **or** email+password; social (Google) optional at launch+1 | None default; SMS-OTP *is* the factor for phone login | OTP resend with cooldown; email reset link (single-use, ≤1h) |
| Rider | Email/phone + password (provisioned, forced reset on first login) | TOTP encouraged; **required on new device** (risk-based) | Manager-assisted reset (verified in person) + self-serve email/phone flow |
| Manager/Admin | Email + password (12+ chars, breach-checked) | **TOTP required** — cannot reach dashboard without enrollment | Admin-assisted for managers; offline break-glass codes for admins (sealed, rotated yearly) |

Anti-enumeration everywhere: identical responses and timing for "unknown user" vs "wrong password"; generic "If an account exists, we've sent…". Kenya note: SMS OTP has real cost and SIM-swap risk — prefer TOTP/WebAuthn for staff; SMS only for customers, with per-phone daily caps and fraud monitoring.

### 6.3 Session & token design (decision required, §10)

| | Path 1: SPA + Supabase JS (default) | Path 2: SSR + `HttpOnly` cookies (stronger) |
|---|---|---|
| How | PKCE flow, tokens in `localStorage` (Supabase default), refresh rotation on | Next.js (or Vite + BFF) on Vercel with `@supabase/ssr`, `HttpOnly; Secure; SameSite=Lax` cookies |
| XSS blast radius | Token theft possible → mitigate with strict CSP, no `dangerouslySetInnerHTML`, dependency hygiene | Tokens not JS-readable → XSS impact sharply reduced |
| CSRF | N/A (Authorization header, not cookies) | Needs `SameSite=Lax` + origin checks on mutations |
| Effort | S (current stack unchanged) | M (framework migration) |
| **Recommendation** | **Start here** ( matches current Vite SPA; acceptable with §5 RLS + F-05 CSP) | **Migrate when** processing live M-Pesa callbacks at scale or after any XSS incident; design RLS so the move is session-layer-only |

Common rules (both paths): access token ≤1h; refresh rotation with reuse detection; idle timeout 30 min staff / 7-day customer remember-me; absolute max 24h staff; revoke-all-sessions on password/MFA/role change; new-device login email/SMS for staff; never put PII beyond `sub`+`role` in JWT claims.

### 6.4 Credential, lockout & abuse policy (concrete settings)

- **Passwords:** min 8 (NIST 800-63B), allow ≥64, no composition rules, **reject breached passwords** (Supabase *Leaked Password Protection* ON), no periodic rotation; managers/admins: min 12 via client + edge-function check.
- **Lockout:** 5 failed attempts → 15-min soft lockout + CAPTCHA; 20/day → hard lock + staff alert; lockouts per (account + IP) to blunt distributed stuffing without enabling account-DoS; all generic messages.
- **Rate limits:** login 5/min/IP + 10/min/account; signup 3/hour/IP; OTP send 3/10min/phone with daily cap; password-reset 3/hour/account. Enforce at Supabase Auth limits + Turnstile + edge-function counters for custom endpoints.
- **CAPTCHA:** Cloudflare Turnstile (privacy-friendly, free) on login/signup/reset/OTP; Supabase native CAPTCHA integration; fail closed (deny on verification outage after grace, alert on-call).
- **Recovery tokens:** single-use, ≤1h expiry, invalidated on use + on password change; reset never reveals account existence.

### 6.5 CSRF & session fixation (applicability)

- **Today:** N/A (no sessions/cookies). **Path 1 (SPA tokens):** CSRF N/A — mutations use `Authorization: Bearer` header; fixation N/A — no server session IDs; ensure logout clears tokens and refresh rotation invalidates reuse.
- **Path 2 (cookies):** set `HttpOnly; Secure; SameSite=Lax`; validate `Origin/Referer` on state-changing endpoints; rotate session on login and on privilege change (Supabase SSR handles rotation — verify in `T-SEC-06`).

---

## 7. Remediation / migration plan (phased)

| Phase | Goal | Tasks | Acceptance criteria | Effort | Risk |
|---|---|---|---|---|---|
| **0. Decisions & foundations** (week 1) | Lock architecture | Decide §6.3 path; create Supabase project (dev/staging/prod); configure Auth settings per §6.4; `.env.example` + Vercel envs; `vercel.json` headers (F-05); `gitleaks` + `npm audit` CI | Settings checklist signed off; headers verified with securityheaders.com; secrets scan green | S (2–3d) | Low |
| **1. Identity & RBAC core** (weeks 1–3) | Users can log in; roles enforced in DB | Apply `supabase-auth-schema.sql` (profiles, roles, audit, triggers, RLS); Auth Hook mirroring role→JWT; login/logout/recovery UI + `RequireRole` guards; TOTP MFA for staff; seed script for first admin (break-glass) | RBAC matrix tests pass (§8); no client can read/write outside policy; MFA enforced for manager/admin; penetration re-test of scenarios 1–2 fails for attacker | M (8–10d) | Low-Med |
| **2. Abuse controls & audit** (weeks 3–4) | Auth endpoints hardened; actions provable | Turnstile + rate limits + lockout (F-06); audit-log triggers + log drain + alerts (F-09); session-revocation runbook + ex-staff drill (scenario 7) | Stuffing simulation blocked; alerts fire in staging; audit log immutable + queryable | S–M (4–6d) | Low |
| **3. Domain + payments** (weeks 4–6) | Orders/dispatch live with least privilege | Orders/deliveries/refunds tables + RLS per §5.2; rider PWA scoping (P-11/12/14); refund dual-approval (P-08); Daraja callback edge function with signature validation (scenario 6); PII masking/retention jobs | Full RBAC matrix incl. SoD tests green; payment state only via signed callback; retention job verified | M (8–10d) | Medium (money movement — stage first, dual-approval from day one) |
| **4. Assurance & launch** (week 6+) | Prove it, then ship | OWASP ZAP baseline in CI; independent re-test of §4.3 scenarios; privacy notice + consent + ODPC registration (§9); incident/breach runbooks; quarterly access-review calendar | All §8 tests green; audit report v2 (post-implementation); launch checklist signed by owner | S (3–5d) | Low |

**Total: ~4–6 person-weeks** engineering + ~1 week owner/ops time (decisions, ODPC, runbooks). Critical path: Phase 0 → 1. Do not build portal features ahead of Phase 1 — any screen built before RLS lands must be retrofitted.

---

## 8. Verification — test cases & CI/CD

### 8.1 Test matrix (map each finding to a failing-before/passing-after test)

**RBAC (run against staging with real RLS; each row = customer/rider/manager/admin × allowed/denied):**

| ID | Case | Expected |
|---|---|---|
| T-RBAC-01 | Customer reads another customer's order | 0 rows / 403 + audit event |
| T-RBAC-02 | Customer `PATCH profiles.role` | Rejected; role unchanged; attempt logged |
| T-RBAC-03 | Rider reads unassigned delivery / full customer history | Denied; sees only assigned runs |
| T-RBAC-04 | Rider assigns run to self / reassigns | Denied (no `dispatch:*`) |
| T-RBAC-05 | Manager creates/promotes another manager | Denied (admin-only P-16/17) |
| T-RBAC-06 | Refund > KSh 5,000 with single approval | DB CHECK rejects; dual-approval flow succeeds |
| T-RBAC-07 | Demoted user reuses old token after revocation | All queries denied post-revocation |
| T-RBAC-08 | Disabled ex-staff login + session reuse | Login denied; old tokens rejected |
| T-RBAC-09 | PII export without approval reason | Blocked; approved export fully audit-logged |

**Security:**

| ID | Case | Expected |
|---|---|---|
| T-SEC-01 | Unauthenticated `/manager`, `/rider` access | Redirect to login; no data fetched |
| T-SEC-02 | JWT with tampered `user_role` claim | Rejected at DB (signature verification) |
| T-SEC-03 | Breached/common passwords (`password123`, etc.) | Rejected at signup/change |
| T-SEC-04 | 6th failed login / OTP bombing | Lockout + CAPTCHA + alert; generic messages; no enumeration |
| T-SEC-05 | Rider session idle 31 min / stolen-token replay after logout | Forced re-auth; replay rejected |
| T-SEC-06 | (Path 2 only) cross-site POST without origin; session ID pre/post-login | CSRF blocked; session rotated |
| T-SEC-07 | Security headers + TLS on preview & prod | CSP/HSTS/XFO/Referrer present; HSTS preload; `http→https` |
| T-SEC-08 | Secrets scan on PR + bundle PII/secret grep | `gitleaks` + custom grep green; no `service_role` string in `dist/` |

### 8.2 CI/CD integration (GitHub Actions — add at Phase 0)

```yaml
# .github/workflows/ci.yml (starter — extend in Phase 1 with RBAC + ZAP jobs)
name: ci
on: [push, pull_request]
jobs:
  build-and-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run build
      - run: npm audit --audit-level=high
      - uses: gitleaks/gitleaks-action@v2
      - run: "! grep -r 'service_role' dist/ src/ --include='*.ts*'"  # fail if leak
      # Phase 1+: supabase db lint + RLS policy tests (pgTAP) + vitest RBAC matrix
      # Phase 4+: zaproxy baseline scan against Vercel preview URL
```

Plus: **Dependabot** (`npm` + GitHub Actions, weekly), **required reviews** for `supabase/migrations/**` (two reviewers for RLS changes), **Vercel preview deployments** as the ZAP target, and a **staging Supabase project** that mirrors prod policies (never test RLS only in prod).

---

## 9. Compliance notes

**Kenya Data Protection Act, 2019 (primary regime — user & business in Nairobi):** delivery PINs, phones, and names are personal data; geolocation tied to identity is sensitive in practice (physical safety). Required before launch: (1) register with the **ODPC** as data controller (and processor, if riders/staff process data on your behalf); (2) publish a privacy notice (Swahili + English recommended) and capture **checkout consent** for delivery processing + optional marketing consent (separate checkbox); (3) purpose limitation — rider sees assigned-run contact only (P-14), support sees history only per case (P-13); (4) retention schedule — order/PII auto-archive at 12 months, audit logs ≥12 months, PoD photos 90 days (implement as scheduled SQL); (5) **72-hour breach notification** to ODPC + affected subjects — write the runbook in Phase 4; (6) honor access/correction/deletion requests (self-serve export/delete for customers in Phase 3+). Cross-border transfer (Supabase region choice): pick the nearest region (EU/South Africa) and document the transfer basis; keep the transfer register the DPA requires.

**GDPR:** applies only if targeting EU/UK subjects (e.g., diaspora ordering) — if so, the DPA measures above cover ~90%; add a Data Processing Agreement with Supabase/Vercel, EU representative assessment, and cookie/consent handling for any analytics.

**Payments (M-Pesa Daraja):** the app must **never** handle M-Pesa PINs or credentials — STK push + server-validated callbacks only; store only Daraja receipt IDs + amounts + phone (masked in UI); reconcile daily; treat callback endpoint as critical infra (signature check, idempotency keys, replay window). No card data → no PCI-DSS card scope; if cards are added later, use a hosted-fields/tokenizing PSP (no PAN in your DB, ever).

**HIPAA:** **not applicable** — food ordering and delivery involves no Protected Health Information. No HIPAA controls are recommended; do not let a future "dietary/health notes" field become de-facto health data — keep it free-text-optional or drop it.

---

## 10. Decisions needed & immediate next steps

**Decisions for the owner (this week — they unblock Phase 0):**

| # | Decision | Recommendation | If undecided |
|---|---|---|---|
| D1 | IDP: Supabase Auth vs alternative | Supabase Auth (§6.1) | Audit assumes Supabase; alternatives add 1–2 weeks |
| D2 | Session path: SPA tokens vs SSR cookies | Start SPA (§6.3 Path 1), migrate later | Default to Path 1 |
| D3 | Customer login: phone OTP vs email+password vs both | Both, phone-primary | Default to both |
| D4 | MFA mandate for riders (TOTP) | Required on new device; full mandate at 3 months | Default as stated |
| D5 | Refund dual-approval threshold | KSh 5,000 | Default as stated |
| D6 | Supabase region + environments (dev/staging/prod) | Nearest region; 3 projects from day one | Default as stated |

**Immediate next steps (in order):** ① approve D1–D6 → ② create Supabase projects + configure Auth per companion doc §5 → ③ add `vercel.json` headers + CI workflow (§8.2) → ④ apply `supabase-auth-schema.sql` to dev → ⑤ build login + guards (companion doc §1–4) → ⑥ run T-RBAC/T-SEC against staging.

---

## Appendix A — file-by-file evidence

| File | Auth/RBAC-relevant content |
|---|---|
| `src/components/Portals.tsx` | 3 portal cards, all `href="#"` — role names implied, nothing enforced |
| `src/components/Navbar.tsx`, `Hero.tsx`, `HowItWorks.tsx`, `MenuPreview.tsx`, `HoursAbout.tsx`, `Footer.tsx` | Static marketing content; no forms, no fetches, no auth |
| `src/App.tsx`, `src/main.tsx` | No router, no providers, no guards |
| `package.json` | No auth/IDP, router, test, or backend deps |
| `vite.config.ts` | `vite-plugin-singlefile` — bundle-inlining noted in F-04/F-10 |
| `index.html`, `src/index.css`, `src/utils/cn.ts`, `tsconfig.json` | No auth surface |

## Appendix B — glossary

RBAC (role-based access control) · ABAC (attribute-based AC) · SoD (separation of duties) · RLS (Postgres Row-Level Security) · IDP (identity provider) · GoTrue (Supabase's auth server) · PKCE (proof-key for code exchange — public-client OAuth flow) · TOTP (time-based one-time password) · PoD (proof of delivery) · DPA/ODPC (Kenya Data Protection Act / Office of the Data Protection Commissioner) · ASVS (OWASP Application Security Verification Standard).

*End of audit v1 (pre-implementation). Re-run as audit v2 after Phase 1 lands, and after any IDP/session-architecture change.*
