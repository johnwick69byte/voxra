from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.rate_limit import check_rate_limit
from app.core.security import require_user
from app.models.schemas import (
    AccountDeletionRequest,
    CompleteProfileRequest,
    SendOtpRequest,
    UpdateProfileRequest,
    VerifyOtpRequest,
)
from app.services import auth_service
from app.core.database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/otp/send")
async def send_otp(body: SendOtpRequest):
    phone_key = f"{body.country_code}{body.phone}".replace(" ", "")
    allowed = await check_rate_limit(f"otp:send:{phone_key}", limit=5, window_seconds=600)
    if not allowed:
        raise HTTPException(429, "Too many OTP requests. Try again later.")
    result = await auth_service.send_otp(body.country_code, body.phone)
    if not result.get("success"):
        raise HTTPException(502, result.get("message", "Could not send OTP"))
    return result


@router.post("/otp/verify")
async def verify_otp(body: VerifyOtpRequest):
    phone_key = f"{body.country_code}{body.phone}".replace(" ", "")
    allowed = await check_rate_limit(f"otp:verify:{phone_key}", limit=10, window_seconds=600)
    if not allowed:
        raise HTTPException(429, "Too many OTP attempts. Try again later.")
    result = await auth_service.verify_otp(
        body.country_code,
        body.phone,
        body.otp,
        user_type=body.user_type.value if body.user_type else None,
    )
    if not result.get("success"):
        raise HTTPException(400, result.get("message", "Invalid OTP"))
    return result


@router.get("/me")
async def me(user: dict = Depends(require_user)):
    db = get_db()
    profile = None
    if user.get("user_type") == "creator":
        profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    wallet = await db.wallets.find_one({"user_id": user["user_id"]}, {"_id": 0})
    from app.services import referral_service

    if not user.get("referral_code"):
        code = await referral_service.ensure_referral_code(user)
        user = {**user, "referral_code": code}
    return {"success": True, "user": user, "creator_profile": profile, "wallet": wallet}


@router.post("/complete-profile")
async def complete_profile(body: CompleteProfileRequest, user: dict = Depends(require_user)):
    db = get_db()
    updates = {
        "name": body.name.strip(),
        "picture": body.picture,
        "user_type": body.user_type.value,
        "profile_complete": True,
        "updated_at": datetime.now(timezone.utc),
    }
    if body.username:
        username = body.username.strip().lower()
        exists = await db.users.find_one({"username": username, "user_id": {"$ne": user["user_id"]}})
        if exists:
            raise HTTPException(409, "Username taken")
        updates["username"] = username

    if not user.get("referral_code"):
        updates["referral_code"] = await auth_service.generate_referral_code()

    if body.user_type.value == "creator":
        existing = await db.creator_profiles.find_one({"user_id": user["user_id"]})
        if not existing:
            await db.creator_profiles.insert_one(
                {
                    "user_id": user["user_id"],
                    "bio": body.bio or "",
                    "images": [],
                    "audio_rate_per_minute": None,
                    "video_rate_per_minute": None,
                    "instant_call_enabled": True,
                    "is_dnd": False,
                    "is_approved": False,
                    "verification_status": "pending_pricing",
                    "created_at": datetime.now(timezone.utc),
                }
            )
        else:
            await db.creator_profiles.update_one(
                {"user_id": user["user_id"]},
                {"$set": {"bio": body.bio or ""}},
            )

    if body.referral_code:
        referrer = await db.users.find_one({"referral_code": body.referral_code.upper()})
        if referrer and referrer["user_id"] != user["user_id"]:
            updates["referred_by"] = referrer["user_id"]

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"success": True, "user": updated}


@router.post("/update-profile")
async def update_profile(body: UpdateProfileRequest, user: dict = Depends(require_user)):
    db = get_db()
    updates: dict = {"updated_at": datetime.now(timezone.utc)}
    if body.name is not None:
        name = body.name.strip()
        if len(name) < 2:
            raise HTTPException(400, "Name must be at least 2 characters")
        updates["name"] = name
    if body.picture is not None:
        updates["picture"] = body.picture
    if body.username is not None:
        username = body.username.strip().lower()
        if username:
            exists = await db.users.find_one({"username": username, "user_id": {"$ne": user["user_id"]}})
            if exists:
                raise HTTPException(409, "Username taken")
            updates["username"] = username
    if body.bio is not None and user.get("user_type") == "creator":
        await db.creator_profiles.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"bio": body.bio.strip()}},
            upsert=True,
        )
    if len(updates) > 1:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    profile = None
    if updated and updated.get("user_type") == "creator":
        profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"success": True, "user": updated, "creator_profile": profile}


_DELETION_ACK = (
    "If the provided information matches an account, a deletion request will be processed within 7 days."
)


@router.post("/request-account-deletion")
async def request_account_deletion(body: AccountDeletionRequest, request: Request):
    """Public Play-style deletion request. Does not reveal whether an account exists."""
    ip = request.client.host if request.client else "unknown"
    allowed = await check_rate_limit(f"delete-req:{ip}", limit=8, window_seconds=3600)
    if not allowed:
        raise HTTPException(429, "Too many deletion requests. Try again later.")

    ack = {"success": True, "message": _DELETION_ACK}
    db = get_db()
    phone = body.phone_number
    user = await db.users.find_one(
        {"phone": {"$in": [f"+91{phone}", phone, f"91{phone}"]}},
        {"_id": 0},
    )
    if not user or user.get("deleted"):
        return ack
    if (user.get("name") or "").strip().lower() != body.name.strip().lower():
        return ack

    if user.get("user_type") == "creator":
        profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
        if profile:
            if body.audio_rate_per_minute is not None:
                stored = float(profile.get("audio_rate_per_minute") or 0)
                if abs(stored - float(body.audio_rate_per_minute)) > 0.01:
                    return ack
            if body.video_rate_per_minute is not None:
                stored = float(profile.get("video_rate_per_minute") or 0)
                if abs(stored - float(body.video_rate_per_minute)) > 0.01:
                    return ack

    request_id = f"del_req_{uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    await db.account_deletion_requests.insert_one(
        {
            "request_id": request_id,
            "user_id": user["user_id"],
            "phone_number": phone,
            "name": body.name.strip(),
            "audio_rate_per_minute": body.audio_rate_per_minute,
            "video_rate_per_minute": body.video_rate_per_minute,
            "social_profile_link": (body.social_profile_link or "").strip(),
            "status": "PENDING",
            "created_at": now,
            "scheduled_deletion_date": now + timedelta(days=7),
        }
    )
    return {
        "success": True,
        "message": (
            "Account deletion request submitted successfully. We will verify your details "
            "and process the deletion within 7 days if all information matches."
        ),
        "request_id": request_id,
    }


@router.post("/delete-account")
async def delete_account(user: dict = Depends(require_user)):
    db = get_db()
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"is_suspended": True, "deleted": True, "phone": f"deleted_{user['user_id']}"}},
    )
    return {"success": True, "message": "Account scheduled for deletion"}
