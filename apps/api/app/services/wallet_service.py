"""Wallet ledger + commission helpers."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from pymongo.errors import DuplicateKeyError

from app.core.config import get_settings
from app.core.database import get_db


def calculate_commission(amount: float) -> dict:
    rate = get_settings().commission_rate
    commission = round(amount * rate, 2)
    model_earnings = round(amount - commission, 2)
    return {
        "commission_rate": rate,
        "commission_amount": commission,
        "model_earnings": model_earnings,
    }


def calculate_withdrawal_split(amount: float, referral_eligible: bool = False) -> dict:
    """Split a gross withdrawal into payout, referral bonus, and platform share.

    The creator requests a gross amount from their earnings. A 10% withdrawal
    commission is retained. When the creator has an active referrer, 5% of the
    gross withdrawal is credited to that referrer and the platform keeps the
    remaining 5%; otherwise the full 10% belongs to the platform.
    """
    settings = get_settings()
    gross = round(float(amount or 0), 2)
    rate = float(settings.withdrawal_commission_rate)
    commission = round(gross * rate, 2)
    payout = max(0.0, round(gross - commission, 2))
    bonus_percentage = float(settings.model_referral_bonus_percentage)
    potential_bonus = round(gross * (bonus_percentage / 100.0), 2)
    # Never let a referral payout exceed the commission actually collected.
    bonus = min(potential_bonus, commission) if referral_eligible else 0.0
    platform = round(commission - bonus, 2)
    return {
        "gross_amount": gross,
        "commission_rate": rate,
        "commission_amount": commission,
        "payout_amount": payout,
        "referral_bonus_percentage": bonus_percentage,
        "potential_referral_bonus_amount": potential_bonus,
        "referral_bonus_amount": bonus,
        "platform_commission_amount": platform,
    }


async def record_platform_commission(
    *,
    commission_type: str,
    amount: float,
    source_id: str,
    user_id: Optional[str] = None,
    gross_amount: Optional[float] = None,
    model_earnings: Optional[float] = None,
    minute: Optional[int] = None,
    metadata: Optional[dict] = None,
    commission_id: Optional[str] = None,
    gateway_commission: Optional[float] = None,
    service_commission: Optional[float] = None,
) -> dict:
    """Append a document to the platform commission ledger.

    `minute` is the unique discriminator for per-minute CALL_COMMISSION rows;
    combined with `source_id` + `type` it makes settlement idempotent.
    Pass `commission_id` for a deterministic idempotency key (used by recharge
    settlement).
    """
    db = get_db()
    if minute is not None:
        existing = await db.platform_commissions.find_one(
            {"source_id": source_id, "type": commission_type, "minute": minute},
            {"_id": 0},
        )
        if existing:
            return existing
    doc = {
        "commission_id": commission_id or f"pcom_{uuid.uuid4().hex[:14]}",
        "type": commission_type,  # RECHARGE_COMMISSION | CALL_COMMISSION | GIFT_COMMISSION
        "amount": round(float(amount), 2),
        "user_id": user_id,
        "source_id": source_id,
        "gross_amount": round(float(gross_amount), 2) if gross_amount is not None else None,
        "model_earnings": round(float(model_earnings), 2) if model_earnings is not None else None,
        "gateway_commission": round(float(gateway_commission), 2) if gateway_commission is not None else None,
        "service_commission": round(float(service_commission), 2) if service_commission is not None else None,
        "minute": minute,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc),
    }
    try:
        await db.platform_commissions.insert_one(doc)
    except DuplicateKeyError:
        existing = await db.platform_commissions.find_one(
            {"commission_id": doc["commission_id"]}, {"_id": 0}
        )
        if existing:
            return existing
        raise
    return doc


async def add_platform_balance(amount: float) -> None:
    if amount <= 0:
        return
    db = get_db()
    now = datetime.now(timezone.utc)
    update = {
        "$inc": {"balance": round(float(amount), 2)},
        "$set": {"updated_at": now},
        "$setOnInsert": {
            "platform_id": "platform_001",
            "currency": "INR",
            "created_at": now,
        },
    }
    try:
        await db.platform_wallet.update_one(
            {"platform_id": "platform_001"}, update, upsert=True
        )
    except DuplicateKeyError:
        # Two workers created the platform wallet at the same time. Retry the
        # increment against the document that won; never drop the commission.
        await db.platform_wallet.update_one({"platform_id": "platform_001"}, update)


async def add_platform_balance_once(amount: float, order_id: str) -> bool:
    """Idempotently add a recharge commission to the platform wallet.

    Returns True when this call applied the credit, False when it was already
    applied. The order id is stored in the same platform-wallet document as the
    increment, so a retry after a crash can never add the commission twice.
    """
    if amount <= 0 or not order_id:
        return False
    db = get_db()
    now = datetime.now(timezone.utc)
    try:
        await db.platform_wallet.update_one(
            {"platform_id": "platform_001"},
            {
                "$setOnInsert": {
                    "platform_id": "platform_001",
                    "balance": 0.0,
                    "currency": "INR",
                    "created_at": now,
                }
            },
            upsert=True,
        )
    except DuplicateKeyError:
        # A concurrent worker inserted the platform wallet first.
        pass
    updated = await db.platform_wallet.find_one_and_update(
        {
            "platform_id": "platform_001",
            "credited_recharge_order_ids": {"$ne": order_id},
        },
        {
            "$inc": {"balance": round(float(amount), 2)},
            "$push": {"credited_recharge_order_ids": order_id},
            "$set": {"updated_at": now},
        },
        return_document=True,
    )
    if updated:
        return True
    wallet = await db.platform_wallet.find_one(
        {"platform_id": "platform_001"}, {"_id": 0}
    )
    if wallet and order_id in (wallet.get("credited_recharge_order_ids") or []):
        return False
    raise RuntimeError(f"Could not apply platform commission for recharge {order_id}")


async def get_wallet(user_id: str) -> dict:
    db = get_db()
    wallet = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
    if not wallet:
        wallet = {
            "user_id": user_id,
            "balance": 0.0,
            "earnings_balance": 0.0,
            "updated_at": datetime.now(timezone.utc),
        }
        try:
            await db.wallets.insert_one(wallet)
        except DuplicateKeyError:
            # A concurrent request created the wallet first.
            wallet = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
            if not wallet:
                raise
    return wallet


async def atomic_debit(user_id: str, amount: float) -> Optional[dict]:
    """Debit spendable balance if sufficient. Returns updated wallet or None."""
    db = get_db()
    return await db.wallets.find_one_and_update(
        {"user_id": user_id, "balance": {"$gte": amount}},
        {
            "$inc": {"balance": -amount},
            "$set": {"updated_at": datetime.now(timezone.utc)},
        },
        return_document=True,
    )


async def credit_balance(user_id: str, amount: float) -> dict:
    db = get_db()
    update = {
        "$inc": {"balance": amount},
        "$set": {"updated_at": datetime.now(timezone.utc)},
    }
    try:
        return await db.wallets.find_one_and_update(
            {"user_id": user_id},
            update,
            upsert=True,
            return_document=True,
        )
    except DuplicateKeyError:
        return await db.wallets.find_one_and_update(
            {"user_id": user_id},
            update,
            return_document=True,
        )


async def credit_balance_once(
    user_id: str, amount: float, order_id: str
) -> tuple[bool, dict]:
    """Credit spendable balance exactly once for a payment order.

    The order id is added to the wallet in the *same* atomic MongoDB update as
    the balance increment. If the process crashes after the write, a retry sees
    the marker and does not increment again. Returns ``(applied, wallet)``.
    """
    db = get_db()
    await get_wallet(user_id)
    now = datetime.now(timezone.utc)
    updated = await db.wallets.find_one_and_update(
        {
            "user_id": user_id,
            "credited_recharge_order_ids": {"$ne": order_id},
        },
        {
            "$inc": {"balance": round(float(amount), 2)},
            "$push": {"credited_recharge_order_ids": order_id},
            "$set": {"updated_at": now},
        },
        return_document=True,
    )
    if updated:
        return True, updated
    wallet = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
    if wallet and order_id in (wallet.get("credited_recharge_order_ids") or []):
        return False, wallet

    # The wallet was missing or a concurrent delete removed it before the
    # guarded update. Recreate it and retry once. Never report "already
    # credited" unless the marker is actually present.
    await get_wallet(user_id)
    updated = await db.wallets.find_one_and_update(
        {
            "user_id": user_id,
            "credited_recharge_order_ids": {"$ne": order_id},
        },
        {
            "$inc": {"balance": round(float(amount), 2)},
            "$push": {"credited_recharge_order_ids": order_id},
            "$set": {"updated_at": now},
        },
        return_document=True,
    )
    if updated:
        return True, updated
    wallet = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
    if wallet and order_id in (wallet.get("credited_recharge_order_ids") or []):
        return False, wallet
    raise RuntimeError(f"Could not apply wallet credit for recharge {order_id}")


async def credit_earnings(user_id: str, amount: float) -> dict:
    db = get_db()
    update = {
        "$inc": {"earnings_balance": amount},
        "$set": {"updated_at": datetime.now(timezone.utc)},
    }
    try:
        return await db.wallets.find_one_and_update(
            {"user_id": user_id},
            update,
            upsert=True,
            return_document=True,
        )
    except DuplicateKeyError:
        return await db.wallets.find_one_and_update(
            {"user_id": user_id},
            update,
            return_document=True,
        )


async def insert_transaction(
    *,
    user_id: str,
    tx_type: str,
    amount: float,
    description: str,
    metadata: Optional[dict] = None,
    transaction_id: Optional[str] = None,
) -> dict:
    db = get_db()
    tx = {
        "transaction_id": transaction_id or f"tx_{uuid.uuid4().hex[:14]}",
        "user_id": user_id,
        "type": tx_type,
        "amount": amount,
        "description": description,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc),
    }
    await db.transactions.insert_one(tx)
    return tx


RECHARGE_PACKAGES = [
    {"id": "pkg_99", "amount": 99, "label": "Starter"},
    {"id": "pkg_199", "amount": 199, "label": "Popular"},
    {"id": "pkg_499", "amount": 499, "label": "Value"},
    {"id": "pkg_999", "amount": 999, "label": "Pro"},
    {"id": "pkg_1999", "amount": 1999, "label": "Ultra"},
]
