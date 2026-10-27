# PayQ recharge integration

Recharge payments run on **PayQ UPI checkout**. The wallet is credited only
after the API server asks PayQ for the authoritative order status and verifies
the order id, success status, and paid amount. A webhook is only a trigger.

PayQ has **no documented sandbox**. Every order created by a production
deployment is a live payment. Use a real ₹50 recharge from an internal account
for the acceptance test.

## Money flow

1. The app opens `GET /api/wallet/recharge?token=…` in an in-app browser.
2. The page lets the user pick a pack or enter a custom amount. The minimum is
   **₹50**; the maximum is **₹1,00,000** by default.
3. `POST /api/wallet/recharge/session` creates a local `RECHARGE_PENDING`
   transaction and calls PayQ `POST /create-order` (form encoded).
4. PayQ returns a hosted `result.payment_url`; the browser is redirected there.
5. On success PayQ sends a signed form webhook and redirects the browser to
   `/api/wallet/recharge/return?order_id=…`.
6. The server calls `POST /check-order-status` with the local order id and
   checks:
   - top-level status is `COMPLETED`,
   - `result.status` is `SUCCESS` (or the documented equivalent),
   - `result.orderId` exactly matches the local order,
   - `result.amount` exactly matches the gross amount the user was quoted,
   - the order was created by the `payq` gateway.
7. The user is credited **94%**. The platform commission ledger records the
   **6%** total split. By default PayQ's 0% gateway commission means the split
   is **0% gateway + 6% service**. The gateway portion is configurable with
   `RECHARGE_GATEWAY_RATE`; the service portion is the remainder of the 6%.
8. The order is atomically marked `SUCCESS`, a deterministic wallet-credit
   marker is written, and the platform commission / referral entries are
   idempotent. Duplicate webhooks, retries, and simultaneous return-page calls
   cannot credit twice.

## Required configuration

Set these on the API service (Render dashboard or `apps/api/.env`):

```dotenv
BACKEND_URL=https://your-public-api-host
PAYQ_BASE_URL=https://payq.cc/api
PAYQ_USER_TOKEN=<merchant API token>
PAYQ_WEBHOOK_SECRET=<separate Webhook Secret from API Setup>
# Optional. Defaults to BACKEND_URL + /api/wallet/recharge/return
PAYQ_RETURN_URL=https://your-public-api-host/api/wallet/recharge/return
```

`PAYQ_USER_TOKEN` and `PAYQ_WEBHOOK_SECRET` are different values. The user token
is sent as a form field on API calls. The webhook secret is used only for the
`hash` field on incoming webhooks. Never put either value in client code, HTML,
logs, documentation, or git.

`BACKEND_URL` must be **HTTPS** in production. PayQ requires an HTTPS
`redirect_url`, and the adapter refuses to create an order with a non-HTTPS
return URL.

### PayQ dashboard

1. Open **API Setup**.
2. Copy the merchant `user_token` into `PAYQ_USER_TOKEN`.
3. Copy the **Webhook Secret** into `PAYQ_WEBHOOK_SECRET`.
4. Set the webhook URL to
   `https://your-public-api-host/api/wallet/recharge/webhook`.
5. Rotate the merchant token if it has ever been pasted into a document, chat,
   or commit. Rotating invalidates the old token immediately; update Render in
   the same change window.

## Webhook signature

PayQ sends `application/x-www-form-urlencoded` data with top-level fields
(`status`, `order_id`, `amount`, `utr`, `hash`, …) and a legacy nested
`result[...]` block. The signature is:

```
hex(HMAC-SHA256(secret, http_build_query($_POST without hash)))
```

This is **PHP serialization**, not the raw body and not JSON:

- fields stay in the order PayQ sent them,
- spaces become `+`,
- keys/values are PHP-`urlencode`d (`@` → `%40`, `:` → `%3A`, `[` → `%5B`),
- the nested `result[...]` block is emitted at the position of the `result`
  parent key, as PHP's `$_POST` array does,
- `hash` is excluded,
- the result is compared in constant time.

`payq_service.verify_webhook_signature()` reproduces this. If the secret is not
configured, the endpoint fails closed with HTTP 503. If the hash is wrong, it
returns HTTP 401. The webhook body's `status` and `amount` are **never trusted**
for settlement; the server always re-fetches the status from PayQ.

## Migration from KwikUPI

1. **Freeze old orders.** Do not create new KwikUPI or Cashfree orders. The new
   code only creates `gateway: "payq"` transactions.
2. **Keep old records intact.** Existing successful recharges, wallet balances,
   and commission entries are not rewritten.
3. **Reconcile old pending orders manually.** Any `RECHARGE_PENDING` document
   with `metadata.gateway` equal to `kwikupi`, `cashfree`, or anything other
   than `payq` will return `LEGACY` and is never polled through PayQ. Check the
   old gateway dashboard and credit/expire those orders manually using the
   existing admin procedure. Do not change their gateway field to `payq`.

   Useful inventory query:

   ```javascript
   db.transactions.find(
     { type: "RECHARGE_PENDING", "metadata.gateway": { $ne: "payq" } },
     { transaction_id: 1, user_id: 1, amount: 1, "metadata.order_id": 1,
       "metadata.gateway": 1, "metadata.status": 1, created_at: 1 }
   ).sort({ created_at: 1 })
   ```
4. **Deploy the new code.** The old adapter and dead Cashfree adapter are
   removed. Rollback is a redeploy of the previous commit, but any PayQ orders
   created in the meantime must then be reconciled manually.
5. **Configure PayQ** using the values above and verify
   `GET /api/healthz` reports both `payq_configured` and
   `payq_webhook_configured` as `true`.
6. **Run the live acceptance test** below before announcing recharge is back.
7. Optional cleanup: remove `KWIKUPI_*` and `TRUSTOPE_*` from the deployed
   environment after old pending orders are resolved. The application no longer
   reads them.

### Legacy order behavior

`verify_with_gateway()` checks `metadata.gateway` before calling PayQ. A legacy
order returns `LEGACY` with no gateway call and no credit. The background
reconciler only selects `metadata.gateway == "payq"`.

## Deployment checklist

- [ ] Rotate the PayQ token if it was exposed.
- [ ] Set `BACKEND_URL` to the public HTTPS API host.
- [ ] Set `PAYQ_USER_TOKEN` and `PAYQ_WEBHOOK_SECRET`.
- [ ] Set the PayQ dashboard webhook URL.
- [ ] Deploy the API and restart it.
- [ ] `GET /api/healthz` shows both PayQ flags true.
- [ ] Run the live ₹50 test below.
- [ ] Check API logs for `PayQ webhook signature verification failed`.
- [ ] Reconcile legacy pending orders.
- [ ] Remove old gateway credentials from the environment.

## Live acceptance test (₹50)

1. Use an internal account with a valid 10-digit Indian mobile number.
2. Open Wallet → Recharge. Confirm the page shows **PayQ** and a ₹50 minimum.
3. Start a ₹50 recharge. Confirm the browser opens a `https://` PayQ payment
   page and the local order is `PENDING` with `gateway: "payq"`.
4. Pay ₹50 with a real UPI app.
5. Confirm the return page shows success and the wallet balance increases by
   **₹47.00**.
6. Confirm the transaction is `RECHARGE` / `SUCCESS`, with
   `metadata.gateway == "payq"`, a `gateway_order_id`, and a UTR.
7. Confirm exactly one `WALLET_CREDIT` marker and exactly one
   `platform_commissions` document for the order.
8. Reply the same webhook (or use the admin/replay tooling) and refresh the
   return page. The balance must not change.
9. Abandon a second ₹50 checkout without paying. Confirm no credit and that the
   order moves to `FAILED` after the pending grace period (currently 2 hours).
   A later authoritative success (for example a delayed webhook) is still
   re-validated and can settle; the timeout only stops background polling.
10. If the webhook hash fails, the return page and background reconciler must
    still settle the order. Investigate the signature serialization before
    going live; do not disable verification.

## Troubleshooting

| Symptom | Check |
|---|---|
| "Recharge is temporarily unavailable" | `PAYQ_USER_TOKEN` missing in the running API process. |
| "Could not start payment" | PayQ `create-order` rejection, network error, non-HTTPS `BACKEND_URL`, or invalid/missing user phone. Check API logs (never log the token). |
| Webhook 503 | `PAYQ_WEBHOOK_SECRET` missing. Set the separate secret from PayQ API Setup. |
| Webhook 401 | Signature mismatch. Verify the secret and that the raw form fields/order are preserved. The return page/reconciler can still settle. |
| Webhook 502 | PayQ status API was temporarily unreachable; PayQ should retry. |
| Paid but `REVIEW` | Order id/amount mismatch or inconsistent status. Inspect `metadata.review_reason`, `gateway_status`, `gateway_amount`, and the PayQ dashboard. Do not manually credit until the order/amount is confirmed. |
| Paid but no credit after 2 hours | The order may have been marked `GATEWAY_TIMEOUT`; reconcile manually against PayQ using the order id/UTR. |
| Legacy pending order | `LEGACY` is expected. Reconcile with KwikUPI/Cashfree; never poll it through PayQ. |

## Security notes

- Treat `PAYQ_USER_TOKEN` and `PAYQ_WEBHOOK_SECRET` as secrets. Do not log
  request bodies or the token.
- The webhook endpoint fails closed if the secret is missing or the hash is
  invalid.
- Wallet credit is keyed by the local order id and protected by an atomic
  transaction marker plus the idempotent wallet ledger. A webhook status or
  amount alone can never credit a wallet.
- Rotate the token that was shared in `payQ.txt`; it should be considered
  exposed.
