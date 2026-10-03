# Call Flow, Billing & Withdrawal — Deep Analysis and Fix Plan

Status: source-verified against `apps/api`, `apps/mobile`, `apps/admin` and
`celebconnect-v2/backend/server.py` + `frontend`. This document is both the
end-to-end description of the call flow and the list of gaps/bugs to fix.

Severity: **P0** money/security, **P1** broken flow, **P2** missing old feature,
**P3** polish.

---

## Part A — End-to-end call flow (as the code actually is)

### A1. Outgoing call: fan → creator

1. Fan taps **Audio/Video** on the creator page (`app/creator/[id].tsx`).
2. App shows the first-call disclaimer (`ensureCallDisclaimer`), then requests
   mic (and camera for video) via `ensureCallPermissions`.
3. App calls `creatorsAPI.status(id)` and blocks if `DND`/`BUSY`.
4. `POST /api/calls/initiate` → `call_service.initiate_call`:
   - Validates receiver is an approved creator with instant calls enabled.
   - Blocks DND; **allows OFFLINE** (push-wake).
   - Computes `min_balance = (rate/60)*30` and rejects with 402 if the fan is short.
   - Takes a Redis **ring lock** (`ring:{receiver}`); Mongo `RINGING` fallback.
   - Inserts `call_records` row: `status=RINGING`, `rate_per_minute`,
     `last_billed_minute=0`, `decline_token`, `channel_name=channel_{call_id}`.
   - Sends data-only FCM to the creator + emits `incoming_call` + `creator_status BUSY`.
   - Schedules the 45s ring timeout (`miss_call`).
5. Fan screen (`call-screen.tsx`, role=caller) plays ringback; listens for
   `call_accepted`, `call_rejected`, `call_missed`, `call_ended*`.

### A2. Creator receives

- Foreground: socket `incoming_call` → `/incoming-call` screen.
- Background/killed: data-only FCM → Notifee full-screen Accept/Decline;
  decline uses `decline_token` unauthenticated.

### A3. Accept

1. Creator taps Accept → permission check → `POST /calls/{id}/accept`.
2. `call_service.accept_call`: requires receiver, `RINGING` → `ACCEPTED`,
   clears ring lock, mints Agora token, emits `call_accepted` + cancels caller's
   call notification.
3. Creator screen routes to `/call-screen` with `role=receiver` and the Agora tokens.
4. Fan's `onAccepted`: joins Agora, then (caller only) calls
   `POST /calls/{id}/prepaid-start` and starts the UI timers.

### A4. Billing — current new behaviour

- **Minute 1**: `prepaid_start` debits `rate` from the fan's spendable balance,
  sets `status=LIVE`, `last_billed_minute=1`, `total_amount=rate`, and starts a
  server billing loop (`start_billing_loop`).
- **Minute 2+**: the server loop calls `bill_next_minute` every 60s. A fan-side
  client timer also calls `/bill-minute` as a backup. `bill_next_minute` atomically
  requires `last_billed_minute < next` **and** `last_billing_time <= now-55s`, so
  only one actor debits per boundary.
- On each debit: the fan's `balance` drops by `rate`; `call_records.total_amount`
  increments. **Commission is NOT applied per minute.**
- Low balance (< 2 min left) emits `call_low_balance_warning`.
- Fan's balance cannot go negative (`atomic_debit`).
- **Creator earnings are credited only once, at call end**, as a single
  `CALL_CREDIT` = 85% of `total_amount`; the platform gets 15% as a single
  `COMMISSION` row; a `CALL_DEBIT` is written for the fan.

### A5. End / disconnect

- Fan/creator End → confirm → `POST /calls/{id}/end` → `finalize_call`:
  computes duration, commission split, credits creator earnings (once),
  writes `CALL_DEBIT`/`CALL_CREDIT`/`COMMISSION`, updates `creator_status`.
- Network drop → 20s grace (`disconnect_service`) → `handle-disconnect` →
  finalize as `ENDED_DISCONNECT`; peer return cancels grace via `/reconnect`.
- Ring timeout 45s → `MISSED`; sweeper clears stuck RINGING >2min and
  ACCEPTED/LIVE >3h.

### A6. Gift (in-call)

Fan taps a gift → `POST /calls/{id}/gift`. Currently debits the fan, credits
the creator **net of the same 15% call commission**, emits `gift_sent`/`gift_received`.

---

## Part B — Confirmed gaps and bugs vs the old app

### P0-1 — Per-minute creator credit & platform commission are missing

**Old behaviour (verified, `server.py` 6991–7216):** every minute boundary the
fan is debited `rate`, and **simultaneously** the creator's `earnings_balance` is
increased by 85% of that minute and the platform commission (15%) is recorded.
New code only debits the fan per minute; creator/platform are settled at the end.

**Impact:** the creator's live earnings never move during the call; if the app
crashes mid-call before `finalize_call`, the creator is **never paid** even though
the fan was debited. This is a money-loss bug.

**Fix:** in `prepaid_start` (minute 1) and `bill_next_minute` (minute 2+), after
debiting the fan, immediately:
- credit `85%` to the creator's `earnings_balance` (idempotent per
  `call_id + minute`),
- add `15%` to `platform_wallet` and insert a **`platform_commissions`** doc with
  `type: "CALL_COMMISSION"`, `gross_amount=rate`, `amount=15%`,
  `model_earnings=85%`, `source_id=call_id`, `metadata.minute`.
- Remove the end-of-call `CALL_CREDIT`/`COMMISSION` creation (or keep only a
  reconciliation no-op) to avoid double-paying.

### P0-2 — Gift commission is wrong (15% instead of 2%)

**Old behaviour (`commission_service.py`):** gifts use **2% platform / 98% creator**.
New `calls.py` gift uses `calculate_commission` → **15%**, and does not write a
`platform_commissions` doc nor credit the platform wallet.

**Fix:** add `calculate_gift_commission` (2%/98%), use it in the gift endpoint,
credit the platform wallet, and insert `platform_commissions`
`type: "GIFT_COMMISSION"`.

### P1-1 — Live earnings events for the creator are missing

Old emits `call_prepaid_billed` to the **receiver** with
`receiver_earnings_balance` so the creator's screen shows live earnings. New
`prepaid_start`/`bill_next_minute` emit `call_prepaid_billed` to both, but the
payload has no earnings figure, and the creator ledger is not credited per minute
(see P0-1). The mobile creator screen only accumulates `gift_received` net.

**Fix:** include `receiver_earnings_balance` (or `model_earnings_delta`) in the
receiver payload; the creator call screen should show a **live earnings wallet**
updating each minute from that event (and on load from wallet API).

### P1-2 — Fan live wallet isn't fetched on join

`call-screen.tsx` shows `bal ₹{balance}` only from socket events; on first join it
does one `walletAPI.balance()` **only for the caller** and it can read ₹0 until
the first bill. Old app refreshed balance on join and on each billing event.

**Fix:** fetch balance for both roles on LIVE, and update from every
`call_prepaid_billed`. For the creator, fetch `earnings_balance`.

### P1-3 — Timeout duration mismatch

Docs say "45 seconds" throughout; `config.call_ring_timeout_seconds` is 45 and
the mobile countdown is 45. OK — but the Notifee `timeoutAfter` is 45000ms. No
bug; keep in sync if changed. (Listed to avoid drift.)

### P1-4 — Withdrawal collects no bank details and no saved payout info

**Old behaviour (`server.py` 7995–8108):** withdrawal requires **UPI id AND full
bank details** (bank name, account number, IFSC, account holder), validates UPI
contains "@", enforces **min ₹250 / max ₹25000**, a **per-day request count**
(`max_withdraw_requests`, default 2), debits `earnings_balance` atomically, writes
a `WITHDRAWAL` transaction, **saves bank_details + upi_id back onto the creator
profile** for next time, and notifies admins.

**New behaviour (`wallet.py` withdraw):** takes only `amount`, `upi_id`,
`account_name`; min ₹100; no bank details; no daily limit; does not save payout
details; no `WITHDRAWAL` transaction type (it writes `WITHDRAW_HOLD`).

**Fix:**
- Schema `WithdrawalRequest`: add `bank_details: {bank_name, account_number,
  ifsc_code, account_holder_name}`, keep `upi_id`.
- Validate min/max, UPI format, required bank fields; enforce daily limit from
  `creator_profiles.max_withdraw_requests` (default 2).
- Persist `bank_details` + `upi_id` onto `creator_profiles`.
- Add `GET /wallet/withdrawal/profile` (or include in `/auth/me` creator_profile)
  so the app can prefill.
- Keep the `WITHDRAW_HOLD` ledger row (new-model) but ALSO satisfy the filter by
  including `WITHDRAW` in the type (or update filters).

### P1-5 — Withdrawal mobile UI is a bare inline form

The wallet tab has three cramped `TextInput`s. Old app has a dedicated
**Withdrawal Requests** screen with: available call-earnings, saved bank/UPI
prefill, amount, bank fields, UPI, daily-limit indicator, request list with
status, and a limit-increase request.

**Fix:** add `app/withdraw.tsx` (or a `withdrawal-requests` screen) linked from
the wallet/earnings, with all fields + request history; keep the wallet tab for
balance/recharge/ledger.

### P2-1 — `platform_commissions` only records recharges

`record_platform_commission` helper exists but is only called from the recharge
path. Calls and gifts must also write `CALL_COMMISSION` / `GIFT_COMMISSION`.

### P2-2 — Admin recharge-commission UI exists; call/gift commissions not shown

`/admin/financial/recharge-commissions` is wired. Add a filter or a combined
`/admin/financial/platform-commissions?type=` so admins see call & gift
commission docs too.

### P2-3 — No "call will end soon" end-of-balance handling parity

Old ends the call cleanly when the next minute can't be covered and credits
earnings for minutes already billed (done per-minute after P0-1). Verify the new
`bill_next_minute` still finalizes with `ENDED_INSUFFICIENT_BALANCE` and that
per-minute credits already applied are not duplicated at finalize (handled by
per-minute idempotency keys).

### P3-1 — Duplicate call-credit idempotency keys after P0-1

After moving credit to per-minute, `finalize_call`'s single `CALL_CREDIT`
(`tx_{call_id}_credit`) must be removed; otherwise a call would be paid twice.
Keep a small reconciliation that only fills any missing minutes (safety).

### P3-2 — Wallet tab shows "After ~15% commission" text for creators

Fine to keep; ensure it matches the 15% call / 2% gift split (gift net is 98%).
Show both or generalize the wording.

### P3-3 — Gift only allowed from caller

Old allowed either participant (receiver = the other party, but only models
receive). New restricts to caller. Acceptable product choice; document it. If
creators should gift fans, relax the check.

---

## Part C — Payout / bank-details model to implement

### Creator profile fields
```
creator_profiles:
  upi_id: str | None
  bank_details: {
    bank_name, account_number, ifsc_code, account_holder_name
  } | None
  max_withdraw_amount: float = 25000
  max_withdraw_requests: int = 2
```

### Withdrawal request doc
```
withdrawal_requests:
  request_id, user_id, amount,
  withdrawal_method: "BANK_AND_UPI",
  upi_id, bank_details,
  status: PENDING|PAID|REJECTED|FAILED,
  admin_notes, payment_error_remarks,
  created_at, processed_at
```

### Transaction rows
- `WITHDRAW_HOLD`  −amount (earnings hold) [new model]
- `WITHDRAW_REVERSED` +amount on reject/error

---

## Part D — Target per-minute billing algorithm (fixed)

For a call with `rate` and commission rate `c=0.15`:

```
on prepaid_start (caller joins media)        # minute 1
  claim call_record: RINGING/ACCEPTED -> LIVE, last_billed_minute<1  (atomic)
  debit caller.balance -= rate                 (atomic, >= rate)
  if fail: finalize(ENDED_INSUFFICIENT_BALANCE)
  model_cut   = round(rate * 0.85, 2)
  platform_cut= round(rate - model_cut, 2)
  credit creator.earnings_balance += model_cut
  platform_wallet += platform_cut
  platform_commissions.insert(CALL_COMMISSION, minute=1, ...)
  call_records.total_amount += rate
  emit call_prepaid_billed to caller {balance, total_billed, minute}
  emit call_prepaid_billed to receiver {earnings_balance, minute, amount}
  start server billing loop

every 60s (bill_next_minute)                  # minute N+1
  atomic guard on last_billed_minute & last_billing_time<now-55s
  debit caller.balance -= rate
  if fail: finalize(ENDED_INSUFFICIENT_BALANCE); stop
  credit creator 85%, platform 15%, insert CALL_COMMISSION(minute N+1)
  total_amount += rate
  emit prepaid_billed to both (caller: balance; receiver: earnings_balance)
  if caller.minutes_remaining < 2: emit low_balance_warning

on end/disconnect
  finalize: set duration/status; DO NOT re-credit (already per-minute)
  write CALL_DEBIT summary (caller) if not present
  reconciliation: for any minute in total_amount/rate not credited, credit it
```

Idempotency keys:
- per-minute: `platform_commissions` unique on `(source_id, metadata.minute, type)`.
- creator credit per minute: transaction id `tx_{call_id}_m{minute}`.
- recharge: as already implemented.

---

## Part E — Implementation order

1. **P0-1 + P2-1 + P3-1** — per-minute creator credit + `CALL_COMMISSION` docs;
   remove end-of-call double credit; reconciliation.
2. **P0-2** — gift 2% commission + `GIFT_COMMISSION` doc + platform wallet.
3. **P1-1 + P1-2** — live earnings/balance events; fetch on join; creator live
   earnings UI on call screen.
4. **P1-4 + P1-5 + Part C** — withdrawal schema, validation, saved bank/UPI,
   daily limit; dedicated withdrawal screen with prefill + history.
5. **P2-2** — admin combined platform-commissions view.
6. **P3-2/P3-3** — wording + gift policy.

Acceptance tests are in `docs/CALL_FLOW_TESTS.md` (to add alongside this doc).

---

## Part F — Open questions to confirm

1. Gift commission: keep old **2%** or align to **15%**? **Answer: 15%.**
2. Can creators gift fans, or caller-only? **Answer: caller only.**
3. Withdrawal minimum: old **₹250** vs new **₹100**? **Answer: ₹250.**
4. Daily withdrawal request cap: keep old default **2/day**? **Answer: yes.**
5. Per-minute creator credit: immediate or at end? **Answer: immediate.**

---

## Part G — Implementation status (all fixed)

| Ref | Status | What changed |
|-----|--------|--------------|
| P0-1 | Done | `call_service.settle_minute` credits creator 85% + platform 15% + `CALL_COMMISSION` doc every minute, called from `prepaid_start` (minute 1) and `bill_next_minute` (2+). Idempotent per minute. |
| P0-2 | Done | Gift uses 15% via `calculate_commission`, credits platform wallet and writes `GIFT_COMMISSION`. (Kept at 15% per answer.) |
| P1-1 | Done | Receiver `call_prepaid_billed` now carries `earnings` and `earnings_balance`. |
| P1-2 | Done | Call screen fetches wallet on join for both roles; creator shows live `earnings_balance`; `/calls/active` returns `balance` + `earnings_balance`. |
| P1-4 | Done | `WithdrawalRequest` now carries `BankDetails`; endpoint enforces ₹250 min / ₹25000 max, UPI format, required bank fields, 2/day cap, saves bank+UPI to profile; added `GET /wallet/withdrawal/profile`. |
| P1-5 | Done | New `app/withdraw.tsx` with prefill + request history; wallet links to it. |
| P2-1 | Done | `CALL_COMMISSION` and `GIFT_COMMISSION` docs written via `record_platform_commission`. |
| P2-2 | Done | Admin `platform-commissions` view with type filter (All/Recharge/Call/Gift). |
| P3-1 | Done | `finalize_call` no longer creates the single `CALL_CREDIT`/`COMMISSION`; it reconciles any missing minute instead. |
| P3-2 | Done | Wallet creator card wording updated to "85% of calls & gifts after the 15% platform fee". |
| P3-3 | Done | Gift remains caller-only (per answer). |

Recharge commission docs now also include `source_id`, `gross_amount`, `model_earnings`
so the unified admin table renders them. Unique index added on
`(source_id, type, minute)` for per-minute idempotency.

