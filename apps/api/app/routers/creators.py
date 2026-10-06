from datetime import datetime, timezone
import random
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import require_creator, require_user
from app.core.socket import emit_to_user
from app.models.schemas import (
    ImageDeleteRequest,
    ImageUploadRequest,
    PricingSetupRequest,
    PushTokenRequest,
    VerificationSubmitRequest,
)
from app.services import presence_service

router = APIRouter(tags=["creators"])


def build_search_text(profile: Optional[dict], user: Optional[dict]) -> str:
    """Denormalized lowercase haystack for backend text search."""
    p = profile or {}
    u = user or {}
    parts = [
        u.get("name") or "",
        u.get("username") or "",
        p.get("bio") or "",
        p.get("category") or "",
        " ".join(p.get("languages") or []),
    ]
    return " ".join(part for part in parts if part).lower()


async def refresh_search_text(db, user_id: str) -> None:
    """Rebuild creator_profiles.search_text after a name/username/bio change."""
    profile = await db.creator_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if not profile:
        return
    u = await db.users.find_one(
        {"user_id": user_id}, {"_id": 0, "name": 1, "username": 1}
    )
    await db.creator_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"search_text": build_search_text(profile, u)}},
    )


async def refresh_creator_rating(db, creator_id: str) -> None:
    """Denormalize avg_rating/review_count onto the profile for fast ranked browse."""
    rows = await db.reviews.aggregate(
        [
            {"$match": {"creator_id": creator_id}},
            {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
        ]
    ).to_list(1)
    if rows:
        await db.creator_profiles.update_one(
            {"user_id": creator_id},
            {"$set": {"avg_rating": round(rows[0]["avg"], 2), "review_count": rows[0]["count"]}},
        )
    else:
        await db.creator_profiles.update_one(
            {"user_id": creator_id}, {"$set": {"avg_rating": None, "review_count": 0}}
        )


async def _batch_ratings(db, creator_ids: list[str]) -> dict[str, dict]:
    if not creator_ids:
        return {}
    rows = await db.reviews.aggregate(
        [
            {"$match": {"creator_id": {"$in": creator_ids}}},
            {
                "$group": {
                    "_id": "$creator_id",
                    "avg": {"$avg": "$rating"},
                    "count": {"$sum": 1},
                }
            },
        ]
    ).to_list(len(creator_ids))
    return {
        row["_id"]: {
            "avg_rating": round(row["avg"], 1),
            "review_count": row["count"],
        }
        for row in rows
    }


@router.get("/creators/filters")
async def browse_filters(user: dict = Depends(require_user)):
    """Filter options for the Home screen."""
    from app.models.schemas import CATEGORIES, GENDERS, LANGUAGES

    return {
        "success": True,
        "genders": GENDERS,
        "languages": LANGUAGES,
        "categories": CATEGORIES,
    }


@router.get("/creators/browse")
async def browse_creators(
    sort: str = Query("recommended"),
    q: str = Query(""),
    status: str = Query("all"),  # all | active
    gender: str = Query(""),
    language: str = Query(""),
    category: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    user: dict = Depends(require_user),
):
    """
    Server-side browse: filtering, search, ranking, and offset pagination.

    Ranking (ACTIVE-first, then the chosen sort):
      1. Not in DND before DND.
      2. Online before offline.
      3. The sort key (rating / price / newest).
      4. user_id as a stable tiebreaker.
    """
    import re

    db = get_db()
    blocked_ids = [
        b["blocked_id"]
        for b in await db.blocks.find({"blocker_id": user["user_id"]}, {"blocked_id": 1}).to_list(500)
    ]

    query: dict = {"is_approved": True, "instant_call_enabled": True}
    if status == "active":
        query["is_online"] = True
        query["is_dnd"] = {"$ne": True}
    if gender:
        query["gender"] = gender
    if language:
        query["languages"] = language
    if category:
        query["category"] = category
    if q.strip():
        query["search_text"] = {"$regex": re.escape(q.strip().lower())}
    exclude = blocked_ids + [user["user_id"]]
    query["user_id"] = {"$nin": exclude}

    sort_map = {
        "recommended": [("is_dnd", 1), ("is_online", -1), ("avg_rating", -1), ("review_count", -1), ("user_id", 1)],
        "rating": [("is_dnd", 1), ("is_online", -1), ("avg_rating", -1), ("review_count", -1), ("user_id", 1)],
        "newest": [("is_dnd", 1), ("is_online", -1), ("created_at", -1), ("user_id", 1)],
        "price_asc": [("is_dnd", 1), ("is_online", -1), ("audio_rate_per_minute", 1), ("user_id", 1)],
        "price_desc": [("is_dnd", 1), ("is_online", -1), ("audio_rate_per_minute", -1), ("user_id", 1)],
    }
    sort_spec = sort_map.get(sort, sort_map["recommended"])

    total = await db.creator_profiles.count_documents(query)
    skip = (page - 1) * limit
    profiles = (
        await db.creator_profiles.find(query, {"_id": 0})
        .sort(sort_spec)
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )

    ids = [p["user_id"] for p in profiles]
    users_list = (
        await db.users.find(
            {"user_id": {"$in": ids}, "deleted": {"$ne": True}},
            {"_id": 0, "user_id": 1, "name": 1, "username": 1, "picture": 1},
        ).to_list(len(ids))
        if ids
        else []
    )
    umap = {u["user_id"]: u for u in users_list}

    # One query to know which of these creators are currently on a call.
    active_calls = (
        await db.call_records.distinct(
            "receiver_id",
            {"receiver_id": {"$in": ids}, "status": {"$in": ["RINGING", "ACCEPTED", "LIVE"]}},
        )
        if ids
        else []
    )
    busy_ids = set(active_calls)

    from app.services import presence_service

    results = []
    for p in profiles:
        u = umap.get(p["user_id"])
        if not u:
            continue
        status_str = presence_service.status_from_profile(
            p, is_online_now=bool(p.get("is_online")), busy=p["user_id"] in busy_ids
        )
        results.append(
            {
                **p,
                "name": u.get("name"),
                "username": u.get("username"),
                "picture": u.get("picture") or (p.get("images") or [None])[0],
                "status": status_str,
                "avg_rating": p.get("avg_rating"),
                "review_count": p.get("review_count", 0),
            }
        )

    has_more = skip + len(results) < total
    return {
        "success": True,
        "creators": results,
        "page": page,
        "limit": limit,
        "total": total,
        "has_more": has_more,
    }


def _onboarding_payload(user: dict, profile: Optional[dict], next_step: str) -> dict:
    profile = profile or {}
    approved = bool(profile.get("is_approved"))
    status = profile.get("verification_status")
    return {
        "success": True,
        "next_step": next_step,
        "verification_status": status,
        "is_approved": approved,
        # True while a creator can use the app but cannot yet receive calls.
        # Drives the "under review" banner on Home.
        "calls_blocked": (user.get("user_type") == "creator") and not approved,
        "gesture_number": profile.get("gesture_number"),
        "images": profile.get("images") or [],
        "verification_selfie_url": profile.get("verification_selfie_url"),
        "name": user.get("name"),
        "username": user.get("username"),
    }


@router.post("/profile/images")
async def add_profile_image(body: ImageUploadRequest, user: dict = Depends(require_creator)):
    from app.services import imagekit_service

    db = get_db()
    profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    images = list((profile or {}).get("images") or [])
    if len(images) >= 6:
        raise HTTPException(400, "You can add up to 6 photos")
    url = await imagekit_service.upload_base64_image(body.image_base64, folder="gallery")
    await db.creator_profiles.update_one(
        {"user_id": user["user_id"]},
        {"$push": {"images": url}},
        upsert=True,
    )
    images.append(url)
    return {"success": True, "image_url": url, "images": images}


@router.delete("/profile/images")
async def delete_profile_image(body: ImageDeleteRequest, user: dict = Depends(require_creator)):
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": user["user_id"]},
        {"$pull": {"images": body.image_url}},
    )
    profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"success": True, "images": (profile or {}).get("images") or []}


@router.post("/profile/verification/start")
async def start_verification(user: dict = Depends(require_creator)):
    db = get_db()
    profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not profile:
        raise HTTPException(404, "Creator profile not found. Complete profile first.")
    if profile.get("is_approved"):
        raise HTTPException(400, "Creator is already verified")
    existing = await db.verification_requests.find_one(
        {"user_id": user["user_id"], "status": "PENDING"},
        {"_id": 0},
    )
    if existing:
        return {
            "success": True,
            "verification_id": existing["verification_id"],
            "gesture_number": existing["gesture_number"],
            "message": "Continue with your verification",
        }
    gesture_number = random.randint(1, 5)
    verification_id = f"ver_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    await db.verification_requests.insert_one(
        {
            "verification_id": verification_id,
            "user_id": user["user_id"],
            "gesture_number": gesture_number,
            "status": "PENDING",
            "created_at": now,
        }
    )
    await db.creator_profiles.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"verification_status": "pending_selfie", "gesture_number": gesture_number}},
    )
    return {
        "success": True,
        "verification_id": verification_id,
        "gesture_number": gesture_number,
        "message": f"Hold up {gesture_number} finger(s) and take a selfie",
    }


@router.post("/profile/verification/selfie")
async def submit_verification_selfie(body: VerificationSubmitRequest, user: dict = Depends(require_creator)):
    """Live camera capture that must show the assigned finger count."""
    from app.services import imagekit_service

    db = get_db()
    request = await db.verification_requests.find_one(
        {
            "verification_id": body.verification_id,
            "user_id": user["user_id"],
            "status": "PENDING",
        },
        {"_id": 0},
    )
    if not request:
        raise HTTPException(400, "Start verification again before submitting a selfie")
    url = await imagekit_service.upload_base64_image(body.image_base64, folder="verification")
    now = datetime.now(timezone.utc)
    await db.verification_requests.update_one(
        {"verification_id": body.verification_id},
        {
            "$set": {
                "status": "SUBMITTED",
                "photo_url": url,
                "submitted_at": now,
            }
        },
    )
    await db.creator_profiles.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {
                "verification_selfie_url": url,
                "gesture_number": request["gesture_number"],
                "verification_status": "pending_review",
                "verification_submitted_at": now,
            }
        },
        upsert=True,
    )
    return {
        "success": True,
        "verification_status": "pending_review",
        "gesture_number": request["gesture_number"],
        "url": url,
    }


@router.get("/profile/onboarding-status")
async def onboarding_status(user: dict = Depends(require_user)):
    """Used by mobile to resume creator onboarding after mid-quit."""
    if not user.get("profile_complete"):
        return _onboarding_payload(user, None, "complete_profile")
    if user.get("user_type") != "creator":
        return _onboarding_payload(user, None, "home")
    db = get_db()
    profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    status = (profile or {}).get("verification_status") or "pending_pricing"
    images = (profile or {}).get("images") or []
    has_selfie = bool((profile or {}).get("verification_selfie_url"))
    if status in ("pending_profile", "pending_pricing") or not (profile or {}).get("audio_rate_per_minute"):
        return _onboarding_payload(user, profile, "pricing_setup")
    if not images:
        return _onboarding_payload(user, profile, "creator_photos")
    if status == "rejected":
        return _onboarding_payload(user, profile, "home")
    if not has_selfie or status in ("pending_photos", "pending_selfie"):
        return _onboarding_payload(user, profile, "verification_selfie")
    if status == "pending_review" or not (profile or {}).get("is_approved"):
        # Reviewed-but-not-yet-decided: let them use the app as a normal user.
        # `is_approved` stays False, so initiate_call still refuses to ring them
        # and the client shows a "verification under review" banner.
        return _onboarding_payload(user, profile, "home")
    return _onboarding_payload(user, profile, "home")


@router.get("/creators/{creator_id}")
async def get_creator(creator_id: str, user: dict = Depends(require_user)):
    db = get_db()
    profile = await db.creator_profiles.find_one({"user_id": creator_id}, {"_id": 0})
    if not profile:
        raise HTTPException(404, "Creator not found")
    u = await db.users.find_one({"user_id": creator_id}, {"_id": 0})
    status = await presence_service.get_creator_status(creator_id, profile)
    following = await db.follows.find_one({"follower_id": user["user_id"], "creator_id": creator_id})
    rating_pipe = await db.reviews.aggregate(
        [
            {"$match": {"creator_id": creator_id}},
            {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
        ]
    ).to_list(1)
    reviews = (
        await db.reviews.find({"creator_id": creator_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(10)
        .to_list(10)
    )
    return {
        "success": True,
        "creator": {
            **profile,
            "name": u.get("name") if u else None,
            "username": u.get("username") if u else None,
            "picture": u.get("picture") if u else None,
            "status": status,
            "is_following": bool(following),
            "avg_rating": round(rating_pipe[0]["avg"], 1) if rating_pipe else None,
            "review_count": rating_pipe[0]["count"] if rating_pipe else 0,
            "recent_reviews": reviews,
        },
    }


@router.get("/creators/{creator_id}/status")
async def creator_status(creator_id: str, user: dict = Depends(require_user)):
    status = await presence_service.get_creator_status(creator_id)
    available, reason = await presence_service.is_creator_available(creator_id)
    return {"success": True, "status": status, "available": available, "reason": reason}


@router.post("/profile/pricing-setup")
async def pricing_setup(body: PricingSetupRequest, user: dict = Depends(require_creator)):
    settings = get_settings()
    audio = float(body.audio_rate_per_minute)
    video = float(body.video_rate_per_minute)
    if audio < settings.min_audio_rate or video < settings.min_video_rate:
        raise HTTPException(
            400,
            f"Minimum audio ₹{settings.min_audio_rate:.0f}/min and video ₹{settings.min_video_rate:.0f}/min",
        )
    db = get_db()
    profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    already_approved = bool(profile and profile.get("is_approved") and profile.get("verification_selfie_url"))
    updates = {
        "audio_rate_per_minute": audio,
        "video_rate_per_minute": video,
        "instant_call_enabled": body.instant_call_enabled,
    }
    if not already_approved:
        updates["verification_status"] = "pending_photos"
    await db.creator_profiles.update_one(
        {"user_id": user["user_id"]},
        {"$set": updates},
        upsert=True,
    )
    return {
        "success": True,
        "audio_rate_per_minute": audio,
        "video_rate_per_minute": video,
        "next_step": "home" if already_approved else "creator_photos",
    }


@router.post("/profile/dnd")
async def toggle_dnd(user: dict = Depends(require_creator)):
    db = get_db()
    profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    new_dnd = not bool(profile and profile.get("is_dnd"))
    result = await presence_service.set_dnd(user["user_id"], new_dnd)
    await emit_to_user(
        user["user_id"],
        "creator_status",
        {"user_id": user["user_id"], "status": result["status"], "is_dnd": new_dnd},
    )
    # When leaving DND, notify followers
    if not new_dnd:
        from app.services import follower_notify_service

        await follower_notify_service.notify_followers_creator_online(
            user["user_id"], reason="dnd_off"
        )
    return {"success": True, **result}


@router.post("/profile/push-token")
async def register_push(body: PushTokenRequest, user: dict = Depends(require_user)):
    db = get_db()
    await db.push_tokens.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {
                "device_push_token": body.device_push_token,
                "platform": body.platform,
                "updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return {"success": True}


@router.post("/follow/{creator_id}")
async def follow(creator_id: str, user: dict = Depends(require_user)):
    db = get_db()
    await db.follows.update_one(
        {"follower_id": user["user_id"], "creator_id": creator_id},
        {"$set": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"success": True}


@router.delete("/follow/{creator_id}")
async def unfollow(creator_id: str, user: dict = Depends(require_user)):
    db = get_db()
    await db.follows.delete_one({"follower_id": user["user_id"], "creator_id": creator_id})
    return {"success": True}


@router.post("/users/{user_id}/block")
async def block_user(user_id: str, user: dict = Depends(require_user)):
    if user_id == user["user_id"]:
        raise HTTPException(400, "Cannot block yourself")
    db = get_db()
    target = await db.users.find_one({"user_id": user_id, "deleted": {"$ne": True}}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(404, "User not found")
    await db.blocks.update_one(
        {"blocker_id": user["user_id"], "blocked_id": user_id},
        {"$set": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"success": True}


@router.get("/following")
async def list_following(user: dict = Depends(require_user)):
    db = get_db()
    follows = await db.follows.find({"follower_id": user["user_id"]}, {"_id": 0}).to_list(200)
    creators = []
    for f in follows:
        profile = await db.creator_profiles.find_one({"user_id": f["creator_id"]}, {"_id": 0})
        u = await db.users.find_one({"user_id": f["creator_id"]}, {"_id": 0})
        if profile and u:
            status = await presence_service.get_creator_status(f["creator_id"], profile)
            creators.append(
                {
                    **profile,
                    "name": u.get("name"),
                    "picture": u.get("picture"),
                    "status": status,
                }
            )
    return {"success": True, "creators": creators}
