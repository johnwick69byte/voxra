from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends

from app.core.database import get_db
from app.core.security import require_user
from app.core.config import get_settings
from app.models.schemas import SupportMessageRequest, ApplyReferralRequest
from app.services import referral_service

router = APIRouter(tags=["misc"])


@router.get("/profile/referral")
async def referral_overview(user: dict = Depends(require_user)):
    return await referral_service.get_referral_overview(user)


@router.post("/profile/referral/apply")
async def referral_apply(body: ApplyReferralRequest, user: dict = Depends(require_user)):
    return await referral_service.apply_referral_code(user, body.code)


@router.get("/healthz")
async def healthz():
    return {"ok": True, "service": "voxora-api"}


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


@router.get("/privacy")
async def privacy():
    return {
        "title": "Privacy Policy",
        "updated": "2026-08-02",
        "body": "Voxora collects account, device, and call metadata needed to operate instant audio/video sessions and payments. We do not sell personal data.",
    }


@router.get("/terms")
async def terms():
    return {
        "title": "Terms of Service",
        "updated": "2026-08-02",
        "body": "By using Voxora you agree to respectful conduct. Abuse or nudity may result in bans. Wallet recharges are prepaid credits for instant calls.",
    }
