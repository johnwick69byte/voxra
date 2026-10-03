from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.core.rate_limit import check_rate_limit
from app.core.security import require_user, require_creator
from app.models.schemas import RechargeInitiateRequest, WithdrawalRequest, WithdrawalIncreaseRequest
from app.services import cashfree_service, payment_service, wallet_service
from app.core.database import get_db
from app.core.config import get_settings
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("/packages")
async def packages(user: dict = Depends(require_user)):
    return {"success": True, "packages": wallet_service.RECHARGE_PACKAGES}


@router.get("/recharge")
async def recharge_page(token: str = ""):
    """
    Backend-rendered recharge page opened by the app in a browser/webview.
    Mirrors the old flow: show balance + packs + custom amount, then start
    Cashfree when the user taps an amount.
    """
    from app.core.security import decode_token

    try:
        payload = decode_token(token)
        user_id = payload["sub"]
    except Exception:
        return HTMLResponse(
            "<h1 style='font-family:system-ui;padding:40px'>Invalid or expired session. Re-open from the app.</h1>",
            status_code=401,
        )

    db = get_db()
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "name": 1})
    if not user:
        return HTMLResponse("<h1>User not found</h1>", status_code=404)
    wallet = await wallet_service.get_wallet(user_id)
    balance = float(wallet.get("balance", 0) or 0)

    packs = "".join(
        f'<button class="pack" data-amount="{p["amount"]}">'
        f'<span class="pack-amt">₹{p["amount"]}</span>'
        f'<span class="pack-label">{p["label"]}</span></button>'
        for p in wallet_service.RECHARGE_PACKAGES
    )

    return HTMLResponse(
        _recharge_page_html(token=token, balance=balance, packs=packs, name=user.get("name") or "there")
    )


@router.post("/recharge/session")
async def recharge_session(request: Request):
    """Browser-side handoff: JWT in body, start a gateway order, return its URL."""
    from app.core.security import decode_token

    body = await request.json()
    token = body.get("token")
    try:
        amount = float(body.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0
    package_id = body.get("package_id")
    if not token or amount <= 0:
        raise HTTPException(400, "Invalid parameters")
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(401, "Session expired")
    db = get_db()
    user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    try:
        result = await payment_service.initiate_recharge(
            user=user, amount=amount, package_id=package_id
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"success": True, "payment_url": result.get("payment_url"), "order_id": result.get("order_id")}


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
    txs = (
        await db.transactions.find({"user_id": user["user_id"]}, {"_id": 0})
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
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@router.get("/recharge/dev-complete")
async def recharge_dev_complete(order_id: str):
    result = await payment_service.process_order_success(order_id)
    scheme = get_settings().deep_link_scheme or "simpletalk"
    html = _return_html("Payment successful" if result.get("success") else "Payment failed", order_id, scheme)
    return HTMLResponse(html)


def _return_html(title: str, order_id: str, scheme: str) -> str:
    deep_link = f"{scheme}://wallet"
    return f"""<!DOCTYPE html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {{ font-family: -apple-system, system-ui, sans-serif; background:#070d0c; color:#f3efe8;
        display:flex; min-height:100vh; margin:0; align-items:center; justify-content:center; text-align:center; }}
      .card {{ padding:40px 28px; }}
      h1 {{ font-size:22px; margin:0 0 6px; }}
      p {{ color:#8a9a94; margin:0 0 24px; font-size:14px; }}
      a {{ display:inline-block; background:#0f766e; color:#fff; text-decoration:none;
        padding:14px 28px; border-radius:14px; font-weight:700; }}
    </style></head>
    <body><div class="card">
      <h1>{title}</h1>
      <p>Order {order_id}</p>
      <a href="{deep_link}">Return to Simple Talk</a>
    </div>
    <script>
      // Auto-close the in-app browser / return to the app when possible.
      setTimeout(function () {{ window.location.href = "{deep_link}"; }}, 1200);
    </script>
    </body></html>"""


def _recharge_page_html(*, token: str, balance: float, packs: str, name: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Recharge — Simple Talk</title>
<style>
  :root {{ --brand:#0f766e; --brand-dark:#0b4f4a; --bg:#070d0c; --card:#101a18; --text:#f3efe8; --muted:#8a9a94; --border:rgba(255,255,255,0.1); }}
  * {{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }}
  body {{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text);
    margin:0; min-height:100vh; display:flex; flex-direction:column; align-items:center; padding-bottom:120px; }}
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
  .hint {{ font-size:12px; color:var(--muted); margin-top:8px; }}
  .footer {{ position:fixed; bottom:0; width:100%; max-width:520px; padding:16px 20px 26px; background:var(--bg);
    border-top:1px solid var(--border); }}
  .pay {{ width:100%; background:var(--brand); color:#fff; border:none; border-radius:14px; padding:16px; font-size:17px; font-weight:700; cursor:pointer; }}
  .pay:disabled {{ opacity:.5; }}
  #loader {{ display:none; position:fixed; inset:0; background:rgba(7,13,12,.85); z-index:100; align-items:center; justify-content:center; flex-direction:column; }}
  .spinner {{ width:42px; height:42px; border:4px solid rgba(255,255,255,.15); border-top-color:var(--brand); border-radius:50%; animation:spin 1s linear infinite; }}
  @keyframes spin {{ to {{ transform:rotate(360deg); }} }}
  .err {{ color:#ef4444; font-size:13px; margin-top:10px; min-height:16px; }}
</style></head>
<body>
  <div class="header">
    <h1>Recharge wallet</h1>
    <p>Hi {name}, add credits for instant calls.</p>
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
        <input id="custom" class="custom-input" type="number" inputmode="numeric" placeholder="Minimum 10" min="10">
      </div>
      <div class="hint">A 6% gateway &amp; service fee applies. 94% is added to your balance.</div>
    </div>
    <div class="err" id="err"></div>
  </div>
  <div class="footer"><button class="pay" id="pay" disabled>Select an amount</button></div>
  <div id="loader"><div class="spinner"></div><p style="color:var(--muted);margin-top:14px">Starting secure checkout…</p></div>

<script>
  var TOKEN = {token!r};
  var selected = null;
  var custom = document.getElementById('custom');
  var pay = document.getElementById('pay');
  var err = document.getElementById('err');

  function refresh() {{
    var val = selected || (custom.value ? Number(custom.value) : 0);
    if (val && val >= 10) {{ pay.disabled = false; pay.textContent = 'Pay ₹' + val; }}
    else {{ pay.disabled = true; pay.textContent = 'Select an amount'; }}
  }}

  document.querySelectorAll('.pack').forEach(function (b) {{
    b.addEventListener('click', function () {{
      document.querySelectorAll('.pack').forEach(function (x) {{ x.classList.remove('selected'); }});
      b.classList.add('selected');
      custom.value = '';
      selected = Number(b.dataset.amount);
      err.textContent = '';
      refresh();
    }});
  }});
  custom.addEventListener('input', function () {{ selected = null; document.querySelectorAll('.pack').forEach(function (x) {{ x.classList.remove('selected'); }}); refresh(); }});

  pay.addEventListener('click', async function () {{
    var val = selected || (custom.value ? Number(custom.value) : 0);
    if (!val || val < 10) {{ err.textContent = 'Minimum recharge is ₹10'; return; }}
    document.getElementById('loader').style.display = 'flex';
    try {{
      var res = await fetch('/api/wallet/recharge/session', {{
        method: 'POST', headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ token: TOKEN, amount: val }})
      }});
      var data = await res.json();
      if (!res.ok || !data.payment_url) throw new Error(data.detail || 'Could not start payment');
      window.location.href = data.payment_url;
    }} catch (e) {{
      document.getElementById('loader').style.display = 'none';
      err.textContent = e.message || 'Something went wrong';
    }}
  }});
</script>
</body></html>"""


@router.get("/recharge/return")
async def recharge_return(order_id: str = ""):
    status = "Payment processing"
    if order_id:
        result = await payment_service.verify_with_gateway(order_id)
        if result.get("status") == "SUCCESS":
            status = "Payment successful"
        elif result.get("status") == "FAILED":
            status = "Payment failed"
    scheme = get_settings().deep_link_scheme or "simpletalk"
    return HTMLResponse(_return_html(status, order_id, scheme))


@router.post("/recharge/webhook")
async def recharge_webhook(request: Request):
    raw = await request.body()
    signature = request.headers.get("x-webhook-signature", "")
    timestamp = request.headers.get("x-webhook-timestamp", "")
    # Cashfree signs every webhook. If a secret is configured, require a valid signature.
    if get_settings().cashfree_secret_key and not cashfree_service.verify_webhook_signature(
        raw, signature, timestamp
    ):
        raise HTTPException(401, "Invalid webhook signature")

    import json

    try:
        body = json.loads(raw or b"{}")
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    order_id = (
        body.get("data", {}).get("order", {}).get("order_id")
        or body.get("order_id")
        or body.get("orderId")
    )
    if not order_id:
        raise HTTPException(400, "order_id required")
    return await payment_service.verify_with_gateway(str(order_id))


@router.post("/recharge/verify-pending")
async def verify_pending(request: Request, user: dict = Depends(require_user)):
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
            },
            {"_id": 0, "metadata.order_id": 1},
        )
        .sort("created_at", -1)
        .limit(10)
        .to_list(10)
    )
    recovered = 0
    credited = 0.0
    for row in pending:
        oid = (row.get("metadata") or {}).get("order_id")
        if not oid:
            continue
        result = await payment_service.verify_with_gateway(oid)
        if result.get("status") == "SUCCESS":
            recovered += 1
            credited += float(result.get("credited") or 0)
    wallet = await wallet_service.get_wallet(user["user_id"])
    return {
        "success": True,
        "recovered_count": recovered,
        "credited": credited,
        "balance": wallet.get("balance", 0),
    }


@router.post("/withdraw")
async def withdraw(body: WithdrawalRequest, user: dict = Depends(require_creator)):
    MIN_WITHDRAW = 250.0
    MAX_WITHDRAW = 25000.0
    if body.amount < MIN_WITHDRAW:
        raise HTTPException(400, f"Minimum withdrawal ₹{MIN_WITHDRAW:.0f}")
    if body.amount > MAX_WITHDRAW:
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
    if wallet.get("earnings_balance", 0) < body.amount:
        raise HTTPException(402, "Insufficient earnings balance")

    # Hold funds atomically from earnings_balance only.
    updated = await db.wallets.find_one_and_update(
        {"user_id": user["user_id"], "earnings_balance": {"$gte": body.amount}},
        {
            "$inc": {"earnings_balance": -body.amount},
            "$set": {"updated_at": now},
        },
        return_document=True,
    )
    if not updated:
        raise HTTPException(402, "Insufficient earnings balance")

    req_id = f"wd_{uuid.uuid4().hex[:12]}"
    bank_dict = bank.model_dump()
    await db.withdrawal_requests.insert_one(
        {
            "request_id": req_id,
            "user_id": user["user_id"],
            "amount": body.amount,
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
        amount=body.amount,
        description="Withdrawal requested",
        metadata={"request_id": req_id, "upi_id": upi},
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
