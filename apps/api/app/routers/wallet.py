from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.core.rate_limit import check_rate_limit
from app.core.security import require_user, require_creator
from app.models.schemas import RechargeInitiateRequest, WithdrawalRequest, WithdrawalIncreaseRequest
from app.services import kwikupi_service, model_referral_service, payment_service, wallet_service
from app.core.database import get_db
from app.core.config import get_settings
from datetime import datetime, timedelta, timezone
from html import escape
import json
import logging
import uuid

router = APIRouter(prefix="/wallet", tags=["wallet"])
logger = logging.getLogger(__name__)


@router.get("/packages")
async def packages(user: dict = Depends(require_user)):
    s = get_settings()
    return {
        "success": True,
        "packages": wallet_service.RECHARGE_PACKAGES,
        "min_recharge_amount": s.min_recharge_amount,
        "max_recharge_amount": s.max_recharge_amount,
        "recharge_commission_rate": s.recharge_commission_rate,
    }


@router.get("/recharge")
async def recharge_page(token: str = ""):
    """
    Backend-rendered recharge page opened by the app in a browser/webview.
    Shows packs plus a custom amount and starts a live KwikUPI payment.
    """
    from app.core.security import decode_token

    try:
        payload = decode_token(token)
        user_id = payload["sub"]
    except Exception:
        return HTMLResponse(
            "<h1 style='font-family:system-ui;padding:40px'>Invalid or expired session. Re-open from the app.</h1>",
            status_code=401,
            headers={"Cache-Control": "no-store"},
        )

    db = get_db()
    user = await db.users.find_one(
        {"user_id": user_id}, {"_id": 0, "name": 1, "deleted": 1, "is_suspended": 1}
    )
    if not user or user.get("deleted"):
        return HTMLResponse("<h1>User not found</h1>", status_code=404)
    if user.get("is_suspended"):
        return HTMLResponse("<h1>Account suspended</h1>", status_code=403)
    wallet = await wallet_service.get_wallet(user_id)
    balance = float(wallet.get("balance", 0) or 0)

    packs = "".join(
        f'<button class="pack" data-amount="{p["amount"]}" data-package="{escape(str(p["id"]), quote=True)}">'
        f'<span class="pack-amt">₹{p["amount"]}</span>'
        f'<span class="pack-label">{escape(str(p["label"]))}</span></button>'
        for p in wallet_service.RECHARGE_PACKAGES
    )

    return HTMLResponse(
        _recharge_page_html(
            token=token,
            balance=balance,
            packs=packs,
            name=user.get("name") or "there",
        ),
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
            "Content-Security-Policy": "frame-ancestors 'none'",
        },
    )


@router.post("/recharge/session")
async def recharge_session(request: Request):
    """Browser-side handoff: JWT in body, start a live KwikUPI order, return its URL."""
    from app.core.security import decode_token

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid request body")
    if not isinstance(body, dict):
        raise HTTPException(400, "Invalid request body")
    token = body.get("token")
    package_id = body.get("package_id")
    try:
        amount = float(body.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0
    if not token or (amount <= 0 and not package_id):
        raise HTTPException(400, "Invalid parameters")
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(401, "Session expired")
    db = get_db()
    user = await db.users.find_one(
        {"user_id": payload["sub"]},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "deleted": 1, "is_suspended": 1},
    )
    if not user or user.get("deleted"):
        raise HTTPException(404, "User not found")
    if user.get("is_suspended"):
        raise HTTPException(403, "Account suspended")

    allowed = await check_rate_limit(
        f"wallet:recharge:{user['user_id']}", limit=10, window_seconds=60
    )
    if not allowed:
        raise HTTPException(429, "Too many recharge attempts. Try again in a minute.")
    try:
        result = await payment_service.initiate_recharge(
            user=user, amount=amount, package_id=package_id
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception:
        logger.exception("Recharge session failed for %s", user.get("user_id"))
        raise HTTPException(502, "Could not start payment. Please try again.")
    return {
        "success": True,
        "payment_url": result.get("payment_url"),
        "order_id": result.get("order_id"),
        "amount": result.get("amount"),
        "credit_amount": result.get("credit_amount"),
        "commission": result.get("commission"),
    }


@router.get("/balance")
async def balance(user: dict = Depends(require_user)):
    w = await wallet_service.get_wallet(user["user_id"])
    return {
        "success": True,
        "balance": w.get("balance", 0),
        "earnings_balance": w.get("earnings_balance", 0),
    }


@router.get("/transactions")
async def transactions(user: dict = Depends(require_user)):
    db = get_db()
    # Pending/failed gateway attempts are internal reconciliation state, not
    # ledger entries. Only completed wallet movements are shown to the user.
    txs = (
        await db.transactions.find(
            {"user_id": user["user_id"], "type": {"$ne": "RECHARGE_PENDING"}},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(100)
        .to_list(100)
    )
    return {"success": True, "transactions": txs}


@router.post("/recharge/initiate")
async def recharge_initiate(body: RechargeInitiateRequest, user: dict = Depends(require_user)):
    allowed = await check_rate_limit(f"wallet:recharge:{user['user_id']}", limit=10, window_seconds=60)
    if not allowed:
        raise HTTPException(429, "Too many recharge attempts. Try again in a minute.")
    try:
        return await payment_service.initiate_recharge(
            user=user, amount=body.amount, package_id=body.package_id
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception:
        logger.exception("Recharge initiation failed for %s", user.get("user_id"))
        raise HTTPException(502, "Could not start payment. Please try again.")


@router.get("/recharge/dev-complete")
async def recharge_dev_complete(order_id: str):
    """Removed. Live payment verification is the only way to credit a recharge."""
    raise HTTPException(
        404,
        "This endpoint is disabled. Recharges are credited only after a verified live payment.",
    )


def _return_html(title: str, order_id: str, scheme: str, message: str = "") -> str:
    deep_link = f"{scheme}://wallet"
    safe_title = escape(title)
    safe_order = escape(order_id)
    safe_message = escape(message)
    safe_deep_link = escape(deep_link, quote=True)
    return f"""<!DOCTYPE html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {{ font-family: -apple-system, system-ui, sans-serif; background:#070d0c; color:#f3efe8;
        display:flex; min-height:100vh; margin:0; align-items:center; justify-content:center; text-align:center; }}
      .card {{ padding:40px 28px; }}
      h1 {{ font-size:22px; margin:0 0 6px; }}
      p {{ color:#8a9a94; margin:0 0 24px; font-size:14px; }}
      .msg {{ color:#f3efe8; margin-bottom:8px; }}
      a {{ display:inline-block; background:#0f766e; color:#fff; text-decoration:none;
        padding:14px 28px; border-radius:14px; font-weight:700; }}
    </style></head>
    <body><div class="card">
      <h1>{safe_title}</h1>
      {f'<p class="msg">{safe_message}</p>' if safe_message else ''}
      <p>Order {safe_order}</p>
      <a href="{safe_deep_link}">Return to Simple Talk</a>
    </div>
    <script>
      // Auto-close the in-app browser / return to the app when possible.
      setTimeout(function () {{ window.location.href = "{safe_deep_link}"; }}, 1500);
    </script>
    </body></html>"""


def _recharge_page_html(*, token: str, balance: float, packs: str, name: str) -> str:
    settings = get_settings()
    min_amount = float(settings.min_recharge_amount)
    max_amount = float(settings.max_recharge_amount)
    commission_rate = float(settings.recharge_commission_rate)
    commission_pct = commission_rate * 100
    credit_pct = 100 - commission_pct
    safe_name = escape(name)
    token_json = json.dumps(token)
    return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="referrer" content="no-referrer">
<title>Recharge — Simple Talk</title>
<style>
  :root {{ --brand:#0f766e; --brand-dark:#0b4f4a; --bg:#070d0c; --card:#101a18; --text:#f3efe8; --muted:#8a9a94; --border:rgba(255,255,255,0.1); }}
  * {{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }}
  body {{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text);
    margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center; padding-bottom:140px; }}
  .header {{ width:100%; max-width:520px; padding:22px 20px 10px; }}
  .header h1 {{ margin:0; font-size:22px; font-family:Georgia,serif; }}
  .header p {{ margin:4px 0 0; color:var(--muted); font-size:13px; }}
  .container {{ width:100%; max-width:520px; padding:8px 20px; }}
  .balance {{ background:linear-gradient(135deg,var(--brand),var(--brand-dark)); border-radius:20px; padding:22px; margin-bottom:22px; }}
  .balance-label {{ font-size:13px; opacity:.85; }}
  .balance-value {{ font-size:34px; font-weight:700; margin-top:4px; }}
  .section-title {{ font-size:13px; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); margin:22px 0 12px; }}
  .packs {{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }}
  .pack {{ background:var(--card); border:1px solid var(--border); border-radius:16px; padding:18px 12px; cursor:pointer;
    color:var(--text); text-align:center; transition:transform .1s,border-color .2s; }}
  .pack:active {{ transform:scale(.97); }}
  .pack.selected {{ border-color:var(--brand); background:#0d211e; }}
  .pack-amt {{ display:block; font-size:20px; font-weight:700; }}
  .pack-label {{ display:block; font-size:12px; color:var(--muted); margin-top:4px; }}
  .custom {{ margin-top:22px; background:var(--card); border:1px solid var(--border); border-radius:16px; padding:18px; }}
  .custom-input {{ width:100%; padding:15px 16px 15px 40px; font-size:20px; font-weight:600; color:var(--text);
    background:var(--bg); border:1px solid var(--border); border-radius:12px; outline:none; }}
  .custom-input:focus {{ border-color:var(--brand); }}
  .wrap {{ position:relative; display:flex; align-items:center; }}
  .rupee {{ position:absolute; left:16px; font-size:20px; color:var(--brand); font-weight:600; }}
  .hint {{ font-size:12px; color:var(--muted); margin-top:8px; line-height:1.5; }}
  .summary {{ margin-top:14px; padding:12px 14px; border-radius:12px; background:#0d211e; border:1px solid rgba(15,118,110,.45);
    font-size:13px; line-height:1.5; min-height:44px; }}
  .footer {{ position:fixed; bottom:0; width:100%; max-width:520px; padding:16px 20px 26px; background:var(--bg);
    border-top:1px solid var(--border); }}
  .pay {{ width:100%; background:var(--brand); color:#fff; border:none; border-radius:14px; padding:16px; font-size:17px; font-weight:700; cursor:pointer; }}
  .pay:disabled {{ opacity:.5; }}
  #loader {{ display:none; position:fixed; inset:0; background:rgba(7,13,12,.9); z-index:100; align-items:center; justify-content:center; flex-direction:column; }}
  .spinner {{ width:42px; height:42px; border:4px solid rgba(255,255,255,.15); border-top-color:var(--brand); border-radius:50%; animation:spin 1s linear infinite; }}
  @keyframes spin {{ to {{ transform:rotate(360deg); }} }}
  .err {{ color:#ef4444; font-size:13px; margin-top:10px; min-height:16px; }}
  .secure {{ margin-top:12px; text-align:center; font-size:11px; color:var(--muted); }}
</style></head>
<body>
  <div class="header">
    <h1>Recharge wallet</h1>
    <p>Hi {safe_name}, add credits for instant calls.</p>
  </div>
  <div class="container">
    <div class="balance">
      <div class="balance-label">Current balance</div>
      <div class="balance-value">₹{balance:,.2f}</div>
    </div>
    <div class="section-title">Choose an amount</div>
    <div class="packs">{packs}</div>
    <div class="custom">
      <div class="section-title" style="margin-top:0">Or enter an amount</div>
      <div class="wrap"><span class="rupee">₹</span>
        <input id="custom" class="custom-input" type="number" inputmode="decimal" step="0.01"
          placeholder="Minimum ₹{min_amount:.0f}" min="{min_amount:.2f}" max="{max_amount:.2f}">
      </div>
      <div class="hint">UPI payment via KwikUPI. A {commission_pct:.0f}% fee is deducted, so {credit_pct:.0f}% of the amount you pay is added to your wallet.</div>
      <div class="summary" id="summary">Select an amount to see how much will be added.</div>
    </div>
    <div class="err" id="err"></div>
  </div>
  <div class="footer">
    <button class="pay" id="pay" disabled>Select an amount</button>
    <div class="secure">Secure live payment · KwikUPI</div>
  </div>
  <div id="loader"><div class="spinner"></div><p style="color:var(--muted);margin-top:14px">Starting secure checkout…</p></div>

<script>
  var TOKEN = {token_json};
  var MIN_AMOUNT = {min_amount:.2f};
  var MAX_AMOUNT = {max_amount:.2f};
  var COMMISSION_RATE = {commission_rate:.8f};
  var selected = null;
  var selectedPackage = null;
  var starting = false;
  var custom = document.getElementById('custom');
  var pay = document.getElementById('pay');
  var err = document.getElementById('err');
  var summary = document.getElementById('summary');

  function money(n) {{ return n.toFixed(2); }}

  function refresh() {{
    var val = selected !== null ? selected : (custom.value ? Number(custom.value) : 0);
    if (val) val = Math.round(val * 100) / 100;
    if (val && val >= MIN_AMOUNT && val <= MAX_AMOUNT) {{
      var fee = Math.round(val * COMMISSION_RATE * 100) / 100;
      var credit = Math.round((val - fee) * 100) / 100;
      pay.disabled = false;
      pay.textContent = 'Pay ₹' + money(val);
      summary.textContent = '₹' + money(credit) + ' will be added after a ₹' + money(fee) + ' fee ({commission_pct:.0f}%).';
      err.textContent = '';
    }} else if (val > MAX_AMOUNT) {{
      pay.disabled = true;
      pay.textContent = 'Amount too large';
      summary.textContent = 'Maximum recharge is ₹' + money(MAX_AMOUNT) + '.';
    }} else if (val > 0) {{
      pay.disabled = true;
      pay.textContent = 'Minimum ₹' + money(MIN_AMOUNT);
      summary.textContent = 'Enter at least ₹' + money(MIN_AMOUNT) + ' to continue.';
    }} else {{
      pay.disabled = true;
      pay.textContent = 'Select an amount';
      summary.textContent = 'Select an amount to see how much will be added.';
    }}
  }}

  document.querySelectorAll('.pack').forEach(function (b) {{
    b.addEventListener('click', function () {{
      document.querySelectorAll('.pack').forEach(function (x) {{ x.classList.remove('selected'); }});
      b.classList.add('selected');
      custom.value = '';
      selected = Number(b.dataset.amount);
      selectedPackage = b.dataset.package || null;
      err.textContent = '';
      refresh();
    }});
  }});
  custom.addEventListener('input', function () {{
    selected = null;
    selectedPackage = null;
    document.querySelectorAll('.pack').forEach(function (x) {{ x.classList.remove('selected'); }});
    refresh();
  }});

  pay.addEventListener('click', async function () {{
    if (starting) return;
    var val = selected !== null ? selected : (custom.value ? Number(custom.value) : 0);
    if (val) val = Math.round(val * 100) / 100;
    if (!val || val < MIN_AMOUNT) {{ err.textContent = 'Minimum recharge is ₹' + money(MIN_AMOUNT); return; }}
    if (val > MAX_AMOUNT) {{ err.textContent = 'Maximum recharge is ₹' + money(MAX_AMOUNT); return; }}
    starting = true;
    pay.disabled = true;
    document.getElementById('loader').style.display = 'flex';
    try {{
      var res = await fetch('/api/wallet/recharge/session', {{
        method: 'POST', headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ token: TOKEN, amount: val, package_id: selectedPackage }})
      }});
      var data = await res.json().catch(function () {{ return {{}}; }});
      if (!res.ok || !data.payment_url) {{
        var detail = data.detail;
        if (Array.isArray(detail)) detail = detail.map(function (d) {{ return d.msg || String(d); }}).join(' ');
        throw new Error(detail || 'Could not start payment');
      }}
      window.location.href = data.payment_url;
    }} catch (e) {{
      starting = false;
      document.getElementById('loader').style.display = 'none';
      err.textContent = e.message || 'Something went wrong';
      refresh();
    }}
  }});

  refresh();
</script>
</body></html>"""


@router.get("/recharge/return")
async def recharge_return(order_id: str = ""):
    title = "Payment processing"
    message = "Your payment is being verified. It will be added to your wallet automatically."
    if order_id:
        try:
            result = await payment_service.verify_with_gateway(order_id)
        except Exception:
            logger.exception("Return-page verification failed for %s", order_id)
            result = {"status": "PENDING"}
        status = result.get("status")
        if status == "SUCCESS":
            title = "Payment successful"
            credited = result.get("credited")
            if result.get("already"):
                message = "This recharge was already added to your wallet."
            elif credited is not None:
                message = f"₹{float(credited):,.2f} was added to your wallet."
        elif status == "FAILED":
            title = "Payment failed"
            message = "No money was added. You can try again from the app."
        elif status == "REVIEW":
            title = "Payment under review"
            message = "We could not verify this payment automatically. Support will review it."
    scheme = get_settings().deep_link_scheme or "simpletalk"
    return HTMLResponse(
        _return_html(title, order_id, scheme, message),
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
            "Content-Security-Policy": "frame-ancestors 'none'",
        },
    )


@router.post("/recharge/webhook")
@router.post("/recharge/kwikupi/webhook", include_in_schema=False)
async def recharge_webhook(request: Request):
    """KwikUPI webhook: verify HMAC, then re-check status with the gateway."""
    raw = await request.body()
    if not kwikupi_service.configured():
        raise HTTPException(503, "Payment gateway is not configured")
    signature = request.headers.get("x-webhook-signature", "")
    if not kwikupi_service.verify_webhook_signature(raw, signature):
        raise HTTPException(401, "Invalid webhook signature")

    try:
        body = json.loads(raw or b"{}")
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "Invalid payload")

    try:
        result = await payment_service.handle_webhook_payload(body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception:
        logger.exception("KwikUPI webhook processing failed")
        raise HTTPException(500, "Webhook processing failed")

    status = result.get("status")
    if status == "NOT_FOUND":
        raise HTTPException(404, "Order not found")
    if status == "PENDING" and result.get("retryable"):
        # Ask KwikUPI to retry when the status API was temporarily unreachable.
        raise HTTPException(502, "Gateway status unavailable")
    if status == "REVIEW":
        logger.critical("KwikUPI webhook requires manual review: %s", result)
    return {
        "received": True,
        "status": status,
        "order_id": body.get("order_id") or body.get("orderId"),
        "credited": result.get("credited"),
    }


@router.post("/recharge/verify-pending")
async def verify_pending(request: Request, user: dict = Depends(require_user)):
    allowed = await check_rate_limit(
        f"wallet:recharge:verify:{user['user_id']}", limit=6, window_seconds=60
    )
    if not allowed:
        raise HTTPException(429, "Too many verification attempts. Try again shortly.")
    try:
        body = await request.json()
    except Exception:
        body = {}
    order_id = (body or {}).get("order_id")
    db = get_db()

    if order_id:
        tx = await db.transactions.find_one(
            {"metadata.order_id": order_id, "user_id": user["user_id"]},
            {"_id": 0, "metadata": 1},
        )
        if not tx:
            raise HTTPException(404, "Order not found")
        return await payment_service.verify_with_gateway(order_id)

    # No order id (browser flow): recover every recent pending recharge for this user.
    pending = (
        await db.transactions.find(
            {
                "user_id": user["user_id"],
                "type": "RECHARGE_PENDING",
                "metadata.status": {"$in": ["PENDING", "PROCESSING"]},
                "metadata.gateway": "kwikupi",
            },
            {"_id": 0, "metadata.order_id": 1},
        )
        .sort("created_at", -1)
        .limit(10)
        .to_list(10)
    )
    recovered = 0
    reviewed = 0
    credited = 0.0
    for row in pending:
        oid = (row.get("metadata") or {}).get("order_id")
        if not oid:
            continue
        try:
            result = await payment_service.verify_with_gateway(oid)
        except Exception:
            logger.exception("Pending recharge verification failed for %s", oid)
            continue
        if result.get("status") == "SUCCESS":
            recovered += 1
            credited += float(result.get("credited") or 0)
        elif result.get("status") == "REVIEW":
            reviewed += 1
    # Surface recent stuck payments even when the webhook/return page already
    # moved them to REVIEW before the app opened.
    reviewed += await db.transactions.count_documents(
        {
            "user_id": user["user_id"],
            "type": "RECHARGE_PENDING",
            "metadata.status": "REVIEW",
            "created_at": {"$gte": datetime.now(timezone.utc) - timedelta(hours=24)},
        }
    )
    wallet = await wallet_service.get_wallet(user["user_id"])
    return {
        "success": True,
        "recovered_count": recovered,
        "review_count": reviewed,
        "credited": credited,
        "balance": wallet.get("balance", 0),
    }


@router.post("/withdraw")
async def withdraw(body: WithdrawalRequest, user: dict = Depends(require_creator)):
    MIN_WITHDRAW = 250.0
    MAX_WITHDRAW = 25000.0
    gross = round(float(body.amount or 0), 2)
    if gross < MIN_WITHDRAW:
        raise HTTPException(400, f"Minimum withdrawal ₹{MIN_WITHDRAW:.0f}")
    if gross > MAX_WITHDRAW:
        raise HTTPException(400, f"Maximum withdrawal ₹{MAX_WITHDRAW:.0f}")

    upi = (body.upi_id or "").strip()
    if not upi or "@" not in upi:
        raise HTTPException(400, "Enter a valid UPI ID (name@bank)")
    bank = body.bank_details
    if not bank or not all(
        [bank.bank_name, bank.account_number, bank.ifsc_code, bank.account_holder_name]
    ):
        raise HTTPException(
            400, "Complete bank details (bank name, account number, IFSC, account holder) are required"
        )

    db = get_db()
    profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    max_requests = int((profile or {}).get("max_withdraw_requests", 2) or 2)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = await db.withdrawal_requests.count_documents(
        {"user_id": user["user_id"], "created_at": {"$gte": today_start}}
    )
    if today_count >= max_requests:
        raise HTTPException(
            400, f"You can make {max_requests} withdrawal request(s) per day. Limit reached."
        )

    wallet = await wallet_service.get_wallet(user["user_id"])
    if wallet.get("earnings_balance", 0) < gross:
        raise HTTPException(402, "Insufficient earnings balance")

    # The referrer is payable only if both accounts still exist. The final
    # eligibility is checked again when admin marks the payout paid.
    referral = await model_referral_service.resolve_withdrawal_referrer(user["user_id"])
    split = wallet_service.calculate_withdrawal_split(
        gross, referral_eligible=bool(referral)
    )

    # Hold the gross amount atomically from earnings_balance. The creator is
    # paid the net payout; the 10% commission stays with the platform (and is
    # shared with the referrer when applicable).
    updated = await db.wallets.find_one_and_update(
        {"user_id": user["user_id"], "earnings_balance": {"$gte": gross}},
        {
            "$inc": {"earnings_balance": -gross},
            "$set": {"updated_at": now},
        },
        return_document=True,
    )
    if not updated:
        raise HTTPException(402, "Insufficient earnings balance")

    req_id = f"wd_{uuid.uuid4().hex[:12]}"
    bank_dict = bank.model_dump()
    referrer = referral or {}
    await db.withdrawal_requests.insert_one(
        {
            "request_id": req_id,
            "user_id": user["user_id"],
            "amount": split["gross_amount"],
            "commission_rate": split["commission_rate"],
            "commission_amount": split["commission_amount"],
            "payout_amount": split["payout_amount"],
            "referral_bonus_percentage": split["referral_bonus_percentage"],
            "referral_bonus_amount": split["referral_bonus_amount"],
            "potential_referral_bonus_amount": split["potential_referral_bonus_amount"],
            "platform_commission_amount": split["platform_commission_amount"],
            "referrer_id": referrer.get("referrer_id"),
            "referrer_name": referrer.get("referrer_name"),
            "referral_status": "PENDING" if referral else "PLATFORM",
            "withdrawal_method": "BANK_AND_UPI",
            "upi_id": upi,
            "bank_details": bank_dict,
            "account_name": body.account_name,
            "status": "PENDING",
            "created_at": now,
        }
    )
    await wallet_service.insert_transaction(
        user_id=user["user_id"],
        tx_type="WITHDRAW_HOLD",
        amount=split["gross_amount"],
        description=(
            f"Withdrawal requested — ₹{split['payout_amount']:.2f} payout "
            f"after ₹{split['commission_amount']:.2f} commission"
        ),
        metadata={
            "request_id": req_id,
            "upi_id": upi,
            "gross_amount": split["gross_amount"],
            "payout_amount": split["payout_amount"],
            "commission_amount": split["commission_amount"],
        },
        transaction_id=f"tx_withdraw_{req_id}",
    )
    # Save payout details on the profile for next-time prefill.
    await db.creator_profiles.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"upi_id": upi, "bank_details": bank_dict}},
        upsert=True,
    )
    return {
        "success": True,
        "request_id": req_id,
        "amount": split["gross_amount"],
        "commission_rate": split["commission_rate"],
        "commission_amount": split["commission_amount"],
        "payout_amount": split["payout_amount"],
        "referral_bonus_amount": split["referral_bonus_amount"],
        "platform_commission_amount": split["platform_commission_amount"],
        "requests_today": today_count + 1,
        "max_requests_per_day": max_requests,
    }


@router.get("/withdrawal/profile")
async def withdrawal_profile(user: dict = Depends(require_creator)):
    """Saved payout details + limits, to prefill the withdrawal screen."""
    db = get_db()
    profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    wallet = await wallet_service.get_wallet(user["user_id"])
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = await db.withdrawal_requests.count_documents(
        {"user_id": user["user_id"], "created_at": {"$gte": today_start}}
    )
    return {
        "success": True,
        "earnings_balance": wallet.get("earnings_balance", 0),
        "upi_id": (profile or {}).get("upi_id"),
        "bank_details": (profile or {}).get("bank_details"),
        "max_withdraw_amount": (profile or {}).get("max_withdraw_amount", 25000),
        "max_requests_per_day": int((profile or {}).get("max_withdraw_requests", 2) or 2),
        "requests_today": today_count,
        "min_withdraw_amount": 250,
        "withdrawal_commission_rate": get_settings().withdrawal_commission_rate,
        "referral_bonus_percentage": get_settings().model_referral_bonus_percentage,
    }


@router.get("/withdrawal/requests")
async def withdrawal_requests(user: dict = Depends(require_creator)):
    db = get_db()
    reqs = (
        await db.withdrawal_requests.find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(100)
    )
    return {"success": True, "requests": reqs}


@router.post("/withdrawal/request-increase")
async def request_withdrawal_increase(body: WithdrawalIncreaseRequest, user: dict = Depends(require_creator)):
    if body.requested_max_amount <= 25000:
        raise HTTPException(400, "Requested amount must be greater than the current ₹25000 maximum")
    db = get_db()
    existing = await db.withdrawal_increase_requests.find_one(
        {"user_id": user["user_id"], "status": "PENDING"}, {"_id": 0}
    )
    if existing:
        raise HTTPException(400, "You already have a pending withdrawal increase request")
    req_id = f"wir_{uuid.uuid4().hex[:12]}"
    await db.withdrawal_increase_requests.insert_one(
        {
            "request_id": req_id,
            "user_id": user["user_id"],
            "requested_max_amount": body.requested_max_amount,
            "reason": (body.reason or "").strip() or None,
            "status": "PENDING",
            "created_at": datetime.now(timezone.utc),
        }
    )
    return {"success": True, "request_id": req_id, "message": "Withdrawal increase request submitted"}
