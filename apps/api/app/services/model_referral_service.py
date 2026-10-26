"""Model Referral Service - handles model-to-model referrals and bonuses.

Business rules (see docs/MODEL_REFERRAL_SYSTEM.md):
* Only approved creators participate as referrers.
* A creator can apply one model referral code, and cannot use their own.
* The referrer earns ``model_referral_bonus_percentage`` of **every**
  successful withdrawal made by a referred model.
* The bonus is paid out of the 10% withdrawal commission: 5% to the referrer,
  the remaining 5% to the platform. With no active referrer (including either
  account being deleted), the platform keeps the full 10%.
* The bonus is credited to the referrer's earnings wallet (never the spendable
  fan balance), and processing is idempotent per withdrawal request.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.config import get_settings
from app.core.database import get_db
from app.core.socket import emit_to_user
from app.services import auth_service, push_service, wallet_service

logger = logging.getLogger(__name__)


def _mask_phone(phone: Optional[str]) -> str:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) >= 4:
        return f"+91******{digits[-4:]}"
    return "Hidden"


def _as_utc(value: Any) -> Optional[datetime]:
    """Mongo returns naive UTC datetimes; comparisons need a consistent tz."""
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _month_start(now: datetime) -> datetime:
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc)


async def ensure_model_referral_code(user: dict) -> str:
    """Return the creator's model referral code, creating it if needed."""
    code = (user.get("model_referral_code") or "").strip().upper()
    if code:
        return code

    db = get_db()
    settings = get_settings()
    code = await auth_service.generate_referral_code(
        prefix=settings.model_referral_code_prefix,
        length=settings.model_referral_code_length,
        field="model_referral_code",
    )
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"model_referral_code": code}},
    )
    user["model_referral_code"] = code
    return code


async def _is_approved_creator(user_id: str) -> bool:
    """Approval lives on creator_profiles; users.is_approved is only a mirror."""
    db = get_db()
    profile = await db.creator_profiles.find_one(
        {"user_id": user_id, "is_approved": True}, {"_id": 0, "user_id": 1}
    )
    return bool(profile)


async def resolve_withdrawal_referrers(user_ids: list[str]) -> dict[str, dict]:
    """Return the active referral recipient for each withdrawing creator.

    A bonus is payable only while both accounts still exist. Account deletion
    sets ``users.deleted``; when either side has deleted, the 5% referral share
    is not payable and the platform keeps the full 10% withdrawal commission.
    """
    db = get_db()
    ids = list(dict.fromkeys(uid for uid in user_ids if uid))
    if not ids:
        return {}

    users = await db.users.find(
        {"user_id": {"$in": ids}},
        {
            "_id": 0,
            "user_id": 1,
            "name": 1,
            "user_type": 1,
            "model_referred_by": 1,
            "deleted": 1,
        },
    ).to_list(len(ids))
    by_id = {u["user_id"]: u for u in users if u.get("user_id")}

    referrer_ids = list(
        dict.fromkeys(
            u.get("model_referred_by")
            for u in users
            if u.get("model_referred_by")
        )
    )
    referrers = {}
    if referrer_ids:
        rows = await db.users.find(
            {"user_id": {"$in": referrer_ids}, "deleted": {"$ne": True}},
            {"_id": 0, "user_id": 1, "name": 1, "deleted": 1},
        ).to_list(len(referrer_ids))
        referrers = {u["user_id"]: u for u in rows if u.get("user_id")}

    result: dict[str, dict] = {}
    for user_id, user in by_id.items():
        if user.get("deleted"):
            continue
        referrer_id = user.get("model_referred_by")
        if not referrer_id or referrer_id == user_id:
            continue
        referrer = referrers.get(referrer_id)
        if not referrer or referrer.get("deleted"):
            continue
        result[user_id] = {
            "referrer_id": referrer_id,
            "referrer_name": referrer.get("name") or "Model",
        }
    return result


async def resolve_withdrawal_referrer(withdrawal_user_id: str) -> Optional[dict]:
    """Return the active referrer for one creator, or None if not payable."""
    return (await resolve_withdrawal_referrers([withdrawal_user_id])).get(
        withdrawal_user_id
    )


async def _bonus_rows(referrer_id: str) -> list[dict]:
    db = get_db()
    return (
        await db.model_referral_bonuses.find(
            {"referrer_id": referrer_id},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(1000)
    )


async def _referred_users(referrer_id: str) -> list[dict]:
    db = get_db()
    return (
        await db.users.find(
            {"model_referred_by": referrer_id},
            {
                "_id": 0,
                "user_id": 1,
                "name": 1,
                "phone": 1,
                "created_at": 1,
                "model_referral_rewarded_at": 1,
                "is_approved": 1,
            },
        )
        .sort("created_at", -1)
        .to_list(500)
    )


def _referral_details(referred: list[dict], bonuses: list[dict]) -> list[dict]:
    by_referred: dict[str, list[dict]] = {}
    for row in bonuses:
        by_referred.setdefault(row.get("referred_user_id") or "", []).append(row)

    details = []
    for ref in referred:
        rows = by_referred.get(ref["user_id"], [])
        total_bonus = round(sum(float(r.get("bonus_amount") or 0) for r in rows), 2)
        total_withdrawn = round(sum(float(r.get("withdrawal_amount") or 0) for r in rows), 2)
        dates = [d for d in (_as_utc(r.get("created_at")) for r in rows) if d]
        last_at = max(dates, default=None)
        details.append(
            {
                "user_id": ref["user_id"],
                "name": ref.get("name") or "Model",
                "phone_masked": _mask_phone(ref.get("phone")),
                "joined_at": ref.get("created_at"),
                "status": "active" if rows else "pending",
                "is_approved": bool(ref.get("is_approved")),
                "total_withdrawals": total_withdrawn,
                "total_withdraw_count": len(rows),
                "total_bonus_from_them": total_bonus,
                "last_bonus_at": last_at,
            }
        )
    return details


async def get_model_referral_overview(user: dict) -> dict:
    """Overview for the creator referral tab."""
    settings = get_settings()

    if user.get("user_type") != "creator":
        raise HTTPException(403, "Model referral is available to creators only")

    code = await ensure_model_referral_code(user)
    referred = await _referred_users(user["user_id"])
    bonuses = await _bonus_rows(user["user_id"])
    is_approved = await _is_approved_creator(user["user_id"])

    now = datetime.now(timezone.utc)
    earned_total = round(sum(float(r.get("bonus_amount") or 0) for r in bonuses), 2)
    this_month = round(
        sum(
            float(r.get("bonus_amount") or 0)
            for r in bonuses
            if (_as_utc(r.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc))
            >= _month_start(now)
        ),
        2,
    )
    last_30 = round(
        sum(
            float(r.get("bonus_amount") or 0)
            for r in bonuses
            if (_as_utc(r.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc))
            >= now - timedelta(days=30)
        ),
        2,
    )

    share_url = f"{settings.deep_link_scheme or 'simpletalk'}://login?model_ref={code}"
    details = _referral_details(referred, bonuses)

    return {
        "success": True,
        "code": code,
        "share_url": share_url,
        "referred_count": len(referred),
        "pending_count": sum(1 for r in details if r["status"] == "pending"),
        "earned_total": earned_total,
        "this_month_earnings": this_month,
        "last_30_days_earnings": last_30,
        "referrer_bonus_percentage": settings.model_referral_bonus_percentage,
        "minimum_withdrawal": settings.model_referral_min_withdrawal,
        "is_approved": is_approved,
        "can_apply": not bool(user.get("model_referred_by")),
        "referrals": details,
        "earnings_history": [
            {
                "date": r.get("created_at"),
                "amount": r.get("bonus_amount"),
                "referred_model": r.get("referred_model_name") or "Model",
                "withdrawal_amount": r.get("withdrawal_amount", 0),
                "withdrawal_request_id": r.get("withdrawal_request_id"),
            }
            for r in bonuses[:50]
        ],
        "share_message": build_share_message(code, share_url),
    }


async def apply_model_referral_code(user: dict, raw_code: str) -> dict:
    """Apply a model referral code during or after signup."""
    code = (raw_code or "").strip().upper()
    if len(code) < 4:
        raise HTTPException(400, "Enter a valid model referral code")

    db = get_db()
    me = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not me:
        raise HTTPException(404, "User not found")
    if me.get("user_type") != "creator":
        raise HTTPException(403, "Only creators can use model referral codes")
    if me.get("model_referred_by"):
        raise HTTPException(400, "A model referral code is already applied")
    if (me.get("model_referral_code") or "").upper() == code:
        raise HTTPException(400, "You can't use your own code")

    referrer = await db.users.find_one(
        {"model_referral_code": code, "user_type": "creator"},
        {"_id": 0},
    )
    if not referrer:
        raise HTTPException(404, "Invalid or inactive model referral code")
    if not await _is_approved_creator(referrer["user_id"]):
        raise HTTPException(404, "Invalid or inactive model referral code")
    if referrer["user_id"] == user["user_id"]:
        raise HTTPException(400, "You can't use your own code")

    # Walk the referral chain so A -> B -> C -> A cannot be created.
    cursor_id = referrer.get("model_referred_by")
    for _ in range(10):
        if not cursor_id:
            break
        if cursor_id == user["user_id"]:
            raise HTTPException(400, "Circular referral not allowed")
        parent = await db.users.find_one(
            {"user_id": cursor_id}, {"_id": 0, "model_referred_by": 1}
        )
        cursor_id = parent.get("model_referred_by") if parent else None

    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"model_referred_by": referrer["user_id"], "updated_at": now}},
    )
    await db.users.update_one(
        {"user_id": referrer["user_id"], "model_referrals.user_id": {"$ne": user["user_id"]}},
        {
            "$push": {
                "model_referrals": {
                    "user_id": user["user_id"],
                    "name": user.get("name") or "Model",
                    "joined_at": now,
                    "total_withdrawals": 0.0,
                    "total_bonus_from_them": 0.0,
                    "status": "pending",
                }
            }
        },
    )
    return {"success": True, "message": "Model referral code applied"}


async def process_model_referral_bonus(
    withdrawal_user_id: str,
    withdrawal_amount: float,
    withdrawal_request_id: Optional[str] = None,
) -> bool:
    """Credit the referrer when a referred model's withdrawal is paid.

    Idempotent per ``withdrawal_request_id``: retries, double-clicks in admin,
    or duplicate webhooks can never pay the same withdrawal twice. If either
    account was deleted, no bonus is payable and the platform keeps the full
    withdrawal commission.
    """
    settings = get_settings()
    db = get_db()

    amount = float(withdrawal_amount or 0)
    if amount < settings.model_referral_min_withdrawal:
        return False
    if amount <= 0:
        return False

    user = await db.users.find_one(
        {"user_id": withdrawal_user_id},
        {"_id": 0, "user_id": 1, "name": 1, "model_referred_by": 1, "deleted": 1},
    )
    if not user or user.get("deleted") or not user.get("model_referred_by"):
        return False

    referral = await resolve_withdrawal_referrer(withdrawal_user_id)
    if not referral:
        return False
    referrer_id = referral["referrer_id"]
    referrer_name = referral.get("referrer_name") or "Model"

    percentage = float(settings.model_referral_bonus_percentage)
    bonus = round(amount * (percentage / 100.0), 2)
    if bonus <= 0:
        return False

    request_key = withdrawal_request_id or f"manual_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)

    bonus_doc = {
        "withdrawal_request_id": request_key,
        "referrer_id": referrer_id,
        "referrer_name": referrer_name,
        "referred_user_id": withdrawal_user_id,
        "referred_model_name": user.get("name") or "Model",
        "withdrawal_amount": round(amount, 2),
        "bonus_percentage": percentage,
        "bonus_amount": bonus,
        "created_at": now,
    }
    try:
        await db.model_referral_bonuses.insert_one(bonus_doc)
    except DuplicateKeyError:
        return False

    try:
        await wallet_service.credit_earnings(referrer_id, bonus)
    except Exception:
        # Nothing was credited; remove the marker so a retry can try again.
        await db.model_referral_bonuses.delete_one({"withdrawal_request_id": request_key})
        raise

    # The earnings credit has succeeded. From this point the idempotency marker
    # must stay, even if a bookkeeping write fails, otherwise a retry would
    # credit the referrer twice.
    try:
        await wallet_service.insert_transaction(
            user_id=referrer_id,
            tx_type="MODEL_REFERRAL_BONUS",
            amount=bonus,
            description=(
                f"Model referral bonus — {bonus_doc['referred_model_name']}'s "
                f"₹{amount:,.2f} withdrawal"
            ),
            metadata={
                "referred_user_id": withdrawal_user_id,
                "referred_model_name": bonus_doc["referred_model_name"],
                "withdrawal_amount": round(amount, 2),
                "withdrawal_request_id": request_key,
                "bonus_percentage": percentage,
                "bonus_amount": bonus,
            },
            transaction_id=f"tx_model_ref_{request_key}",
        )
    except Exception:
        logger.exception(
            "Model referral ledger write failed for withdrawal %s", request_key
        )

    try:
        await db.users.update_one(
            {"user_id": referrer_id},
            {
                "$inc": {"model_referral_earnings": bonus},
                "$set": {"model_referral_rewarded_at": now},
            },
        )

        updated = await db.users.update_one(
            {"user_id": referrer_id, "model_referrals.user_id": withdrawal_user_id},
            {
                "$inc": {
                    "model_referrals.$.total_bonus_from_them": bonus,
                    "model_referrals.$.total_withdrawals": round(amount, 2),
                },
                "$set": {"model_referrals.$.status": "active"},
            },
        )
        if not updated or getattr(updated, "matched_count", 0) == 0:
            await db.users.update_one(
                {
                    "user_id": referrer_id,
                    "model_referrals.user_id": {"$ne": withdrawal_user_id},
                },
                {
                    "$push": {
                        "model_referrals": {
                            "user_id": withdrawal_user_id,
                            "name": bonus_doc["referred_model_name"],
                            "joined_at": now,
                            "total_withdrawals": round(amount, 2),
                            "total_bonus_from_them": bonus,
                            "status": "active",
                        }
                    }
                },
            )

        # Informational: last time this model generated a referral bonus.
        await db.users.update_one(
            {"user_id": withdrawal_user_id},
            {"$set": {"model_referral_rewarded_at": now}},
        )
    except Exception:
        logger.exception(
            "Model referral stats update failed for withdrawal %s", request_key
        )

    title = "Model Referral Bonus!"
    body = (
        f"You earned ₹{bonus:.2f} from "
        f"{bonus_doc['referred_model_name']}'s withdrawal"
    )

    # Persist the in-app notification as well as the live socket event. Without
    # the DB row it would appear as a toast but never show in the inbox.
    try:
        await db.notifications.insert_one(
            {
                "notification_id": f"ntf_{uuid.uuid4().hex[:12]}",
                "user_id": referrer_id,
                "title": title,
                "body": body,
                "type": "model_referral_bonus",
                "data": {
                    "withdrawal_request_id": request_key,
                    "referred_user_id": withdrawal_user_id,
                    "bonus_amount": bonus,
                },
                "read": False,
                "created_at": now,
            }
        )
    except Exception:
        logger.exception(
            "Model referral notification insert failed for withdrawal %s", request_key
        )

    try:
        wallet = await wallet_service.get_wallet(referrer_id)
        await emit_to_user(
            referrer_id,
            "wallet_updated",
            {"balance": wallet.get("balance", 0), "reason": "model_referral_bonus"},
        )
        await emit_to_user(
            referrer_id,
            "new_notification",
            {
                "title": title,
                "message": body,
                "type": "model_referral_bonus",
            },
        )
    except Exception:
        logger.exception(
            "Model referral socket emit failed for withdrawal %s", request_key
        )

    try:
        token_doc = await db.push_tokens.find_one({"user_id": referrer_id}, {"_id": 0})
        token = (token_doc or {}).get("device_push_token")
        if token:
            ok = await push_service.send_push(
                token,
                title=title,
                body=body,
                data={
                    "type": "model_referral_bonus",
                    "withdrawal_request_id": request_key,
                },
                channel_id="app_notifications",
            )
            if not ok and push_service.token_is_dead(token):
                await db.push_tokens.delete_one(
                    {"user_id": referrer_id, "device_push_token": token}
                )
    except Exception:
        logger.exception(
            "Model referral push failed for withdrawal %s", request_key
        )

    return True


async def get_model_referral_earnings(user: dict) -> dict:
    """Detailed month-by-month earnings from model referrals."""
    bonuses = await _bonus_rows(user["user_id"])
    total_earned = round(sum(float(r.get("bonus_amount") or 0) for r in bonuses), 2)

    monthly: dict[str, float] = {}
    for row in bonuses:
        created = _as_utc(row.get("created_at"))
        if created:
            key = created.strftime("%Y-%m")
            monthly[key] = monthly.get(key, 0.0) + float(row.get("bonus_amount") or 0)

    settings = get_settings()
    return {
        "success": True,
        "total_earned": total_earned,
        "monthly_breakdown": [
            {"month": month, "amount": round(amount, 2)}
            for month, amount in sorted(monthly.items(), reverse=True)
        ],
        "transactions": [
            {
                "date": r.get("created_at"),
                "amount": r.get("bonus_amount"),
                "referred_model": r.get("referred_model_name"),
                "withdrawal_amount": r.get("withdrawal_amount", 0),
                "bonus_percentage": r.get("bonus_percentage", settings.model_referral_bonus_percentage),
            }
            for r in bonuses[:100]
        ],
        "referrer_bonus_percentage": settings.model_referral_bonus_percentage,
    }


async def get_model_referrals_list(user: dict) -> dict:
    """Referred models with their live withdrawal and bonus totals."""
    referred = await _referred_users(user["user_id"])
    bonuses = await _bonus_rows(user["user_id"])
    return {"success": True, "referrals": _referral_details(referred, bonuses)}


async def get_admin_model_referral_summary(limit: int = 50) -> dict:
    """Platform-wide model referral analytics for the admin dashboard."""
    db = get_db()
    now = datetime.now(timezone.utc)

    bonuses = await db.model_referral_bonuses.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    referred_total = await db.users.count_documents({"model_referred_by": {"$exists": True}})
    approved_referred = await db.users.count_documents(
        {"model_referred_by": {"$exists": True}, "is_approved": True}
    )
    paid_models = len({r.get("referred_user_id") for r in bonuses if r.get("referred_user_id")})
    referrer_ids = {r.get("referrer_id") for r in bonuses if r.get("referrer_id")}

    totals: dict[str, dict] = {}
    for row in bonuses:
        key = row.get("referrer_id") or ""
        entry = totals.setdefault(
            key,
            {"user_id": key, "name": "Deleted user", "total_bonus": 0.0, "bonus_count": 0},
        )
        entry["total_bonus"] += float(row.get("bonus_amount") or 0)
        entry["bonus_count"] += 1

    if totals:
        users = await db.users.find(
            {"user_id": {"$in": list(totals.keys())}},
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1},
        ).to_list(500)
        by_id = {u["user_id"]: u for u in users}
        for key, entry in totals.items():
            user = by_id.get(key)
            if user:
                entry["name"] = user.get("name") or "Model"
                entry["phone_masked"] = _mask_phone(user.get("phone"))

    top_referrers = sorted(
        ({**e, "total_bonus": round(e["total_bonus"], 2)} for e in totals.values()),
        key=lambda e: e["total_bonus"],
        reverse=True,
    )[:10]

    month_start = _month_start(now)
    month_bonus = round(
        sum(
            float(r.get("bonus_amount") or 0)
            for r in bonuses
            if (_as_utc(r.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc))
            >= month_start
        ),
        2,
    )

    return {
        "success": True,
        "total_bonuses_paid": round(sum(float(r.get("bonus_amount") or 0) for r in bonuses), 2),
        "bonus_count": len(bonuses),
        "this_month_bonus": month_bonus,
        "active_referrers": len(referrer_ids),
        "referred_models": referred_total,
        "approved_referred_models": approved_referred,
        "models_with_paid_withdrawals": paid_models,
        "conversion_rate": round((paid_models / referred_total) * 100, 1) if referred_total else 0.0,
        "top_referrers": top_referrers,
        "recent_bonuses": [
            {
                "withdrawal_request_id": r.get("withdrawal_request_id"),
                "referrer_id": r.get("referrer_id"),
                "referred_user_id": r.get("referred_user_id"),
                "referred_model_name": r.get("referred_model_name") or "Model",
                "withdrawal_amount": r.get("withdrawal_amount", 0),
                "bonus_amount": r.get("bonus_amount", 0),
                "bonus_percentage": r.get("bonus_percentage"),
                "created_at": r.get("created_at"),
            }
            for r in bonuses[:limit]
        ],
    }


def build_share_message(code: str, share_url: str) -> str:
    settings = get_settings()
    app_name = settings.app_name
    percentage = settings.model_referral_bonus_percentage
    percentage_text = f"{percentage:g}%"
    return (
        f"🌟 Join {app_name} as a Creator!\n\n"
        f"🎁 Creator benefits:\n"
        f"✅ Full control over your rates & schedule\n"
        f"✅ Payouts to UPI/Bank\n\n"
        f"📋 How to join:\n"
        f"1️⃣ Download {app_name}\n"
        f"2️⃣ Sign up as \"Creator\"\n"
        f"3️⃣ Enter my code: {code}\n"
        f"4️⃣ Complete verification\n"
        f"5️⃣ Set your rates & go live!\n\n"
        f"💸 Refer other creators and earn {percentage_text} of every withdrawal they make.\n\n"
        f"🔗 {share_url}\n\n"
        f"#SimpleTalk #CreatorEconomy #WorkFromHome"
    )
