"""Wallet ledger + commission helpers."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

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
) -> dict:
    """Append a document to the platform commission ledger.

    `minute` is the unique discriminator for per-minute CALL_COMMISSION rows;
    combined with `source_id` + `type` it makes settlement idempotent.
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
        "commission_id": f"pcom_{uuid.uuid4().hex[:14]}",
        "type": commission_type,  # RECHARGE_COMMISSION | CALL_COMMISSION | GIFT_COMMISSION
        "amount": round(float(amount), 2),
        "user_id": user_id,
        "source_id": source_id,
        "gross_amount": round(float(gross_amount), 2) if gross_amount is not None else None,
        "model_earnings": round(float(model_earnings), 2) if model_earnings is not None else None,
        "minute": minute,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc),
    }
    await db.platform_commissions.insert_one(doc)
    return doc


async def add_platform_balance(amount: float) -> None:
    if amount <= 0:
        return
    db = get_db()
    now = datetime.now(timezone.utc)
    await db.platform_wallet.update_one(
        {"platform_id": "platform_001"},
        {
            "$inc": {"balance": round(float(amount), 2)},
            "$set": {"updated_at": now},
            "$setOnInsert": {
                "platform_id": "platform_001",
                "currency": "INR",
                "created_at": now,
            },
        },
        upsert=True,
    )


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
        await db.wallets.insert_one(wallet)
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
    return await db.wallets.find_one_and_update(
        {"user_id": user_id},
        {
            "$inc": {"balance": amount},
            "$set": {"updated_at": datetime.now(timezone.utc)},
        },
        upsert=True,
        return_document=True,
    )


async def credit_earnings(user_id: str, amount: float) -> dict:
    db = get_db()
    return await db.wallets.find_one_and_update(
        {"user_id": user_id},
        {
            "$inc": {"earnings_balance": amount},
            "$set": {"updated_at": datetime.now(timezone.utc)},
        },
        upsert=True,
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
