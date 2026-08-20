"""Referral codes, apply, and first-recharge bonuses."""

from typing import Optional

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.database import get_db
from app.core.socket import emit_to_user
from app.services import auth_service, wallet_service


def _mask_phone(phone: Optional[str]) -> str:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) >= 4:
        return f"+91******{digits[-4:]}"
    return "Hidden"


async def ensure_referral_code(user: dict) -> str:
    code = (user.get("referral_code") or "").strip().upper()
    if code:
        return code
    db = get_db()
    code = await auth_service.generate_referral_code()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"referral_code": code}})
    user["referral_code"] = code
    return code


async def get_referral_overview(user: dict) -> dict:
    db = get_db()
    settings = get_settings()
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0}) or user
    code = await ensure_referral_code(fresh)
    referred = (
        await db.users.find(
            {"referred_by": user["user_id"]},
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "created_at": 1, "referral_rewarded_at": 1},
        )
        .sort("created_at", -1)
        .to_list(100)
    )
    earned_rows = await db.transactions.find(
        {"user_id": user["user_id"], "type": "REFERRAL_BONUS"},
        {"_id": 0, "amount": 1},
    ).to_list(200)
    earned_total = round(sum(float(r.get("amount") or 0) for r in earned_rows), 2)
    pending_count = sum(1 for r in referred if not r.get("referral_rewarded_at"))
    scheme = settings.deep_link_scheme or "voxora"
    referrals = [
        {
            "user_id": r["user_id"],
            "name": r.get("name") or "Friend",
            "phone_masked": _mask_phone(r.get("phone")),
            "joined_at": r.get("created_at"),
            "status": "rewarded" if r.get("referral_rewarded_at") else "joined",
        }
        for r in referred
    ]
    return {
        "success": True,
        "code": code,
        "share_url": f"{scheme}://login?ref={code}",
        "referred_count": len(referred),
        "earned_total": earned_total,
        "pending_count": pending_count,
        "referrer_bonus": settings.referral_bonus_referrer,
        "referee_bonus": settings.referral_bonus_referee,
        "can_apply": not bool(fresh.get("referred_by")),
        "referrals": referrals,
    }


async def apply_referral_code(user: dict, raw_code: str) -> dict:
    code = (raw_code or "").strip().upper()
    if len(code) < 4:
        raise HTTPException(400, "Enter a valid referral code")
    db = get_db()
    me = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not me:
        raise HTTPException(404, "User not found")
    if me.get("referred_by"):
        raise HTTPException(400, "A referral code is already applied")
    if (me.get("referral_code") or "").upper() == code:
        raise HTTPException(400, "You can't use your own code")
    referrer = await db.users.find_one({"referral_code": code}, {"_id": 0})
    if not referrer:
        raise HTTPException(404, "Code not found")
    if referrer["user_id"] == user["user_id"]:
        raise HTTPException(400, "You can't use your own code")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"referred_by": referrer["user_id"], "updated_at": datetime.now(timezone.utc)}},
    )
    return {"success": True, "message": "Code applied"}


async def maybe_pay_first_recharge_bonus(user_id: str) -> None:
    """Credit referrer + referee once on the referred user's first successful recharge."""
    db = get_db()
    settings = get_settings()
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user or not user.get("referred_by") or user.get("referral_rewarded_at"):
        return
    referrer_id = user["referred_by"]
    now = datetime.now(timezone.utc)
    claimed = await db.users.find_one_and_update(
        {
            "user_id": user_id,
            "$or": [
                {"referral_rewarded_at": {"$exists": False}},
                {"referral_rewarded_at": None},
            ],
        },
        {"$set": {"referral_rewarded_at": now}},
        return_document=True,
    )
    if not claimed:
        return

    ref_amt = float(settings.referral_bonus_referrer)
    self_amt = float(settings.referral_bonus_referee)
    if ref_amt > 0:
        await wallet_service.credit_balance(referrer_id, ref_amt)
        await wallet_service.insert_transaction(
            user_id=referrer_id,
            tx_type="REFERRAL_BONUS",
            amount=ref_amt,
            description="Referral bonus — friend's first recharge",
            metadata={"from_user_id": user_id},
        )
        wallet = await wallet_service.get_wallet(referrer_id)
        await emit_to_user(
            referrer_id,
            "wallet_updated",
            {"balance": wallet.get("balance", 0), "reason": "referral_bonus"},
        )
    if self_amt > 0:
        await wallet_service.credit_balance(user_id, self_amt)
        await wallet_service.insert_transaction(
            user_id=user_id,
            tx_type="REFERRAL_BONUS",
            amount=self_amt,
            description="Welcome bonus — first recharge",
            metadata={"referrer_id": referrer_id},
        )
