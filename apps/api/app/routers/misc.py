from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.core.database import get_db
from app.core.security import require_creator, require_user
from app.core.config import get_settings
from app.models.schemas import (
    ApplyReferralRequest,
    AgoraTokenRequest,
    BlockUserRequest,
    FavoriteRequest,
    ModerationCallReport,
    ReportUserRequest,
    SupportMessageRequest,
)
from app.services import agora_service, referral_service

router = APIRouter(tags=["misc"])


@router.get("/profile/referral")
async def referral_overview(user: dict = Depends(require_user)):
    return await referral_service.get_referral_overview(user)


@router.post("/profile/referral/apply")
async def referral_apply(body: ApplyReferralRequest, user: dict = Depends(require_user)):
    return await referral_service.apply_referral_code(user, body.code)


@router.get("/healthz")
async def healthz():
    return {"ok": True, "service": "simpletalk-api"}


@router.get("/app/config")
async def app_config():
    settings = get_settings()
    return {
        "success": True,
        "min_version_android": settings.app_min_version_android,
        "min_version_ios": settings.app_min_version_ios,
        "deep_link_scheme": settings.deep_link_scheme,
        "commission_rate": settings.commission_rate,
        "ring_timeout_seconds": settings.call_ring_timeout_seconds,
        "play_store_url": "https://play.google.com/store/apps/details?id=com.simple_talk.app",
        "app_store_url": "https://apps.apple.com/app/id0000000000",
    }


@router.post("/agora/token")
async def agora_token(body: AgoraTokenRequest, user: dict = Depends(require_user)):
    return {"success": True, **agora_service.build_rtc_token(body.channel_name, uid=body.uid)}


# ── Favorites ────────────────────────────────────────────────────────────────

@router.post("/favorites/add")
async def favorite_add(body: FavoriteRequest, user: dict = Depends(require_user)):
    db = get_db()
    await db.favorites.update_one(
        {"user_id": user["user_id"], "creator_id": body.model_id},
        {"$set": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"success": True}


@router.post("/favorites/remove")
async def favorite_remove(body: FavoriteRequest, user: dict = Depends(require_user)):
    db = get_db()
    await db.favorites.delete_one({"user_id": user["user_id"], "creator_id": body.model_id})
    return {"success": True}


@router.get("/favorites")
async def favorites_list(user: dict = Depends(require_user)):
    db = get_db()
    favs = await db.favorites.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    ids = [f["creator_id"] for f in favs]
    if not ids:
        return {"success": True, "models": []}
    users = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0}).to_list(100)
    profiles = await db.creator_profiles.find(
        {"user_id": {"$in": ids}, "is_approved": True}, {"_id": 0}
    ).to_list(100)
    pmap = {p["user_id"]: p for p in profiles}
    from app.services import presence_service

    models = []
    for u in users:
        p = pmap.get(u["user_id"])
        if not p:
            continue
        models.append(
            {**u, "model_profile": p, "status": await presence_service.get_creator_status(u["user_id"], p)}
        )
    return {"success": True, "models": models}


@router.get("/favorites/check/{model_id}")
async def favorite_check(model_id: str, user: dict = Depends(require_user)):
    db = get_db()
    fav = await db.favorites.find_one({"user_id": user["user_id"], "creator_id": model_id})
    return {"success": True, "is_favorite": fav is not None}


# ── Moderation ───────────────────────────────────────────────────────────────

@router.post("/report-user")
async def report_user(body: ReportUserRequest, user: dict = Depends(require_user)):
    if body.reported_user_id == user["user_id"]:
        raise HTTPException(400, "Cannot report yourself")
    db = get_db()
    await db.reports.insert_one(
        {
            "report_id": f"rpt_{uuid.uuid4().hex[:12]}",
            "reporter_id": user["user_id"],
            "reported_id": body.reported_user_id,
            "reason": body.reason,
            "created_at": datetime.now(timezone.utc),
        }
    )
    return {"success": True}


@router.post("/report-call")
async def report_call(body: ModerationCallReport, user: dict = Depends(require_user)):
    db = get_db()
    call = await db.call_records.find_one({"call_id": body.call_id}, {"_id": 0})
    if not call or user["user_id"] not in (call["caller_id"], call["receiver_id"]):
        raise HTTPException(403, "Not allowed")
    reported = body.reported_user_id or (
        call["receiver_id"] if user["user_id"] == call["caller_id"] else call["caller_id"]
    )
    await db.reports.insert_one(
        {
            "report_id": f"rpt_{uuid.uuid4().hex[:12]}",
            "call_id": body.call_id,
            "reporter_id": user["user_id"],
            "reported_id": reported,
            "reason": body.reason or "abuse",
            "created_at": datetime.now(timezone.utc),
        }
    )
    return {"success": True}


@router.post("/block-user")
async def block_user(body: BlockUserRequest, user: dict = Depends(require_user)):
    if body.blocked_user_id == user["user_id"]:
        raise HTTPException(400, "Cannot block yourself")
    db = get_db()
    target = await db.users.find_one({"user_id": body.blocked_user_id, "deleted": {"$ne": True}}, {"_id": 0, "user_id": 1})
    if not target:
        raise HTTPException(404, "User not found")
    await db.blocks.update_one(
        {"blocker_id": user["user_id"], "blocked_id": body.blocked_user_id},
        {"$set": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"success": True}


@router.post("/unblock-user")
async def unblock_user(body: BlockUserRequest, user: dict = Depends(require_user)):
    db = get_db()
    await db.blocks.delete_one({"blocker_id": user["user_id"], "blocked_id": body.blocked_user_id})
    return {"success": True}


@router.get("/blocked-users")
async def blocked_users(user: dict = Depends(require_user)):
    db = get_db()
    rows = await db.blocks.find({"blocker_id": user["user_id"]}, {"_id": 0}).to_list(200)
    ids = [r["blocked_id"] for r in rows]
    users = (
        await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "picture": 1}).to_list(200)
        if ids
        else []
    )
    return {"success": True, "blocked_users": users}


# ── Follow status / followers ────────────────────────────────────────────────

@router.get("/follow/status/{creator_id}")
async def follow_status(creator_id: str, user: dict = Depends(require_user)):
    db = get_db()
    following = await db.follows.find_one({"follower_id": user["user_id"], "creator_id": creator_id})
    return {"success": True, "is_following": following is not None}


@router.get("/follow/followers")
async def follow_followers(user: dict = Depends(require_creator)):
    db = get_db()
    rows = await db.follows.find({"creator_id": user["user_id"]}, {"_id": 0}).to_list(2000)
    ids = [r["follower_id"] for r in rows]
    followers = (
        await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "picture": 1}).to_list(2000)
        if ids
        else []
    )
    return {"success": True, "followers": followers, "count": len(followers)}


@router.get("/follow/following")
async def follow_following(user: dict = Depends(require_user)):
    db = get_db()
    rows = await db.follows.find({"follower_id": user["user_id"]}, {"_id": 0}).to_list(2000)
    ids = [r["creator_id"] for r in rows]
    users = (
        await db.users.find({"user_id": {"$in": ids}}, {"_id": 0}).to_list(2000) if ids else []
    )
    profiles = (
        await db.creator_profiles.find({"user_id": {"$in": ids}}, {"_id": 0}).to_list(2000) if ids else []
    )
    pmap = {p["user_id"]: p for p in profiles}
    from app.services import presence_service

    models = []
    for u in users:
        p = pmap.get(u["user_id"])
        if not p:
            continue
        models.append(
            {**u, "model_profile": p, "status": await presence_service.get_creator_status(u["user_id"], p)}
        )
    return {"success": True, "models": models, "count": len(models)}


# ── Reviews ──────────────────────────────────────────────────────────────────

@router.get("/models/{model_id}/reviews")
async def model_reviews(model_id: str, limit: int = 50, skip: int = 0):
    db = get_db()
    limit = min(max(limit, 1), 100)
    reviews = (
        await db.reviews.find({"creator_id": model_id}, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )
    ids = list({r.get("user_id") for r in reviews if r.get("user_id")})
    users = (
        await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "picture": 1}).to_list(len(ids))
        if ids
        else []
    )
    umap = {u["user_id"]: u for u in users}
    result = []
    for r in reviews:
        reviewer = umap.get(r.get("user_id"))
        result.append(
            {
                **r,
                "reviewer_name": (reviewer or {}).get("name") or "Anonymous",
                "reviewer_picture": (reviewer or {}).get("picture"),
            }
        )
    return {"success": True, "reviews": result}


@router.get("/models/{model_id}/reviews/stats")
async def model_review_stats(model_id: str):
    db = get_db()
    agg = await db.reviews.aggregate(
        [
            {"$match": {"creator_id": model_id}},
            {
                "$group": {
                    "_id": None,
                    "total_reviews": {"$sum": 1},
                    "total_rating": {"$sum": "$rating"},
                    "r1": {"$sum": {"$cond": [{"$eq": ["$rating", 1]}, 1, 0]}},
                    "r2": {"$sum": {"$cond": [{"$eq": ["$rating", 2]}, 1, 0]}},
                    "r3": {"$sum": {"$cond": [{"$eq": ["$rating", 3]}, 1, 0]}},
                    "r4": {"$sum": {"$cond": [{"$eq": ["$rating", 4]}, 1, 0]}},
                    "r5": {"$sum": {"$cond": [{"$eq": ["$rating", 5]}, 1, 0]}},
                }
            },
        ]
    ).to_list(1)
    if not agg:
        return {
            "success": True,
            "average_rating": 0,
            "total_reviews": 0,
            "rating_distribution": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0},
        }
    row = agg[0]
    total = row["total_reviews"]
    return {
        "success": True,
        "average_rating": round(row["total_rating"] / total, 2) if total else 0,
        "total_reviews": total,
        "rating_distribution": {
            "1": row["r1"],
            "2": row["r2"],
            "3": row["r3"],
            "4": row["r4"],
            "5": row["r5"],
        },
    }


@router.get("/notifications")
async def list_notifications(user: dict = Depends(require_user)):
    db = get_db()
    items = (
        await db.notifications.find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
        .to_list(50)
    )
    return {"success": True, "notifications": items}


@router.get("/notifications/unread-count")
async def notifications_unread_count(user: dict = Depends(require_user)):
    db = get_db()
    count = await db.notifications.count_documents(
        {"user_id": user["user_id"], "read": {"$ne": True}}
    )
    return {"success": True, "unread_count": count}


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user: dict = Depends(require_user)):
    db = get_db()
    await db.notifications.update_one(
        {"user_id": user["user_id"], "notification_id": notification_id},
        {"$set": {"read": True}},
    )
    return {"success": True}


@router.delete("/notifications/{notification_id}")
async def delete_notification(notification_id: str, user: dict = Depends(require_user)):
    db = get_db()
    await db.notifications.delete_one(
        {"user_id": user["user_id"], "notification_id": notification_id}
    )
    return {"success": True}


@router.post("/notifications/read-all")
async def read_all(user: dict = Depends(require_user)):
    db = get_db()
    await db.notifications.update_many(
        {"user_id": user["user_id"]}, {"$set": {"read": True}}
    )
    return {"success": True}


@router.post("/support/message")
async def support_message(body: SupportMessageRequest, user: dict = Depends(require_user)):
    db = get_db()
    msg_id = f"sup_{uuid.uuid4().hex[:10]}"
    await db.support_messages.insert_one(
        {
            "message_id": msg_id,
            "user_id": user["user_id"],
            "subject": body.subject,
            "message": body.message,
            "status": "open",
            "created_at": datetime.now(timezone.utc),
        }
    )
    return {"success": True, "message_id": msg_id}


@router.get("/support/messages")
async def my_support_messages(user: dict = Depends(require_user)):
    db = get_db()
    items = (
        await db.support_messages.find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(100)
    )
    return {"success": True, "messages": items}


@router.get("/privacy")
async def privacy():
    return {
        "title": "Privacy Policy",
        "updated": "2026-10-02",
        "body": "Simple Talk, owned by Gandapodi V Saathvik, is only a technology bridge between a fan and an independent creator. We collect account, device, call, and payment metadata to operate instant audio and video sessions. We do not sell personal data and we do not store call recordings. This policy can change; the latest version applies.",
    }


@router.get("/terms")
async def terms():
    return {
        "title": "Terms of Service",
        "updated": "2026-10-02",
        "body": "Simple Talk is only a bridge between the user and the creator. We are not a party to the call and we are not responsible for what either person says or does. We will suspend or remove accounts, and may withhold earnings where the law allows, for misuse or illegal use. These terms can change; continued use is acceptance. Wallet recharges are prepaid credits for instant calls.",
    }
