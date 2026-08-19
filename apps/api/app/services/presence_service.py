"""Creator presence, DND, and availability."""

from __future__ import annotations

from typing import Optional, Tuple

from app.core.database import get_db
from app.core.database_redis import get_redis, presence_key, ring_lock_key


async def is_online(user_id: str) -> bool:
    try:
        r = get_redis()
        if not r:
            return False
        return bool(await r.exists(presence_key(user_id)))
    except Exception:
        return False


async def get_creator_status(creator_id: str, profile: Optional[dict] = None) -> str:
    db = get_db()
    if profile is None:
        profile = await db.creator_profiles.find_one({"user_id": creator_id}, {"_id": 0})
    if not profile:
        return "OFFLINE"
    if profile.get("is_dnd"):
        return "DND"
    # Busy if ring lock or active call
    try:
        r = get_redis()
        if r and await r.exists(ring_lock_key(creator_id)):
            return "BUSY"
    except Exception:
        pass
    active = await db.call_records.find_one(
        {
            "receiver_id": creator_id,
            "status": {"$in": ["RINGING", "ACCEPTED", "LIVE"]},
        },
        {"_id": 0, "call_id": 1},
    )
    if active:
        return "BUSY"
    if not await is_online(creator_id):
        # Offline creators can still be rung via push; UI shows OFFLINE
        return "OFFLINE"
    return "ACTIVE"


async def is_creator_available(creator_id: str, profile: Optional[dict] = None) -> Tuple[bool, str]:
    status = await get_creator_status(creator_id, profile)
    if status == "DND":
        return False, "Creator is in DND mode"
    if status == "BUSY":
        return False, "Creator is busy"
    return True, "ok"


async def set_dnd(creator_id: str, enabled: bool) -> dict:
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": creator_id},
        {"$set": {"is_dnd": enabled}},
    )
    return {"is_dnd": enabled, "status": "DND" if enabled else await get_creator_status(creator_id)}


async def force_offline(creator_id: str) -> dict:
    """Admin: clear presence/locks and release stuck BUSY state."""
    from app.core.socket import emit_to_user
    from app.services import call_service

    db = get_db()
    try:
        r = get_redis()
        if r:
            await r.delete(presence_key(creator_id))
            await r.delete(ring_lock_key(creator_id))
    except Exception:
        pass

    ringing = await db.call_records.find(
        {"receiver_id": creator_id, "status": "RINGING"},
        {"_id": 0, "call_id": 1},
    ).to_list(20)
    for call in ringing:
        await call_service.miss_call(call["call_id"])

    await db.creator_profiles.update_one(
        {"user_id": creator_id},
        {"$set": {"is_busy": False}},
    )
    await emit_to_user(
        creator_id,
        "creator_status",
        {"user_id": creator_id, "status": "OFFLINE"},
    )
    return {"success": True, "user_id": creator_id, "status": "OFFLINE"}
