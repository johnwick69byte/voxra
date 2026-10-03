"""Recharge payments via Cashfree + idempotent credit + platform commission ledger.

Economics: the platform keeps `recharge_commission_rate` (default 6%, split 3%
gateway + 3% service) of every recharge. The user is credited the remainder
(94%). Every credited recharge writes a document to `platform_commissions`.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.config import get_settings
from app.core.database import get_db
from app.core.database_redis import get_redis, idempotency_key
from app.core.socket import emit_to_user
from app.services import cashfree_service, wallet_service

logger = logging.getLogger(__name__)

PLATFORM_WALLET_ID = "platform_001"


def split_recharge(amount: float) -> dict:
    """Split a gross recharge into the user credit and platform commission parts."""
    s = get_settings()
    total_commission = round(amount * s.recharge_commission_rate, 2)
    gateway = round(amount * s.recharge_gateway_rate, 2)
    service = round(total_commission - gateway, 2)
    credit_amount = round(amount - total_commission, 2)
    return {
        "original_amount": round(amount, 2),
        "credit_amount": credit_amount,
        "total_commission": total_commission,
        "gateway_commission": gateway,
        "service_commission": service,
    }


async def initiate_recharge(*, user: dict, amount: float, package_id: Optional[str] = None) -> dict:
    if amount < 10:
        raise ValueError("Minimum recharge is ₹10")

    if package_id:
        pkg = next((p for p in wallet_service.RECHARGE_PACKAGES if p["id"] == package_id), None)
        if pkg:
            amount = float(pkg["amount"])
    amount = round(float(amount), 2)

    order_id = f"ord_{uuid.uuid4().hex[:14]}"
    tx_id = f"tx_recharge_{order_id}"
    db = get_db()
    settings = get_settings()

    await db.transactions.insert_one(
        {
            "transaction_id": tx_id,
            "user_id": user["user_id"],
            "type": "RECHARGE_PENDING",
            "amount": amount,
            "description": f"Recharge ₹{amount}",
            "metadata": {
                "order_id": order_id,
                "base_amount": amount,
                "package_id": package_id,
                "status": "PENDING",
                "gateway": "cashfree",
                "created_for_verification": True,
            },
            "created_at": datetime.now(timezone.utc),
        }
    )

    if not cashfree_service.configured():
        # Dev mode: use the mock completion endpoint so the whole flow is testable.
        payment_url = f"{settings.backend_url}/api/wallet/recharge/dev-complete?order_id={order_id}"
        await db.transactions.update_one(
            {"transaction_id": tx_id},
            {"$set": {"metadata.payment_url": payment_url, "metadata.dev_mode": True}},
        )
        return {
            "success": True,
            "order_id": order_id,
            "transaction_id": tx_id,
            "payment_url": payment_url,
            "amount": amount,
            "credit_amount": split_recharge(amount)["credit_amount"],
            "dev_mode": True,
        }

    return_url = settings.cashfree_return_url or f"{settings.backend_url}/api/wallet/recharge/return"
    notify_url = settings.cashfree_notify_url or f"{settings.backend_url}/api/wallet/recharge/webhook"
    phone = "".join(c for c in (user.get("phone") or "") if c.isdigit())[-10:] or "9999999999"

    try:
        order = await cashfree_service.create_order(
            order_id=order_id,
            amount=amount,
            customer_id=user["user_id"],
            customer_phone=phone,
            customer_name=user.get("name"),
            return_url=return_url,
            notify_url=notify_url,
        )
    except Exception:
        await db.transactions.update_one(
            {"transaction_id": tx_id}, {"$set": {"metadata.status": "FAILED"}}
        )
        raise

    session_id = order.get("payment_session_id")
    payment_url = f"https://payments.cashfree.com/order/#{session_id}" if session_id else None
    await db.transactions.update_one(
        {"transaction_id": tx_id},
        {"$set": {"metadata.payment_session_id": session_id, "metadata.payment_url": payment_url}},
    )
    return {
        "success": True,
        "order_id": order_id,
        "transaction_id": tx_id,
        "payment_url": payment_url,
        "payment_session_id": session_id,
        "amount": amount,
        "credit_amount": split_recharge(amount)["credit_amount"],
    }


async def _claim_order(order_id: str, *, allow_reverify: bool) -> Optional[dict]:
    """Atomically claim a PENDING order for processing. Returns the transaction or None."""
    db = get_db()
    tx = await db.transactions.find_one({"metadata.order_id": order_id}, {"_id": 0})
    if not tx:
        return None
    if tx.get("type") == "RECHARGE" or tx.get("metadata", {}).get("status") == "SUCCESS":
        return None  # already credited

    claimable = ["PENDING"]
    if allow_reverify:
        claimable.append("PROCESSING")
    claimed = await db.transactions.find_one_and_update(
        {"metadata.order_id": order_id, "metadata.status": {"$in": claimable}},
        {"$set": {"metadata.status": "PROCESSING"}},
        return_document=True,
    )
    return claimed


async def process_order_success(order_id: str, *, verified_amount: Optional[float] = None) -> dict:
    """
    Idempotent credit for a successful order.

    Safe to call from the webhook, the return page, the in-app verify call, or the
    background reconciler at the same time: a single atomic status flip wins and
    only one credit is applied.
    """
    db = get_db()
    r = get_redis()

    claimed = await _claim_order(order_id, allow_reverify=True)
    if claimed is None:
        existing = await db.transactions.find_one({"metadata.order_id": order_id}, {"_id": 0})
        if existing and (existing.get("type") == "RECHARGE" or existing.get("metadata", {}).get("status") == "SUCCESS"):
            return {"success": True, "message": "Already credited", "already": True}
        return {"success": False, "message": "Order not found or not claimable"}

    splits = split_recharge(float(claimed["amount"]))
    user_id = claimed["user_id"]
    now = datetime.now(timezone.utc)

    # 1. Credit the user's spendable wallet (94%).
    await wallet_service.credit_balance(user_id, splits["credit_amount"])

    # 2. Credit the platform wallet and log the commission in its own collection.
    await db.platform_wallet.update_one(
        {"platform_id": PLATFORM_WALLET_ID},
        {
            "$inc": {"balance": splits["total_commission"]},
            "$set": {"updated_at": now},
            "$setOnInsert": {
                "platform_id": PLATFORM_WALLET_ID,
                "currency": "INR",
                "created_at": now,
            },
        },
        upsert=True,
    )
    await db.platform_commissions.insert_one(
        {
            "commission_id": f"pcom_{uuid.uuid4().hex[:14]}",
            "type": "RECHARGE_COMMISSION",
            "amount": splits["total_commission"],
            "user_id": user_id,
            "order_id": order_id,
            "transaction_id": claimed["transaction_id"],
            "original_amount": splits["original_amount"],
            "credit_amount": splits["credit_amount"],
            "gateway_commission": splits["gateway_commission"],
            "service_commission": splits["service_commission"],
            "created_at": now,
        }
    )

    # 3. Mark the recharge transaction as SUCCESS.
    await db.transactions.update_one(
        {"transaction_id": claimed["transaction_id"]},
        {
            "$set": {
                "type": "RECHARGE",
                "metadata.status": "SUCCESS",
                "metadata.completed_at": now,
                "metadata.commission_breakdown": splits,
            }
        },
    )

    # 4. Referral bonus (never blocks the credit).
    try:
        from app.services import referral_service

        await referral_service.maybe_pay_first_recharge_bonus(user_id)
    except Exception:
        logger.exception("referral bonus failed for %s", user_id)

    if r:
        try:
            await r.delete(idempotency_key(f"recharge:{order_id}"))
        except Exception:
            pass

    wallet = await wallet_service.get_wallet(user_id)
    await emit_to_user(
        user_id,
        "wallet_updated",
        {"balance": wallet.get("balance", 0), "order_id": order_id},
    )
    return {
        "success": True,
        "balance": wallet.get("balance", 0),
        "credited": splits["credit_amount"],
        "commission": splits["total_commission"],
    }


async def verify_with_gateway(order_id: str) -> dict:
    """
    Check the live gateway status and settle the order.
    Used by the return page, the in-app verify call, and the reconciler.
    """
    db = get_db()
    if not cashfree_service.configured():
        # Dev mode can only be settled by the dev-complete endpoint.
        return {"success": False, "status": "PENDING"}

    try:
        order = await cashfree_service.get_order(order_id)
    except Exception:
        logger.exception("gateway status check failed for %s", order_id)
        return {"success": False, "status": "PENDING"}

    if cashfree_service.is_paid(order):
        result = await process_order_success(order_id)
        return {"success": True, "status": "SUCCESS", **result}
    if cashfree_service.is_failed(order):
        await db.transactions.update_one(
            {"metadata.order_id": order_id, "metadata.status": {"$in": ["PENDING", "PROCESSING"]}},
            {"$set": {"metadata.status": "FAILED", "metadata.failed_at": datetime.now(timezone.utc)}},
        )
        return {"success": True, "status": "FAILED"}
    return {"success": True, "status": "PENDING"}


async def reconcile_pending_orders(max_age_minutes: int = 10) -> int:
    """
    Safety net for "user paid then killed the app": settle any PENDING recharge
    older than `max_age_minutes` by asking the gateway for the real status.
    """
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
    pending = (
        await db.transactions.find(
            {
                "type": "RECHARGE_PENDING",
                "metadata.status": {"$in": ["PENDING", "PROCESSING"]},
                "metadata.dev_mode": {"$ne": True},
                "created_at": {"$lt": cutoff},
            },
            {"_id": 0, "metadata.order_id": 1},
        )
        .limit(50)
        .to_list(50)
    )
    settled = 0
    for row in pending:
        order_id = (row.get("metadata") or {}).get("order_id")
        if not order_id:
            continue
        before = await db.transactions.find_one(
            {"metadata.order_id": order_id, "metadata.status": "SUCCESS"}, {"_id": 0, "transaction_id": 1}
        )
        if before:
            continue
        result = await verify_with_gateway(order_id)
        if result.get("status") == "SUCCESS":
            settled += 1
    if settled:
        logger.info("Reconciler settled %s pending recharges", settled)
    return settled
