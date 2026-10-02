# Simple Talk (voxora) — Fix Plan

Status: source-review of `apps/api`, `apps/mobile`, `apps/admin`, `apps/web` and `docs/*`.
Companion to `docs/USER_FLOW.md`, `docs/MODEL_FLOW.md`, `docs/E2E_CHECKLIST.md`.

This document lists every issue found during the migration review of
`celebconnect-v2` → `voxora`, with the exact file, current behaviour, why it is
wrong, the fix, and an acceptance test. Items are grouped by severity:

- **P0** — breaks money, auth, or security. Ship-blocker.
- **P1** — broken user/creator flow or a real bug. Fix before soft launch.
- **P2** — missing feature from the old app or an operational gap. Decide scope.
- **P3** — polish, branding, docs drift, tech debt.

> Important: several rows in `USER_FLOW.md` / `MODEL_FLOW.md` validation tables
> are **stale** — the code has since been fixed. Before working this list, re-run
> those tables. Re-verified-as-fixed items are collected in §11 so nobody
> re-implements them.

---

## 0. Summary table

| ID | Sev | Area | One-line |
|----|-----|------|----------|
| P0-1 | P0 | Auth | Universal backdoor OTP `7723` accepted even with SMS configured |
| P0-2 | P0 | Security | Live secrets in `apps/api/.env` (Mongo, Redis, JWT, Agora, ImageKit, MessageCentral) |
| P0-3 | P0 | Auth | `referral_service` uses `datetime` without importing it → 500 on apply/bonus |
| P0-4 | P0 | Admin | Admin login page ships default credentials and `voxora.app` email |
| P1-1 | P1 | Money | Withdrawals create no `WITHDRAW` ledger row (filter expects one) |
| P1-2 | P1 | Notifications | No live `new_notification` socket event; only DB writes |
| P1-3 | P1 | Notifications | No unread count / badging anywhere |
| P1-4 | P1 | Calls | `is_busy` flag never set true; live-ops stuck-busy detection is dead code |
| P1-5 | P1 | Push | `google-services.json` ships two package names, one wrong |
| P1-6 | P1 | Support | Terms/Privacy say “support in Profile” but Profile has no support/help |
| P2-1 | P2 | Chat | Entire chat system missing |
| P2-2 | P2 | Favorites | Favorites missing |
| P2-3 | P2 | Earnings | `/profile/earnings/*` endpoints and creator earnings screen missing |
| P2-4 | P2 | Support | `GET /support/messages` and admin mark-read missing |
| P2-5 | P2 | Withdrawals | Withdrawal request-increase flow + admin page missing |
| P2-6 | P2 | Moderation | Generic report-user / block-user endpoints missing |
| P2-7 | P2 | Follow | Followers list and follow-status endpoints missing |
| P2-8 | P2 | Reviews | Public reviews list + stats endpoints missing |
| P2-9 | P2 | Admin | Financial dashboard (overview/transactions/commissions/analytics) missing |
| P2-10 | P2 | API | Standalone `/agora/token` endpoint missing |
| P2-11 | P2 | Web | `apps/web` reduced to landing/legal/delete only |
| P3-1 | P3 | Branding | `voxora-*` package names, logger names, DB name, service name |
| P3-2 | P3 | Config | `DEV_OTP_CODE=123456` in `.env.example` is unused; code hardcodes `7723` |
| P3-3 | P3 | Docs | OTP length contradictory (docs 6-digit vs code 4-digit) |
| P3-4 | P3 | Mobile | Force-update opens generic Play Store, not the app listing |
| P3-5 | P3 | API | `apps/api/google-services.json` unused server-side |
| P3-6 | P3 | Mobile | Route `/creator/[id]` is not declared in the root Stack |
| P3-7 | P3 | DB | Missing indexes for several queried collections |
| P3-8 | P3 | Rate limit | In-memory fallback is per-process; multi-instance bypass |
| P3-9 | P3 | Docs | Validation tables in USER_FLOW/MODEL_FLOW are stale |

---

## 1. P0 — Security and auth (Dont fix this)

### P0-1 — Universal backdoor OTP `7723`

- **File:** `apps/api/app/services/auth_service.py` lines 239–261.
- **Current behaviour:**
  ```python
  DEFAULT_TEST_OTP = "7723"
  ...
  if otp.strip() == DEFAULT_TEST_OTP:
      logger.info("Default test OTP used for phone: %s", full)
      valid = True
  elif stored_id:
      valid = await _validate_messagecentral_otp(str(stored_id), otp)
  ```
  The check is **unconditional**. Even when `MESSAGECENTRAL_API_KEY` is set and a
  real SMS is in flight, `7723` logs any phone number in and creates/returns a
  session.
- **Why it is wrong:** Anyone can authenticate as any phone number — including
  creators and admins — on production. It also silently bypasses rate limits
  because it never calls the provider.
- **Fix:**
  1. Gate the shortcut on BOTH conditions:
     ```python
     settings = get_settings()
     allow_dev = (
         not settings.messagecentral_api_key
         and settings.environment != "production"
     )
     if allow_dev and otp.strip() == DEFAULT_TEST_OTP:
         valid = True
     elif stored_id:
         valid = await _validate_messagecentral_otp(str(stored_id), otp)
     ```
  2. Make the dev OTP configurable (`settings.dev_otp_code`) instead of
     hardcoding `7723`, defaulting to empty. If empty, no shortcut.
  3. Add a startup warning if `environment == "production"` and
     `messagecentral_api_key` is empty (OTP cannot work).
- **Acceptance test:**
  - With `ENVIRONMENT=production` and a valid MessageCentral key, POST
    `/api/auth/otp/verify` with `otp=7723` returns HTTP 400.
  - With `ENVIRONMENT=development` and no key, `7723` still logs in.
  - With no key at all in production, verify returns a clear “OTP not
    configured” error, never a session.

### P0-2 — Live secrets committed in `apps/api/.env` (Skip this, I will do it)

- **File:** `apps/api/.env` (present in the working tree).
- **Exposed:** MongoDB Atlas connection string with password, Upstash Redis REST
  token and TLS URL, `JWT_SECRET`, `ADMIN_JWT_SECRET`, MessageCentral JWT,
  Agora `AGORA_APP_CERTIFICATE`, ImageKit private/public keys.
- **Current state:** `.gitignore` line 7 covers `.env`, and `git log` shows no
  history for it, so it is probably untracked — but the file exists on disk and
  is what the API loads, so any archive, screenshot, or accidental
  `git add -f` leaks production credentials. The DB name is also `voxora`
  (branding, see P3-1).
- **Why it is wrong:** These are production credentials for real users’ data,
  money, and call infrastructure. `JWT_SECRET`/`ADMIN_JWT_SECRET` leak lets
  anyone forge sessions and admin tokens.
- **Fix:**
  1. **Rotate every value** in that file: Mongo user password, Upstash token,
     JWT secrets, MessageCentral token, Agora certificate, ImageKit keys.
  2. Delete the local real values; keep only `apps/api/.env.example`.
  3. Store real values in Render → Environment (already declared `sync: false`
     in `render.yaml`).
  4. Confirm `.env` is never tracked: `git check-ignore -v apps/api/.env`.
  5. Add a secret scan to CI (e.g. gitleaks) and a pre-commit hook.
- **Acceptance test:** `git ls-files | Select-String "\.env$"` shows only
  `.env.example`. The published Render service boots using dashboard env only.

### P0-3 — `referral_service.py` missing `datetime` import

- **File:** `apps/api/app/services/referral_service.py`.
- **Current behaviour:** Imports are only `typing`, `fastapi`, and app modules
  (lines 1–10). The module references `datetime.now(timezone.utc)` at line 94
  (`apply_referral_code`) and line 107 (`maybe_pay_first_recharge_bonus`).
- **Why it is wrong:** Both code paths raise `NameError: name 'datetime' is not
  defined`, which surfaces as HTTP 500. That means:
  - Applying a referral code always fails.
  - `process_order_success` calls `maybe_pay_first_recharge_bonus` on every
    recharge, so a successful payment throws after crediting (the credit and
    referral bonus do not complete cleanly).
- **Fix:** Add at the top:
  ```python
  from datetime import datetime, timezone
  ```
  Add a unit test that applies a referral and asserts a wallet bonus.
- **Acceptance test:** `POST /api/profile/referral/apply` with a valid code
  returns `{"success": true}` and sets `users.referred_by`. A first recharge
  credits both wallets once.

### P0-4 — Admin login page ships default credentials

- **File:** `apps/admin/src/pages/Login.tsx` lines 8–9.
- **Current behaviour:**
  ```tsx
  const [email, setEmail] = useState("admin@voxora.app");
  const [password, setPassword] = useState("admin123456");
  ```
- **Why it is wrong:** Real-looking default credentials are pre-filled (and the
  email uses the old `voxora.app` brand). Combined with
  `ALLOW_ADMIN_BOOTSTRAP` and the checked-in `.env` (`ALLOW_ADMIN_BOOTSTRAP=true`),
  an attacker who reaches the dashboard can bootstrap/enter an admin.
- **Fix:**
  1. Initialise both fields to `""`; remove hardcoded password.
  2. Keep bootstrap available only in dev via `VITE_ALLOW_ADMIN_BOOTSTRAP`.
  3. Ensure production `ALLOW_ADMIN_BOOTSTRAP=false` (already in `render.yaml`).
  4. Consider a login lockout after repeated failures.
- **Acceptance test:** Loading the login page shows empty fields. Bootstrap is
  absent when the env flag is off.

---

## 2. P1 — Broken flows

### P1-1 — Withdrawals create no ledger row

- **File:** `apps/api/app/routers/wallet.py` lines 103–134; consumer
  `apps/mobile/app/(tabs)/wallet.tsx` line 32 (`TX_FILTERS`) and line 59.
- **Current behaviour:** `withdraw()` debits `earnings_balance` and inserts a
  `withdrawal_requests` row, but writes **no** `transactions` row.
- **Why it is wrong:** The wallet “WITHDRAW” filter (`type.includes("WITHDRAW")`)
  will always be empty; users cannot see a withdrawal in history. `MODEL_FLOW.md`
  M-6.3 already flags this.
- **Fix:** Inside the same hold step, insert a transaction:
  ```python
  await wallet_service.insert_transaction(
      user_id=user["user_id"],
      tx_type="WITHDRAW_HOLD",
      amount=body.amount,
      description="Withdrawal requested",
      metadata={"request_id": req_id, "upi_id": body.upi_id},
      transaction_id=f"tx_withdraw_{req_id}",
  )
  ```
  Optionally add a `WITHDRAW_REVERSED` row in `admin.py` when a request is
  rejected.
- **Acceptance test:** Request ₹100 → a row with `type` containing `WITHDRAW`
  appears in `/wallet/transactions`; reject via admin → balance returns and a
  reversal row appears.

### P1-2 — No live `new_notification` socket event

- **Files:** `apps/api/app/routers/admin.py` `_notify_user` (lines 14–35),
  `apps/api/app/services/follower_notify_service.py`,
  `apps/api/app/routers/misc.py` (`/notifications`), and
  `apps/mobile/app/_layout.tsx`.
- **Current behaviour:** Notifications are written to `notifications` and a push
  is sent, but there is **no** `emit_to_user(user_id, "new_notification", ...)`.
  `grep` for `"new_notification"` returns no matches. The mobile root layout
  never listens for it; the Updates screen only refreshes when opened.
- **Why it is wrong:** In-app users get no real-time banner/badge; the old app
  emitted `new_notification` and showed a toast. `USER_FLOW.md` U-7 expects in-app
  updates.
- **Fix:**
  1. In `_notify_user`, after inserting, call
     `await emit_to_user(user_id, "new_notification", {title, message: body, type: ntype, data})`.
  2. Same in `follower_notify_service` per follower.
  3. In `app/_layout.tsx`, register a `new_notification` handler that shows a
     `Toast` (skip type `incoming_call`) and optionally refreshes an unread
     counter.
- **Acceptance test:** Admin broadcast while the fan app is foregrounded shows a
  toast without reopening the Updates screen.

### P1-3 — No unread count / badging

- **Files:** `apps/api/app/routers/misc.py` (only list + read-all),
  `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/app/notifications.tsx`.
- **Current behaviour:** There is no `/notifications/unread-count`, no
  `POST /notifications/{id}/read`, and no delete. The Updates screen marks all
  read on open. The tab bar has no badge.
- **Why it is wrong:** Users cannot tell they have unread updates; old app had
  unread count and per-item read/delete.
- **Fix:**
  1. Add `GET /notifications/unread-count`, `POST /notifications/{notification_id}/read`,
     `DELETE /notifications/{notification_id}` in `misc.py` (mirror old
     `server.py` lines 9876–9935).
  2. Expose in `apps/mobile/src/services/api.ts`.
  3. Badge the Profile tab (or an Updates entry) with the count; refresh on
     focus and on `new_notification`.
- **Acceptance test:** Two unread notifications → badge shows 2; open Updates →
  badge clears; per-item read persists.

### P1-4 — `is_busy` never set; live-ops stuck-busy is dead code

- **Files:** `apps/api/app/routers/admin.py` `_live_ops_metrics` lines 195–214,
  `apps/api/app/services/presence_service.py` line 92.
- **Current behaviour:** Live-ops queries `creator_profiles.find({"is_busy": True})`.
  The only write to `is_busy` is `force_offline` setting it **false**. Nothing
  ever sets it true (searched all of `apps/api/app`).
- **Why it is wrong:** `busy_profiles` is always empty, so “stuck busy creator”
  detection relies entirely on presence + active-call scans and double-counts.
  The `admin.py` condition at lines 214 will always fall through for those ids,
  producing misleading rows.
- **Fix (choose one):**
  - **Option A (recommended):** remove `is_busy` entirely and derive BUSY purely
    from `presence_service.get_creator_status` / active calls. Delete the
    `busy_profiles` query and the `is_busy` update in `force_offline`.
  - **Option B:** set `is_busy` true in `accept_call`/`prepaid_start` and false
    in `finalize_call`, then trust it.
- **Acceptance test:** A creator on a live call appears once in live-ops
  `stuck_busy_creators`; force-offline clears them and the list does not contain
  duplicates.

### P1-5 — `google-services.json` contains a wrong second package (No problem with this)

- **File:** `apps/mobile/google-services.json`.
- **Current behaviour:** The file defines clients for both
  `com.simple_talk.app` (line 12) and `com.simpletalk.app` (line 41). The app
  package is `com.simple_talk.app`.
- **Why it is wrong:** A mismatched/duplicate package entry can make Firebase
  register the wrong client or fail token fetch on some builds, breaking
  killed-state ringing. `docs/FCM_DEVICE_QA.md` already warns about regenerating
  this file.
- **Fix:** Regenerate `google-services.json` from Firebase Console for the single
  Android app `com.simple_talk.app`; remove the `com.simpletalk.app` client.
  Also confirm `apps/api/firebase-adminsdk.json` is the Admin SDK key, not the
  client config.
- **Acceptance test:** A data-only FCM test reaches a killed device and the
  server Admin SDK sends successfully.

### P1-6 — “Support in Profile” link does not exist

- **Files:** `apps/mobile/app/terms.tsx` line 36, `apps/mobile/app/privacy.tsx`
  line 35, `apps/mobile/app/(tabs)/profile.tsx`.
- **Current behaviour:** Terms/Privacy tell users to find “support in Profile”,
  but Profile has no Support/Help entry and there is no support screen. The API
  has `POST /support/message` but the app never calls it.
- **Why it is wrong:** Store policy and the legal text promise an in-app support
  path that does not exist.
- **Fix:** Add a `support.tsx` screen (subject + message, calls
  `appAPI.support`), link it from Profile, and keep the email fallback.
- **Acceptance test:** Profile → Support opens; submitting creates a
  `support_messages` row visible in admin → Support.

---

## 3. P2 — Missing features from the old app

These are the deliberate-or-accidental gaps versus `celebconnect-v2`. Decide per
item whether it is in scope for Simple Talk. Appointments are intentionally
dropped (`docs/MIGRATION.md`) and are **not** listed here.
 
### P2-1 — Chat system (This is not required)

Old endpoints (`server.py` 7581–7994): `POST /chat/request`,
`GET /chat/request/status/{model_id}`, `GET /chat/requests`,
`POST /chat/requests/{id}/accept|reject`, `POST /chat/block|unblock`,
`GET /chat/blocked`, `GET /chat/conversations`,
`GET /chat/messages/{other_user_id}`, `POST /chat/send`.
Old mobile: `chat.tsx`, `chat-requests.tsx`, `chat-screen.tsx`; old web
`ChatListPage`, `ChatRequestsPage`, `ChatScreenPage`.
**Fix if in scope:** port the chat routes, add `messages`/`chat_requests`
collections and indexes, add the three mobile screens + tab, and a
`new_message` push/socket event.

### P2-2 — Favorites

Old: `POST /favorites/add`, `POST /favorites/remove`, `GET /favorites`,
`GET /favorites/check/{model_id}`; mobile `favorites.tsx`; web `FavoritesPage`.
**Fix if in scope:** add a `favorites` collection `{user_id, creator_id}` with a
unique index, the four routes, and a Favorites tab/shortcut.

### P2-3 — Earnings endpoints and creator earnings screen

Old: `GET /profile/earnings/overview|breakdown|calls|gifts` (`server.py`
9385–9606); mobile `earnings.tsx`.
**Current behaviour:** Mobile derives a single `earnings_balance`; no breakdown,
no per-call/gift lists.
**Fix if in scope:** port the four aggregate endpoints and an Earnings screen
(totals, by period, call list, gift list). The wallet already shows the balance.

### P2-4 — Support message list and admin mark-read

Old: `GET /support/messages` (`server.py` 9641), admin
`POST /admin/support/messages/{id}/mark-read` (9738).
**Current behaviour:** only `POST /support/message` and admin list+reply exist.
**Fix if in scope:** add the user’s own messages list and admin mark-read.

### P2-5 — Withdrawal request-increase flow

Old: `POST /withdrawal/request-increase`, `WithdrawalIncreaseRequest` model,
admin page `WithdrawalIncreaseRequests.tsx`.
**Current behaviour:** none of this exists; there is no per-user withdraw cap to
increase.
**Fix if in scope:** either port the whole cap/approval flow, or drop the
concept and document it.

### P2-6 — Generic moderation endpoints

Old: `POST /report-user`, `POST /block-user`, `POST /report-call`.
**Current behaviour:** new has `POST /calls/{id}/report` and
`POST /users/{id}/block` only. Reporting a user outside a call is impossible.
**Fix if in scope:** add `POST /report-user` and `POST /block-user` (or reuse
`/users/{id}/block` and add an unblock/list route). Note old web had a
`moderationAPI`.

### P2-7 — Followers list and follow status

Old: `GET /follow/status/{model_id}`, `GET /follow/followers`,
`GET /follow/following`.
**Current behaviour:** only `GET /following` and follow/unfollow exist. A creator
cannot see followers; the app cannot check follow status without the full
profile payload.
**Fix if in scope:** add `GET /followers` (creator side),
`GET /follow/status/{creator_id}`.

### P2-8 — Public reviews list and stats

Old: `GET /models/{model_id}/reviews`,
`GET /models/{model_id}/reviews/stats`.
**Current behaviour:** reviews are only embedded in the creator payload
(recent 10). No pagination or aggregate endpoint.
**Fix if in scope:** add the two endpoints plus a “See all reviews” screen.

### P2-9 — Admin financial dashboard

Old admin pages: `FinancialDashboard`, plus endpoints
`/admin/financial/overview|transactions|commissions|analytics`.
**Current behaviour:** new admin has Overview/LiveOps/CallLogs/Creators/
Withdrawals/Support/Broadcast/Health only. `apps/admin/src/pages` has no
financial page.
**Fix if in scope:** port the four endpoints and a Financial page (GMV,
commission, transactions, top creators).

### P2-10 — Standalone Agora token endpoint

Old: `POST /agora/token`.
**Current behaviour:** tokens are minted internally and returned on accept/
prepaid-start; there is no public route.
**Why it may matter:** external clients (web) and manual QA relied on it.
**Fix if in scope:** add `POST /agora/token` guarded by `require_user`, returning
`agora_service.build_rtc_token(channel)`.

### P2-11 — Web app scope (SKip this for now)

Old `webapp/` was a near-full client (home, creators, profile, wallet, calls,
chat). New `apps/web` has landing, privacy, terms, delete-account only
(`apps/web/src/pages`).
**Fix if in scope:** decide whether the web is a marketing/legal surface (leave
as is) or a call-capable client (large port). Document the decision in
`docs/MIGRATION.md`.

---

## 4. P3 — Branding, config, docs, tech debt

### P3-1 — `voxora-*` identifiers vs Simple Talk (This is not a big issue for now, voxora is in code level only right, not a problem)

- **Files/examples:** `apps/mobile/package.json` name `voxora-mobile`,
  `apps/admin/package.json` name `voxora-admin`,
  `packages/shared-types/package.json` `@voxora/shared-types`,
  `apps/api/app/main.py` logger `"voxora"`, `apps/api/app/workers/*` loggers,
  `apps/api/.env` and `.env.example` `MONGODB_DB=voxora`,
  `render.yaml` service `voxora-api`, `docker-compose.yml` volumes
  `voxora_mongo`/`voxora_redis`, root `package.json` name `voxora`, admin
  `localStorage` also reads `voxora_admin_token` (kept for backward compat).
- **Why it matters:** mixed identity, and the Mongo DB name appears in
  user-visible config. Legacy token keys are intentional fallbacks — keep those.
- **Fix:** rename internal package names, loggers, Docker volumes, service name,
  and default `MONGODB_DB` to `simpletalk` where safe. If the live DB is named
  `voxora`, keep `MONGODB_DB=voxora` for production and only change the default
  in code, then document it. Do **not** rename the Render service casually (it
  changes the URL referenced across docs and `.env`).
- **Acceptance test:** no user-visible string says “voxora”; production config
  change is intentional and documented.

### P3-2 — Unused `DEV_OTP_CODE`, hardcoded `7723` (No i want the 7723 hardcoded otp even in the production)
- **Files:** `apps/api/.env.example` line 20, `apps/api/app/services/auth_service.py`
  line 250, `apps/api/app/core/config.py` (no `dev_otp_code` field).
- **Current behaviour:** `.env.example` advertises `DEV_OTP_CODE=123456`, docs
  say `123456`, but the code ignores the env var and hardcodes `7723`.
- **Fix:** add `dev_otp_code: str = ""` to `Settings`, read it in `auth_service`,
  remove the hardcode, and set `DEV_OTP_CODE=7723` (or `123456`) in
  `.env.example` / dev docs. Tie this to P0-1.
- **Acceptance test:** changing `DEV_OTP_CODE` changes the dev shortcut; empty
  value disables it.

### P3-3 — OTP length contradiction in docs (OTP should be 4 digits only)

- **Files:** `docs/USER_FLOW.md` lines 39/148 say 6-digit;
  `apps/mobile/app/(auth)/login.tsx` and `backend` schema/`otpLength=4` say
  4-digit.
- **Fix:** standardise on the real value (4-digit, matching MessageCentral) and
  correct the docs. Update E2E checklist wording.
- **Acceptance test:** docs and UI agree on 4 digits.

### P3-4 — Force update opens the wrong store page

- **File:** `apps/mobile/src/components/ForceUpdateGate.tsx` lines 45–54.
- **Current behaviour:** opens `https://play.google.com/store` (root, not the
  app) or `https://apps.apple.com`.
- **Fix:** open `https://play.google.com/store/apps/details?id=com.simple_talk.app`
  and the real App Store URL; make the URL configurable via `app_config`.
- **Acceptance test:** tapping “Update now” opens the Simple Talk listing.

### P3-5 — Unused `apps/api/google-services.json`

- **File:** `apps/api/google-services.json`.
- **Current behaviour:** present in the API dir (gitignored) but the server uses
  `FIREBASE_CREDENTIALS_PATH` → `firebase-adminsdk.json`.
- **Fix:** remove the client `google-services.json` from the API app; keep the
  Admin SDK JSON only. Prevents confusing the two (see P1-5, FCM_DEVICE_QA).

### P3-6 — `/creator/[id]` not declared in the root Stack

- **Files:** `apps/mobile/app/_layout.tsx` line 195 declares
  `<Stack.Screen name="creator/[id]" />`, but there is no route directory
  `app/creator/` in the current tree listing (the file resolves at runtime).
- **Current behaviour:** `app/creator/[id].tsx` exists (269 lines) but the
  directory was absent from the first directory listing — verify the file is
  actually inside `app/creator/`.
- **Fix:** confirm the path is `apps/mobile/app/creator/[id].tsx` and that
  typed routes build. If it was moved, update the Stack name.
- **Acceptance test:** `npx tsc --noEmit` and a tap on a browse card opens the
  profile.

### P3-7 — Missing DB indexes

- **File:** `apps/api/app/core/database.py` `_ensure_indexes`.
- **Current gaps:** no index on `notifications.user_id`,
  `withdrawal_requests.status`, `support_messages.created_at`,
  `otp_codes.phone`, `reports.reported_id`, `verification_requests.user_id+status`,
  `transactions.metadata.order_id` (used by payment lookup),
  `call_records.call_id+status`.
- **Fix:** add the indexes; the payment lookup and notification list will scan
  otherwise.
- **Acceptance test:** `explain()` on the order lookup uses an index; no
  collection scans on the hot paths.

### P3-8 — Rate-limit fallback is per-process

- **File:** `apps/api/app/core/rate_limit.py` lines 28–37.
- **Current behaviour:** when Redis is down, limits use an in-process dict, so
  multi-instance deployments can be bypassed, and a restart clears counters.
- **Fix:** acceptable for now; document it. For production with >1 instance,
  require Redis or move to a shared store.
- **Acceptance test:** noted in `RENDER_DEPLOY.md` that multi-instance requires
  Redis for rate limiting.

### P3-9 — Stale validation tables

- **Files:** `docs/USER_FLOW.md` “Code validation” table,
  `docs/MODEL_FLOW.md` “Code validation” table.
- **Current behaviour:** many rows are now fixed in code (see §11) but still
  marked Fail/Partial.
- **Fix:** re-run the checklists against the current tree and correct the tables,
  or delete the validation sections and keep only the test scripts.
- **Acceptance test:** every Fail row in the tables has a matching open item in
  this doc, or is corrected.

---

## 5. Money and billing — confirmed behaviour

These were suspected but are currently **correct**; keep the tests.

- **Minute billing idempotency.** `prepaid_start` bills minute 1, then
  `start_billing_loop` ticks every 60s (`call_service.py`). The client
  `billTimer` (only for `role === "caller"`, `call-screen.tsx` line 136) calls
  `/bill-minute` too. Both funnel into `bill_next_minute`, which atomically
  requires `last_billed_minute < next` **and** `last_billing_time <= now-55s`.
  A second actor at the same boundary fails the atomic update and returns
  without a second debit. The receiver does **not** start a bill timer
  (`startTimers(false)`).
  - **Action:** keep `USER_FLOW.md` U-5.5; add a concurrent-tick test to prove
    one debit per boundary, then correct the doc row to Pass.
- **Commission is single.** Minute debits move `total_amount`; creator earnings
  are one `CALL_CREDIT` at `finalize_call`, guarded by an existing-transaction
  check. Gifts credit `GIFT_CREDIT` immediately at gift time. No double 15%.
- **Disconnect grace.** 20s (`disconnect_service.py`), finalises to
  `ENDED_DISCONNECT` after grace; `reconnect` cancels it. If Redis is down the
  finalise is unconditional after the sleep — acceptable.
- **Sweeper.** Ringing >2 min → MISSED; ACCEPTED/LIVE >3h → ENDED_DISCONNECT
  (`sweep_stuck_calls`). Ring timeout is 45s, so ringing rarely reaches 2 min.

---

## 6. Verification items (source review only, not device-proven)

These are written but not proven; run them on a native build.

1. **Killed-state ring (M-4.4 / U-6.3).** `index.js` FCM background handler →
   `savePendingCall` + `showIncomingCallNotification` (full-screen CALL,
   45s timeout) → `consumePendingCall` on launch. `decline_token` decline uses
   unauthenticated `/reject-token`. **Depends on P1-5 being fixed.**
2. **Accept cold-start.** Notifee accept → `savePendingCall({action:"accept"})`
   → `incoming-call.tsx` `autoAccept` → `accept()`. Confirm the receiver joins
   with the `agora` tokens returned by `POST /calls/{id}/accept` (passed as
   `agoraToken`/`agoraAppId` params, consumed in `call-screen.tsx` line 441).
3. **Foreground call notification.** Verify `startCallForegroundService` is
   actually invoked on call-screen mount and stopped on leave
   (`CallForegroundService.ts`); confirm the ongoing notification appears when
   the app is backgrounded.
4. **iOS CallKit.** `CallKeepService` no-ops without the native module; confirm
   the build links `react-native-callkeep` and `setupCallKeep` runs.

---

## 7. Admin dashboard gaps ( I want full migration of admin dashboard along with the live monitoring and all features from OLD app)

Current pages (`apps/admin/src/pages`): Login, Overview, LiveOps, CallLogs,
Creators, Withdrawals, Support, Broadcast, Health.

- P2-9 Financial page missing.
- P1-4 stuck-busy data unreliable until fixed.
- No Missed-calls page (old had one) — the API `/admin/calls/missed` exists but
  no UI consumes it.
- No audit view (API `/admin/audit` exists; no page).
- `Creators.tsx` shows selfie/phone (M-2.5 now passes) but does not show rates
  in the decision summary beyond a column — fine.
- `Withdrawals.tsx` has no processed/failed tabs (old `WithdrawalProcessing`);
  API only returns PENDING.

---

## 8. Data migration

`docs/MIGRATION.md` is correct but make the script explicit:

1. Export old `users` where `user_type == "MODEL"` → set `user_type="creator"`.
2. Map `model_profiles` → `creator_profiles`:
   `profile_images` → `images`; carry `is_approved`, `is_dnd`, rates,
   `category`, `languages`, `bio`.
3. Copy `wallets` unchanged.
4. Import `call_records` optionally (history only).
5. Skip all `appointments*` collections.
6. Recreate indexes from `database.py` (P3-7) before import.
7. Stripe/Trustope/ImageKit IDs do not migrate; new uploads go to the Simple
   Talk bucket.
8. Because `notifications`, `reviews`, `follows`, `blocks`, `transactions` are
   re-created, verify referential integrity after import.

---

## 9. Requested implementation order

1. **P0-1, P0-3, P0-4** (auth/secret/referral) — smallest diffs, highest risk.
2. **P0-2** (rotate + move secrets) — do first operationally.
3. **P1-1, P1-2, P1-3, P1-6** — money visibility and notifications.
4. **P1-4, P1-5** — ops correctness and push.
5. **P3-2, P3-3, P3-4, P3-6** — config/branding/doc fixes.
6. **P2-*** — scope decisions with the product owner, then implement.
7. **P3-7, P3-8, P3-9** — hardening and cleanup.

---

## 10. Fix template (use for each PR)

```
ID:            P0-x
Files:         ...
Change:        ...
Test:          ...
Risk/rollback: ...
```

---

## 11. Re-verified as already fixed (do not re-implement)

These were listed as Fail/Partial in the docs or suspected during review, but the
current code already handles them:

| Item | Evidence |
|------|----------|
| M-1.5/1.7/1.8/1.9 login onboarding skip | `login.tsx` `router.replace("/")`; `index.tsx` reads `onboardingStatus` and routes to the correct step |
| M-2.1 rate minimums | `pricing_setup` raises 400 below `min_audio_rate`/`min_video_rate`; mobile validates ₹3/₹7 |
| M-2.5 admin pending shows selfie/phone | `admin.py` `pending_creators` returns profile+user; `Creators.tsx` renders selfie/phone/images |
| M-2.6/M-2.7 approve/reject Updates row | `admin.py` `_notify_user` inserts a `notifications` row + push on both |
| M-3.4 edit rates resets verification | `pricing_setup` only sets `pending_photos` when `not already_approved` |
| M-6.4/M-6.5/M-7.2–7.5 withdrawal notifications | `mark_paid` / `reject_withdrawal` call `_notify_user` |
| U-1.2 pasted +91 handling | `nationalDigits` strips a leading `91` for 12-digit input |
| U-7.2 Updates never marked read | `notifications.tsx` calls `markNotificationsRead()` after load |
| Minute double-billing | 55s gate + `last_billed_minute` atomic guard in `bill_next_minute` |
| Review/report/block wired in app | `call-review.tsx` calls `callsAPI.report` and `creatorsAPI.block` |
| Socket connect wiring | `authStore` connects; `_layout` and `call-screen` register listeners |
| `/creator/[id].tsx` implementation | Fully implemented (269 lines) |

---

## 12. Implementation status

Updated after the fix pass. Legend: **Done** = code changed and validated;
**Skipped** = intentionally left per author's inline comments.

| ID | Status | Where |
|----|--------|-------|
| P0-1 | Skipped | Author wants `7723` hardcoded in all environments — left as-is |
| P0-2 | Skipped | Author rotates/handles secrets themselves |
| P0-3 | Done | `from datetime import datetime, timezone` added to `referral_service.py` |
| P0-4 | Done | `apps/admin/src/pages/Login.tsx` fields start empty |
| P1-1 | Done | `WALLET` writes `WITHDRAW_HOLD`; admin reject/error write `WITHDRAW_REVERSED` |
| P1-2 | Done | `emit_to_user("new_notification")` in `admin._notify_user`, broadcast, and `follower_notify_service`; mobile listener + toast |
| P1-3 | Done | `unread-count`, per-item read, delete added; mobile store, badge, per-item read/delete |
| P1-4 | Done | `is_busy` dead code removed from `admin._live_ops_metrics` and `force_offline` |
| P1-5 | Skipped | Author: no problem with the second package |
| P1-6 | Done | `app/support.tsx` + Profile link + `GET /support/messages` |
| P2-1 | Skipped | Chat not required |
| P2-2 | Done | favorites API + `app/favorites.tsx` + creator-profile toggle |
| P2-3 | Done | `routers/earnings.py` (4 endpoints) + `app/earnings.tsx` |
| P2-4 | Done | user `GET /support/messages`; admin `mark-read` |
| P2-5 | Done | wallet `request-increase` + `requests`; admin page + endpoints; mobile inline field |
| P2-6 | Done | `/report-user`, `/report-call`, `/block-user`, `/unblock-user`, `/blocked-users` |
| P2-7 | Done | `/follow/status/{id}`, `/follow/followers`, `/follow/following` |
| P2-8 | Done | `/models/{id}/reviews` + `/stats`; `app/reviews.tsx` + “See all” |
| P2-9 | Done | `/admin/financial/*` (5 endpoints) + `Financial.tsx` |
| P2-10 | Done | `POST /agora/token` |
| P2-11 | Skipped | Web left as marketing/legal surface |
| P3-1 | Skipped | Code-level `voxora` names left; author not concerned |
| P3-2 | Skipped | Keep hardcoded `7723`; docs corrected instead |
| P3-3 | Done | USER_FLOW/MODEL_FLOW/E2E/DEVELOPMENT updated to 4-digit / `7723` |
| P3-4 | Done | `ForceUpdateGate` uses the real listing, configurable via `app/config` |
| P3-5 | Done | `apps/api/google-services.json` removed |
| P3-6 | Done | `/creator/[id]` verified present and typed routes build |
| P3-7 | Done | indexes added in `core/database.py` and in the migration script |
| P3-8 | Done | documented in `RENDER_DEPLOY.md` |
| P3-9 | Done | USER_FLOW/MODEL_FLOW validation tables corrected |
| §7 admin | Done | Financial, Missed calls, Audit, Limit requests, withdrawal tabs, monitor token, verified creators, support read |
| §8 migration | Done | `apps/api/scripts/migrate_from_celebconnect.py` + MIGRATION.md |

Validation: `apps/api` imports clean; `apps/mobile` `tsc --noEmit` clean;
`apps/admin` `tsc --noEmit` and `vite build` clean; `apps/web` `tsc` + build clean.
