from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.core.rate_limit import check_rate_limit
from app.core.security import require_user, require_creator
from app.models.schemas import RechargeInitiateRequest, WithdrawalRequest, WithdrawalIncreaseRequest
from app.services import payment_service, wallet_service
from app.core.database import get_db
from app.core.config import get_settings
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("/packages")
async def packages(user: dict = Depends(require_user)):
    return {"success": True, "packages": wallet_service.RECHARGE_PACKAGES}


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
    html = f"""
    <html><body style="font-family:system-ui;padding:40px;text-align:center">
      <h1>Payment {'successful' if result.get('success') else 'failed'}</h1>
      <p>Order {order_id}</p>
      <p><a href="{scheme}://wallet">Return to Simple Talk</a></p>
    </body></html>
    """
    return HTMLResponse(html)


@router.get("/recharge/return")
async def recharge_return(order_id: str = ""):
    if order_id:
        await payment_service.process_order_success(order_id)
    scheme = get_settings().deep_link_scheme or "simpletalk"
    html = f"""
    <html><body style="font-family:system-ui;padding:40px;text-align:center">
      <h1>Payment processing</h1>
      <p><a href="{scheme}://wallet">Return to Simple Talk</a></p>
    </body></html>
    """
    return HTMLResponse(html)


@router.post("/recharge/webhook")
async def recharge_webhook(request: Request):
    body = await request.json()
    order_id = body.get("order_id") or body.get("orderId")
    if not order_id:
        raise HTTPException(400, "order_id required")
    return await payment_service.process_order_success(order_id)


@router.post("/recharge/verify-pending")
async def verify_pending(request: Request, user: dict = Depends(require_user)):
    body = await request.json()
    order_id = body.get("order_id")
    if not order_id:
        raise HTTPException(400, "order_id required")
    return await payment_service.process_order_success(order_id)


@router.post("/withdraw")
async def withdraw(body: WithdrawalRequest, user: dict = Depends(require_creator)):
    if body.amount < 100:
        raise HTTPException(400, "Minimum withdrawal ₹100")
    wallet = await wallet_service.get_wallet(user["user_id"])
    if wallet.get("earnings_balance", 0) < body.amount:
        raise HTTPException(402, "Insufficient earnings balance")
    db = get_db()
    # Hold funds
    updated = await db.wallets.find_one_and_update(
        {"user_id": user["user_id"], "earnings_balance": {"$gte": body.amount}},
        {
            "$inc": {"earnings_balance": -body.amount},
            "$set": {"updated_at": datetime.now(timezone.utc)},
        },
        return_document=True,
    )
    if not updated:
        raise HTTPException(402, "Insufficient earnings balance")
    req_id = f"wd_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{user['user_id'][-6:]}"
    await db.withdrawal_requests.insert_one(
        {
            "request_id": req_id,
            "user_id": user["user_id"],
            "amount": body.amount,
            "upi_id": body.upi_id,
            "account_name": body.account_name,
            "status": "PENDING",
            "created_at": datetime.now(timezone.utc),
        }
    )
    await wallet_service.insert_transaction(
        user_id=user["user_id"],
        tx_type="WITHDRAW_HOLD",
        amount=body.amount,
        description="Withdrawal requested",
        metadata={"request_id": req_id, "upi_id": body.upi_id},
        transaction_id=f"tx_withdraw_{req_id}",
    )
    return {"success": True, "request_id": req_id}


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
