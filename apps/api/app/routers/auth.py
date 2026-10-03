from datetime import datetime, timedelta, timezone
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.rate_limit import check_rate_limit
from app.core.security import create_access_token, require_user
from app.models.schemas import (
    CATEGORIES,
    GENDERS,
    LANGUAGES,
    AccountDeletionRequest,
    CompleteProfileRequest,
    SendOtpRequest,
    UpdateProfileRequest,
    VerifyOtpRequest,
)
from app.services import imagekit_service
from app.services import auth_service
from app.core.config import get_settings
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
        verification_id=body.verification_id,
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


@router.get("/check-username")
async def check_username(username: str, user: dict = Depends(require_user)):
    cleaned = (username or "").strip().lower()
    if len(cleaned) < 3 or not re.fullmatch(r"[a-z0-9_-]+", cleaned):
        return {"success": True, "available": False, "reason": "Only letters, numbers, _ and - allowed"}
    db = get_db()
    exists = await db.users.find_one({"username": cleaned, "user_id": {"$ne": user["user_id"]}})
    return {"success": True, "available": not bool(exists)}


@router.post("/complete-profile")
async def complete_profile(body: CompleteProfileRequest, user: dict = Depends(require_user)):
    db = get_db()
    picture = body.picture
    if picture and picture.startswith("data:"):
        picture = await imagekit_service.upload_base64_image(picture, folder="avatars")

    updates = {
        "name": body.name.strip(),
        "picture": picture,
        "user_type": body.user_type.value,
        "profile_complete": True,
        "updated_at": datetime.now(timezone.utc),
    }
    if body.username:
        exists = await db.users.find_one({"username": body.username, "user_id": {"$ne": user["user_id"]}})
        if exists:
            raise HTTPException(409, "Username taken")
        updates["username"] = body.username
    elif body.user_type.value == "creator":
        raise HTTPException(400, "Username must be at least 3 characters")

    if not user.get("referral_code"):
        updates["referral_code"] = await auth_service.generate_referral_code()

    if body.user_type.value == "creator":
        if body.gender not in GENDERS:
            raise HTTPException(400, "Select a gender")
        if body.category not in CATEGORIES:
            raise HTTPException(400, "Select a category")
        languages = body.languages or []
        if not languages or any(lang not in LANGUAGES for lang in languages):
            raise HTTPException(400, "Select at least one language")
        from app.routers.creators import build_search_text

        creator_fields = {
            "bio": (body.bio or "").strip(),
            "gender": body.gender,
            "category": body.category,
            "languages": languages,
            "famous_profile_link": body.famous_profile_link or "",
            "search_text": build_search_text(
                {
                    "bio": (body.bio or "").strip(),
                    "category": body.category,
                    "languages": languages,
                },
                {"name": body.name.strip(), "username": body.username},
            ),
        }
        existing = await db.creator_profiles.find_one({"user_id": user["user_id"]})
        if not existing:
            await db.creator_profiles.insert_one(
                {
                    "user_id": user["user_id"],
                    "images": [],
                    "audio_rate_per_minute": None,
                    "video_rate_per_minute": None,
                    "instant_call_enabled": True,
                    "is_dnd": False,
                    "is_approved": False,
                    "is_online": False,
                    "avg_rating": None,
                    "review_count": 0,
                    "verification_status": "pending_pricing",
                    "created_at": datetime.now(timezone.utc),
                    **creator_fields,
                }
            )
        else:
            await db.creator_profiles.update_one(
                {"user_id": user["user_id"]},
                {"$set": creator_fields},
            )

    if body.referral_code:
        code = body.referral_code.strip().upper()
        if user.get("referred_by"):
            raise HTTPException(400, "You have already used a referral code")
        referrer = await db.users.find_one({"referral_code": code})
        if not referrer:
            raise HTTPException(400, "Invalid referral code")
        if referrer["user_id"] == user["user_id"]:
            raise HTTPException(400, "You cannot use your own referral code")
        updates["referred_by"] = referrer["user_id"]

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if updated.get("user_type") == "creator":
        from app.routers.creators import refresh_search_text

        await refresh_search_text(db, user["user_id"])
    token = create_access_token(updated["user_id"], updated["user_type"])
    return {"success": True, "user": updated, "token": token}


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
        picture = body.picture
        if picture.startswith("data:"):
            picture = await imagekit_service.upload_base64_image(picture, folder="avatars")
        updates["picture"] = picture
    if body.username is not None:
        username = body.username.strip().lower()
        if username:
            exists = await db.users.find_one({"username": username, "user_id": {"$ne": user["user_id"]}})
            if exists:
                raise HTTPException(409, "Username taken")
            updates["username"] = username
    if len(updates) > 1:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})

    # Creator profile fields (bio, category, languages, rates)
    if user.get("user_type") == "creator":
        settings = get_settings()
        cprofile: dict = {}
        if body.bio is not None:
            cprofile["bio"] = body.bio.strip()
        if body.category is not None:
            if body.category not in CATEGORIES:
                raise HTTPException(400, "Select a valid category")
            cprofile["category"] = body.category
        if body.languages is not None:
            if not body.languages or any(lang not in LANGUAGES for lang in body.languages):
                raise HTTPException(400, "Select at least one language")
            cprofile["languages"] = body.languages
        if body.gender is not None and body.gender in GENDERS:
            cprofile["gender"] = body.gender
        if body.famous_profile_link is not None:
            cprofile["famous_profile_link"] = body.famous_profile_link.strip()
        if body.audio_rate_per_minute is not None:
            if body.audio_rate_per_minute < settings.min_audio_rate:
                raise HTTPException(400, f"Minimum audio ₹{settings.min_audio_rate:.0f}/min")
            cprofile["audio_rate_per_minute"] = float(body.audio_rate_per_minute)
        if body.video_rate_per_minute is not None:
            if body.video_rate_per_minute < settings.min_video_rate:
                raise HTTPException(400, f"Minimum video ₹{settings.min_video_rate:.0f}/min")
            cprofile["video_rate_per_minute"] = float(body.video_rate_per_minute)
        if body.instant_call_enabled is not None:
            cprofile["instant_call_enabled"] = body.instant_call_enabled
        if cprofile:
            await db.creator_profiles.update_one(
                {"user_id": user["user_id"]}, {"$set": cprofile}, upsert=True
            )
        from app.routers.creators import refresh_search_text

        await refresh_search_text(db, user["user_id"])

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
