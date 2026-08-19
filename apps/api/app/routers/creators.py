from datetime import datetime, timezone
import json

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import get_settings
from app.core.database import get_db
from app.core.database_redis import get_redis, redis_available
from app.core.security import require_creator, require_user
from app.core.socket import emit_to_user
from app.models.schemas import PricingSetupRequest, PushTokenRequest
from app.services import presence_service

router = APIRouter(tags=["creators"])

BROWSE_CACHE_TTL = 45


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


@router.get("/creators/browse")
async def browse_creators(
    sort: str = Query("popular"),
    q: str = Query(""),
    cursor: str = Query(""),
    limit: int = 20,
    user: dict = Depends(require_user),
):
    """Cursor pagination: cursor is last user_id from previous page."""
    limit = min(max(limit, 1), 50)
    cache_key = f"browse:home:{sort}:{cursor}:{limit}"
    cached_payload = None
    if not q:
        r = get_redis()
        if r and redis_available():
            try:
                cached = await r.get(cache_key)
                if cached:
                    cached_payload = json.loads(cached)
            except Exception:
                pass

    db = get_db()
    blocked_ids = set()
    blocked = await db.blocks.find({"blocker_id": user["user_id"]}, {"blocked_id": 1}).to_list(500)
    blocked_ids = {b["blocked_id"] for b in blocked}

    if cached_payload:
        creators = [
            c for c in (cached_payload.get("creators") or []) if c.get("user_id") not in blocked_ids
        ]
        return {**cached_payload, "creators": creators}

    query: dict = {"is_approved": True, "instant_call_enabled": True}
    if cursor:
        query["user_id"] = {"$gt": cursor}

    # Fetch a window; status sort applied after enrichment for ACTIVE-first
    profiles = await db.creator_profiles.find(query, {"_id": 0}).sort("user_id", 1).limit(limit * 3).to_list(limit * 3)
    results = []
    for p in profiles:
        if p["user_id"] in blocked_ids:
            continue
        u = await db.users.find_one({"user_id": p["user_id"], "deleted": {"$ne": True}}, {"_id": 0})
        if not u:
            continue
        if q and q.lower() not in (u.get("name") or "").lower() and q.lower() not in (u.get("username") or "").lower():
            continue
        status = await presence_service.get_creator_status(p["user_id"], p)
        results.append(
            {
                **{k: v for k, v in p.items()},
                "name": u.get("name"),
                "username": u.get("username"),
                "picture": u.get("picture") or (p.get("images") or [None])[0],
                "status": status,
            }
        )

    if sort == "price_asc":
        results.sort(key=lambda x: x.get("audio_rate_per_minute") or 999)
    elif sort == "price_desc":
        results.sort(key=lambda x: x.get("audio_rate_per_minute") or 0, reverse=True)
    else:
        order = {"ACTIVE": 0, "BUSY": 1, "OFFLINE": 2, "DND": 3}
        results.sort(key=lambda x: (order.get(x.get("status"), 9), x.get("user_id") or ""))

    page = results[:limit]
    ratings = await _batch_ratings(db, [c["user_id"] for c in page])
    for item in page:
        rstats = ratings.get(item["user_id"], {})
        item["avg_rating"] = rstats.get("avg_rating")
        item["review_count"] = rstats.get("review_count", 0)

    next_cursor = page[-1]["user_id"] if len(page) == limit else None
    response = {"success": True, "creators": page, "next_cursor": next_cursor, "has_more": bool(next_cursor)}

    if not q:
        r = get_redis()
        if r and redis_available():
            try:
                await r.setex(cache_key, BROWSE_CACHE_TTL, json.dumps(response, default=str))
            except Exception:
                pass

    return response


@router.post("/profile/verification/selfie")
async def submit_verification_selfie(body: dict, user: dict = Depends(require_creator)):
    """Body: { image_base64: data-url or https url } from live camera capture."""
    from app.services import imagekit_service

    image = body.get("image_base64") or body.get("image_url") or ""
    if not image:
        raise HTTPException(400, "image_base64 required")
    url = await imagekit_service.upload_base64_image(image, folder="verification")
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {
                "verification_selfie_url": url,
                "verification_status": "pending_review",
                "verification_submitted_at": datetime.now(timezone.utc),
            },
            "$addToSet": {"images": url},
        },
        upsert=True,
    )
    return {"success": True, "verification_status": "pending_review", "url": url}


@router.get("/profile/onboarding-status")
async def onboarding_status(user: dict = Depends(require_user)):
    """Used by mobile to resume creator onboarding after mid-quit."""
    if user.get("user_type") != "creator":
        return {"success": True, "next_step": "home", "verification_status": None}
    if not user.get("profile_complete"):
        return {"success": True, "next_step": "complete_profile", "verification_status": None}
    db = get_db()
    profile = await db.creator_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    status = (profile or {}).get("verification_status") or "pending_pricing"
    if status in ("pending_profile", "pending_pricing") or not (profile or {}).get("audio_rate_per_minute"):
        return {"success": True, "next_step": "pricing_setup", "verification_status": status}
    if status == "pending_photos" or not (profile or {}).get("verification_selfie_url"):
        return {"success": True, "next_step": "verification_selfie", "verification_status": status}
    if status in ("pending_review", "rejected") or not (profile or {}).get("is_approved"):
        return {"success": True, "next_step": "pending_approval", "verification_status": status}
    return {"success": True, "next_step": "home", "verification_status": status}


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
    audio = max(float(body.audio_rate_per_minute), settings.min_audio_rate)
    video = max(float(body.video_rate_per_minute), settings.min_video_rate)
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {
                "audio_rate_per_minute": audio,
                "video_rate_per_minute": video,
                "instant_call_enabled": body.instant_call_enabled,
                "verification_status": "pending_photos",
            }
        },
        upsert=True,
    )
    return {
        "success": True,
        "audio_rate_per_minute": audio,
        "video_rate_per_minute": video,
        "next_step": "verification_selfie",
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


@router.post("/profile/images")
async def add_image(url: str, user: dict = Depends(require_creator)):
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": user["user_id"]},
        {"$push": {"images": url}},
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
