# KwikUPI recharge integration

Recharge payments run on **KwikUPI hosted checkout** and credit the wallet only
after the server verifies a successful live payment with KwikUPI.

KwikUPI has **no sandbox**. Every checkout created by this integration is a live
payment. Test with a real ₹50 recharge from an internal test account.

## Money flow

1. The app opens `GET /api/wallet/recharge?token=…` in an in-app browser.
2. The page lets the user pick a pack or enter a custom amount. The minimum is
   **₹50**; the maximum is **₹1,00,000** by default.
3. `POST /api/wallet/recharge/session` creates a local `RECHARGE_PENDING`
   transaction and calls KwikUPI `POST /create-payment`.
4. KwikUPI returns a hosted `payment_page` URL. The browser is redirected there.
5. On success KwikUPI calls the signed webhook and redirects the browser to
   `/api/wallet/recharge/return?order_id=…`.
6. The server calls `GET /payment-status/{payment_id}` and checks:
   - status is `TXN_SUCCESS`,
   - `order_id` matches the local order,
   - `payment_id` matches the stored payment,
   - the paid `amount` exactly matches the local gross amount.
7. Only then:
   - the user is credited **94%** (gross minus the 6% fee),
   - the platform commission ledger gets one **6%** row,
   - the transaction becomes `RECHARGE` / `SUCCESS`.

The webhook signature is verified with `HMAC-SHA256(raw body, API secret)` from
the `X-Webhook-Signature` header. The webhook's `status` and amount are **never**
trusted on their own; the status API is the source of truth.

## Idempotency and edge cases

- **Duplicate webhook / return page / retry / reconciler** — safe. The wallet
  update stores the order id in the same atomic MongoDB update as the balance
  increment, so the increment can only happen once per order.
- **Crash after credit but before marking the transaction** — the retry sees
  the wallet marker and does not credit twice.
- **Concurrent settlements** — both may run, but only one wallet increment and
  one platform-balance increment can apply. The commission ledger uses a
  deterministic `commission_id`.
- **Amount tampering / mismatch** — no credit. The order is marked `REVIEW`,
  with the gateway amount and reason stored in `transactions.metadata`.
- **Abandoned payment** — the order stays `PENDING`; the app checks it when the
  wallet regains focus, and the background sweeper checks older pending orders
  every ~2 minutes after they are 10 minutes old.
- **Failed/cancelled payment** — marked `FAILED`; no credit.
- **No credentials** — recharge returns a clear unavailable message instead of
  falling back to a fake/dev credit.
- **Old dev completion endpoint** — disabled (404). There is no way to credit a
  recharge without a verified live payment.

`transactions.metadata.status` values:

| Status | Meaning |
|--------|---------|
| `PENDING` | Created, not paid or gateway still pending |
| `PROCESSING` | A worker is settling it |
| `SUCCESS` | Paid, verified, wallet credited |
| `FAILED` | Gateway reported failure or order creation failed |
| `REVIEW` | Paid status could not be safely matched; needs manual review |

## Required configuration

### API environment (Render / production `.env`)

```env
BACKEND_URL=https://voxra-dkfe.onrender.com

KWIKUPI_BASE_URL=https://kwikupi.com/api
KWIKUPI_API_KEY=<merchant API key>
KWIKUPI_API_SECRET=<merchant API secret>

# Optional. Defaults to BACKEND_URL + /api/wallet/recharge/return
KWIKUPI_RETURN_URL=https://voxra-dkfe.onrender.com/api/wallet/recharge/return

MIN_RECHARGE_AMOUNT=50
MAX_RECHARGE_AMOUNT=100000
RECHARGE_COMMISSION_RATE=0.06
RECHARGE_GATEWAY_RATE=0.03
RECHARGE_SERVICE_RATE=0.03
```

`KWIKUPI_API_KEY` and `KWIKUPI_API_SECRET` must come from the KwikUPI Merchant
Dashboard. Do not commit them. Mark them as secret/sync-off in Render.

### KwikUPI Merchant Dashboard

1. Add/verify the Paytm business account that should receive the money.
2. Generate the API key and API secret.
3. Set the webhook URL to:

   ```text
   https://voxra-dkfe.onrender.com/api/wallet/recharge/webhook
   ```

   (`/api/wallet/recharge/kwikupi/webhook` is an alias.)

4. Make sure the webhook is enabled for successful payments.

KwikUPI signs the raw webhook body using the **API secret**. If the secret is
rotated, update the API env var immediately; old signatures will fail.

> **Legacy orders:** pending orders created by the old Cashfree flow are
> intentionally not polled through KwikUPI. Reconcile or expire any open
> Cashfree orders manually before/after switching.

### Public URLs

- `BACKEND_URL` must be the public HTTPS API origin. The return URL and payment
  redirect are built from it.
- The webhook URL must be reachable without authentication and must not be
  blocked by CORS (server-to-server).
- If you change the Render service URL, update `BACKEND_URL`, `KWIKUPI_RETURN_URL`
  (if set), and the KwikUPI dashboard webhook URL.

### Database

Restarting the API creates/updates these indexes automatically:

- `wallets.user_id` (unique)
- `transactions.metadata.payment_id` (sparse)
- `platform_wallet.platform_id` (unique)
- `platform_commissions.commission_id` (unique, sparse)

The unique `commission_id` index is what prevents a duplicate recharge
commission row. Do not drop these indexes in production.

## End-to-end test (live)

1. Set the four `KWIKUPI_*` values and `BACKEND_URL`.
2. Restart the API and confirm startup has no index errors.
3. Check `GET /api/healthz`; it must report `"kwikupi_configured": true`.
4. Open the app → Wallet → Recharge.
5. Pay ₹50 with a real UPI account.
6. Confirm:
   - the return page says payment successful,
   - the wallet increases by exactly **₹47.00**,
   - a `RECHARGE` transaction exists with `metadata.credit_amount = 47.0`,
   - one `RECHARGE_COMMISSION` row exists for the order with amount `3.0`,
   - re-opening the webhook (or refreshing the return page) does **not** add
     another ₹47.
7. Close the browser immediately after paying, reopen Wallet, and confirm the
   pending order is recovered by `/recharge/verify-pending`.
8. For a failure test, abandon the KwikUPI page without paying and confirm the
   order remains pending/failed and the wallet is unchanged.

## Manual review

Set a log alert for `requires manual review` so a stuck payment is noticed
quickly. If `transactions.metadata.status` is `REVIEW`, inspect:

```text
metadata.review_reason
metadata.gateway_status
metadata.gateway_amount
metadata.payment_id
metadata.gateway_transaction_id
```

Do not manually add balance until the order/payment/amount has been checked in
the KwikUPI dashboard. `REVIEW` is intentionally not re-polled automatically, so
a bad amount/ID can never be auto-credited; resolve it as a support case with
the order id and either refund the payment or make an audited manual adjustment.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| "Payment gateway is not configured" | `KWIKUPI_API_KEY` / `KWIKUPI_API_SECRET` missing in the running API process |
| 401 on webhook | Raw body modified by a proxy, wrong API secret, or signature header stripped |
| 502 on webhook | API could not reach KwikUPI status API; it will retry |
| Paid but still pending | `payment_id` stored? status API reachable? background reconciler retry after 10 minutes |
| Paid but `REVIEW` | Amount/order/payment mismatch; see metadata and KwikUPI dashboard |
| Return page says processing | Webhook may not have arrived yet; app/wallet verify-pending or reconciler will settle |
