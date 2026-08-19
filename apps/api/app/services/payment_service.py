"""Trustope payment gateway adapter + idempotent credit."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.core.config import get_settings
from app.core.database import get_db
from app.core.database_redis import get_redis, idempotency_key
from app.core.socket import emit_to_user
from app.services import wallet_service

logger = logging.getLogger(__name__)

TRUSTOPE_CREATE = "https://trustope.com/api/create-order"
TRUSTOPE_STATUS = "https://trustope.com/api/check-order-status"


async def initiate_recharge(*, user: dict, amount: float, package_id: Optional[str] = None) -> dict:
    if amount < 10:
        raise ValueError("Minimum recharge is ₹10")

    bonus = 0.0
    if package_id:
        pkg = next((p for p in wallet_service.RECHARGE_PACKAGES if p["id"] == package_id), None)
        if pkg:
            amount = float(pkg["amount"])
            bonus = float(pkg["bonus"])

    credit_amount = amount + bonus
    order_id = f"ord_{uuid.uuid4().hex[:14]}"
    tx_id = f"tx_recharge_{order_id}"
    db = get_db()
    settings = get_settings()

    await db.transactions.insert_one(
        {
            "transaction_id": tx_id,
            "user_id": user["user_id"],
            "type": "RECHARGE_PENDING",
            "amount": credit_amount,
            "description": f"Recharge ₹{amount}" + (f" +₹{bonus} bonus" if bonus else ""),
            "metadata": {
                "order_id": order_id,
                "base_amount": amount,
                "bonus": bonus,
                "package_id": package_id,
                "status": "PENDING",
            },
            "created_at": datetime.now(timezone.utc),
        }
    )

    phone = (user.get("phone") or "").replace("+91", "")[-10:]
    if not settings.trustope_user_token:
        # Dev mode: return mock payment URL that hits our success endpoint
        payment_url = f"{settings.backend_url}/api/wallet/recharge/dev-complete?order_id={order_id}"
        return {
            "success": True,
            "order_id": order_id,
            "transaction_id": tx_id,
            "payment_url": payment_url,
            "amount": amount,
            "credit_amount": credit_amount,
            "dev_mode": True,
        }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            TRUSTOPE_CREATE,
            data={
                "customer_mobile": phone or "9999999999",
                "user_token": settings.trustope_user_token,
                "amount": str(int(amount)),
                "order_id": order_id,
                "redirect_url": f"{settings.trustope_redirect_url}?order_id={order_id}",
                "remark1": f"user_{user['user_id']}_recharge",
            },
        )
        data = resp.json()
    if data.get("status") != "success" and not data.get("payment_url"):
        await db.transactions.update_one(
            {"transaction_id": tx_id},
            {"$set": {"metadata.status": "FAILED"}},
        )
        raise RuntimeError(data.get("message") or "Payment initiation failed")

    return {
        "success": True,
        "order_id": order_id,
        "transaction_id": tx_id,
        "payment_url": data.get("payment_url"),
        "amount": amount,
        "credit_amount": credit_amount,
    }


async def process_order_success(order_id: str) -> dict:
    """Idempotent wallet credit for a successful order."""
    r = get_redis()
    if r:
        await r.set(idempotency_key(f"recharge:{order_id}"), "1", nx=True, ex=120)
    db = get_db()

    tx = await db.transactions.find_one({"metadata.order_id": order_id}, {"_id": 0})
    if not tx:
        return {"success": False, "message": "Order not found"}
    if tx.get("type") == "RECHARGE" or tx.get("metadata", {}).get("status") == "SUCCESS":
        return {"success": True, "message": "Already credited", "already": True}

    # Atomic claim via status flip
    claimed = await db.transactions.find_one_and_update(
        {
            "metadata.order_id": order_id,
            "metadata.status": "PENDING",
        },
        {"$set": {"metadata.status": "PROCESSING"}},
        return_document=True,
    )
    if not claimed:
        tx2 = await db.transactions.find_one({"metadata.order_id": order_id}, {"_id": 0})
        if tx2 and tx2.get("metadata", {}).get("status") == "SUCCESS":
            return {"success": True, "already": True}
        return {"success": False, "message": "Could not claim order"}

    amount = float(claimed["amount"])
    user_id = claimed["user_id"]
    await wallet_service.credit_balance(user_id, amount)
    await db.transactions.update_one(
        {"transaction_id": claimed["transaction_id"]},
        {
            "$set": {
                "type": "RECHARGE",
                "metadata.status": "SUCCESS",
                "metadata.completed_at": datetime.now(timezone.utc),
            }
        },
    )
    wallet = await wallet_service.get_wallet(user_id)
    await emit_to_user(
        user_id,
        "wallet_updated",
        {"balance": wallet.get("balance", 0), "order_id": order_id},
    )
    return {"success": True, "balance": wallet.get("balance", 0), "credited": amount}
