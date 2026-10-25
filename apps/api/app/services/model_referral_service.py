"""Model Referral Service - handles model-to-model referrals and bonuses."""

from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from fastapi import HTTPException
from collections import defaultdict

from app.core.config import get_settings
from app.core.database import get_db
from app.core.socket import emit_to_user
from app.services import wallet_service, auth_service
from app.theme.brand import APP_NAME, APP_SCHEME
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) >= 4:
        return f"+91******{digits[-4:]}"
    return "Hidden"


async def ensure_model_referral_code(user: dict) -> str:
    """Generate model referral code for creator if not exists."""
    code = (user.get("model_referral_code") or "").strip().upper()
    if code:
        return code
    
    db = get_db()
    code = await auth_service.generate_referral_code(prefix="MDL")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"model_referral_code": code}}
    )
    return code


async def get_model_referral_overview(user: dict) -> dict:
    """Get model referral overview for a creator."""
    db = get_db()
    settings = get_settings()
    
    # Ensure referral code exists
    code = await ensure_model_referral_code(user)
    
    # Get referred models
    referred = await db.users.find(
        {"model_referred_by": user["user_id"]},
        {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "created_at": 1, "model_referral_rewarded_at": 1}
    ).sort("created_at", -1).to_list(200)
    
    # Get earnings from model referral bonuses
    earned_rows = await db.transactions.find(
        {"user_id": user["user_id"], "type": "MODEL_REFERRAL_BONUS"},
        {"_id": 0, "amount": 1, "created_at": 1, "metadata": 1}
    ).sort("created_at", -1).to_list(200)
    
    earned_total = round(sum(float(r.get("amount") or 0) for r in earned_rows), 2)
    
    # Calculate pending (referred models who haven't withdrawn yet)
    pending_count = 0
    referred_details = []
    for r in referred:
        has_withdrawn = r.get("model_referral_rewarded_at") is not None
        total_withdrawals = r.get("total_withdrawals", 0.0)
        total_earned = r.get("total_bonus_from_them", 0.0)
        
        if not has_withdrawn:
            pending_count += 1
        
        referred_details.append({
            "user_id": r["user_id"],
            "name": r.get("name") or "Model",
            "phone_masked": _mask_phone(r.get("phone")),
            "joined_at": r.get("created_at"),
            "status": "active" if has_withdrawn else "pending",
            "total_withdrawals": total_withdrawals,
            "total_earned_from_them": total_earned,
        })
    
    # This month earnings
    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    this_month_rows = [r for r in earned_rows if r.get("created_at", datetime.min) >= month_start]
    this_month_earnings = round(sum(float(r.get("amount") or 0) for r in this_month_rows), 2)
    
    # Last 30 days
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    last_30_rows = [r for r in earned_rows if r.get("created_at", datetime.min) >= thirty_days_ago]
    last_30_earnings = round(sum(float(r.get("amount") or 0) for r in last_30_rows), 2)
    
    scheme = settings.deep_link_scheme or "simpletalk"
    share_url = f"{scheme}://login?model_ref={code}"
    
    return {
        "success": True,
        "code": code,
        "share_url": share_url,
        "referred_count": len(referred),
        "earned_total": earned_total,
        "this_month_earnings": this_month_earnings,
        "last_30_days_earnings": last_30_earnings,
        "pending_count": pending_count,
        "referrer_bonus_percentage": settings.model_referral_bonus_percentage,
        "minimum_withdrawal": settings.model_referral_min_withdrawal,
        "referrals": referred_details,
        "earnings_history": [
            {
                "date": r.get("created_at"),
                "amount": r.get("amount"),
                "referred_model": r.get("metadata", {}).get("referred_model_name", "Model"),
                "withdrawal_amount": r.get("metadata", {}).get("withdrawal_amount", 0),
            }
            for r in earned_rows[:50]
        ],
        "share_message": _build_share_message(code, share_url),
    )


async def apply_model_referral_code(user: dict, raw_code: str) -> dict:
    """Apply a model referral code during/after signup."""
    code = (raw_code or "").strip().upper()
    if len(code) < 4:
        raise HTTPException(400, "Enter a valid model referral code")
    
    db = get_db()
    me = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not me:
        raise HTTPException(404, "User not found")
    
    # Only creators can use model referral codes
    if user.get("user_type") != "creator":
        raise HTTPException(403, "Only creators can use model referral codes")
    
    if me.get("model_referred_by"):
        raise HTTPException(400, "A model referral code is already applied")
    
    if (user.get("model_referral_code") or "").upper() == code:
        raise HTTPException(400, "You can't use your own code")
    
    referrer = await db.users.find_one(
        {"model_referral_code": code, "user_type": "creator", "is_approved": True},
        {"_id": 0}
    )
    if not referrer:
        raise HTTPException(404, "Invalid or inactive model referral code")
    
    if referrer["user_id"] == user["user_id"]:
        raise HTTPException(400, "You can't use your own code")
    
    # Check for circular referrals (A -> B -> A)
    if referrer.get("model_referred_by") == user["user_id"]:
        raise HTTPException(400, "Circular referral not allowed")
    
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"model_referred_by": referrer["user_id"], "updated_at": datetime.now(timezone.utc)}}
    )
    
    # Add to referrer's model_referrals array
    await db.users.update_one(
        {"user_id": referrer["user_id"]},
        {"$push": {
            "model_referrals": {
                "user_id": user["user_id"],
                "name": user.get("name") or "Model",
                "joined_at": datetime.now(timezone.utc),
                "total_withdrawals": 0.0,
                "total_bonus_from_them": 0.0,
                "status": "pending"
            }
        }}
    )
    
    return {"success": True, "message": "Model referral code applied"}


async def process_model_referral_bonus(withdrawal_user_id: str, withdrawal_amount: float) -> bool:
    """Process model referral bonus when a model makes a withdrawal."""
    settings = get_settings()
    db = get_db()
    
    if withdrawal_amount < settings.model_referral_min_withdrawal:
        return False
    
    user = await db.users.find_one({"user_id": withdrawal_user_id}, {"_id": 0})
    if not user or not user.get("model_referred_by") or user.get("model_referral_rewarded_at"):
        return False
    
    referrer_id = user["model_referred_by"]
    if not referrer_id:
        return False
    
    # Check if already rewarded for this withdrawal (prevent double counting)
    # We track by checking if the model has a recent withdrawal that was already rewarded
    # For simplicity, we track the last rewarded amount
    
    now = datetime.now(timezone.utc)
    bonus_percentage = settings.model_referral_bonus_percentage / 100.0
    bonus_amount = round(withdrawal_amount * (settings.model_referral_bonus_percentage / 100.0), 2)
    
    if bonus_amount <= 0:
        return False
    
    # Credit referrer's earning wallet
    await wallet_service.credit_earnings(referrer_id, bonus_amount)
    
    # Record transaction
    await db.transactions.insert_one({
        "transaction_id": f"txn_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
        "user_id": referrer_id,
        "type": "MODEL_REFERRAL_BONUS",
        "amount": bonus_amount,
        "status": "SUCCESS",
        "description": f"Model referral bonus - from model's ₹{withdrawal_amount:,.2f} withdrawal",
        "metadata": {
            "referred_user_id": user.get("user_id"),
            "referred_model_name": user.get("name", "Model"),
            "withdrawal_amount": withdrawal_amount,
            "bonus_percentage": settings.model_referral_bonus_percentage,
            "bonus_amount": bonus_amount,
        },
        "created_at": datetime.now(timezone.utc),
    })
    
    # Update referrer's stats
    await db.users.update_one(
        {"user_id": referrer_id},
        {
            "$inc": {
                "model_referral_earnings": bonus_amount,
            },
            "$set": {
                "model_referral_rewarded_at": datetime.now(timezone.utc),
            },
            "$inc": {
                "model_referrals.$[elem].total_bonus_from_them": bonus_amount,
                "model_referrals.$[elem].total_withdrawals": 1,
            },
            "$set": {
                "model_referrals.$[elem].status": "active",
            }
        },
        array_filters=[{"elem.user_id": user["user_id"]}],
    )
    
    # Update referred user's rewarded timestamp
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"model_referral_rewarded_at": datetime.now(timezone.utc)}}
    )
    
    # Notify referrer
    wallet = await wallet_service.get_wallet(referrer_id)
    await emit_to_user(
        referrer_id,
        "wallet_updated",
        {"balance": wallet.get("balance", 0), "reason": "model_referral_bonus"}
    )
    await emit_to_user(
        referrer_id,
        "new_notification",
        {
            "title": "Model Referral Bonus!",
            "body": f"You earned ₹{bonus_amount:.2f} from your referred model's withdrawal",
            "type": "model_referral_bonus",
        }
    )
    
    return True





async def get_model_referral_earnings(user: dict) -> dict:
    """Get detailed earnings from model referrals."""
    db = get_db()
    settings = get_settings()
    
    earned_rows = await db.transactions.find(
        {"user_id": user["user_id"], "type": "MODEL_REFERRAL_BONUS"},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    
    total_earned = round(sum(float(r.get("amount") or 0) for r in earned_rows), 2)
    
    # Group by month
    from collections import defaultdict
    monthly = defaultdict(float)
    for r in earned_rows:
        dt = r.get("created_at")
        if dt:
            key = dt.strftime("%Y-%m")
            monthly[key] += float(r.get("amount") or 0)
    
    return {
        "success": True,
        "total_earned": total_earned,
        "monthly_breakdown": [
            {"month": k, "amount": round(v, 2)} for k, v in sorted(monthly.items(), reverse=True)
        ],
        "transactions": [
            {
                "date": r.get("created_at"),
                "amount": r.get("amount"),
                "referred_model": r.get("metadata", {}).get("referred_model_name"),
                "withdrawal_amount": r.get("metadata", {}).get("withdrawal_amount", 0),
                "bonus_percentage": r.get("metadata", {}).get("bonus_percentage", 5),
            }
            for r in earned_rows[:100]
        ],
        "referrer_bonus_percentage": settings.model_referral_bonus_percentage,
    }


async def get_model_referrals_list(user: dict) -> dict:
    """Get list of referred models with their details."""
    db = get_db()
    
    user_doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "model_referrals": 1})
    referrals = user_doc.get("model_referrals", []) if user_doc else []
    
    # Enrich with latest data
    enriched = []
    for ref in referrals:
        ref_user = await db.users.find_one({"user_id": ref["user_id"]}, {"_id": 0})
        if ref_user:
            enriched.append({
                "user_id": ref["user_id"],
                "name": ref_user.get("name") or "Model",
                "phone_masked": _mask_phone(ref_user.get("phone")),
                "joined_at": ref.get("joined_at"),
                "status": ref.get("status", "pending"),
                "total_withdrawals": ref.get("total_withdrawals", 0.0),
                "total_bonus_from_them": ref.get("total_bonus_from_them", 0.0),
            })
    
    return {"success": True, "referrals": enriched}


def _build_share_message(code: str, share_url: str) -> str:
    return (
        f"🌟 Join {APP_NAME} as a Creator!\n\n"
        f"I've earned from referring models. You can too!\n\n"
        f"🎁 Your Benefits:\n"
        f"✅ ₹20 welcome bonus on first recharge\n"
        f"✅ 5% lifetime referral bonus on your withdrawals (to your referrer)\n"
        f"✅ Full control over your rates & schedule\n"
        f"✅ Weekly payouts to UPI/Bank\n\n"
        f"📋 How to join:\n"
        f"1️⃣ Download {APP_NAME}\n"
        f"2️⃣ Sign up as \"Creator\"\n"
        f"3️⃣ Enter my code: {code}\n"
        f"4️⃣ Complete verification\n"
        f"4️⃣ Set your rates & go live!\n\n"
        f"🔗 {share_url}\n\n"
        f"#SimpleTalk #CreatorEconomy #WorkFromHome"