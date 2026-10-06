"""Creator presence, DND, and availability."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, Tuple

from app.core.database import get_db
from app.core.database_redis import get_redis, presence_key, ring_lock_key

logger = logging.getLogger(__name__)


async def is_online(user_id: str) -> bool:
    """True when a live Redis presence key exists.

    Returns None (not False) when Redis is unavailable, so callers can tell
    "definitely offline" apart from "cannot tell". Treating an outage as
    "everyone is offline" is what previously caused every creator to be flipped
    offline by the reconciler within a minute of Redis wobbling.
    """
    try:
        r = get_redis()
        if not r:
            return None
        return bool(await r.exists(presence_key(user_id)))
    except Exception:
        return None


async def mark_creator_online(creator_id: str) -> None:
    """Persist presence on the profile so browse can filter/sort/paginate in Mongo."""
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": creator_id},
        {"$set": {"is_online": True, "last_seen": datetime.now(timezone.utc)}},
    )


async def mark_creator_offline(creator_id: str) -> None:
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": creator_id},
        {"$set": {"is_online": False, "last_seen": datetime.now(timezone.utc)}},
    )


async def reconcile_offline_creators() -> int:
    """Flip profiles offline when their Redis presence key has expired.

    Bails out entirely when Redis is unreachable: presence cannot be evaluated
    without it, and treating "unknown" as offline would wipe every creator's
    status on a transient outage.
    """
    if get_redis() is None:
        logger.warning("reconcile_offline_creators skipped: Redis unavailable")
        return 0
    db = get_db()
    now = datetime.now(timezone.utc)
    rows = await db.creator_profiles.find(
        {"is_online": True}, {"_id": 0, "user_id": 1}
    ).to_list(2000)
    flipped = 0
    for row in rows:
        uid = row["user_id"]
        if await is_online(uid) is False:
            await db.creator_profiles.update_one(
                {"user_id": uid}, {"$set": {"is_online": False, "last_seen": now}}
            )
            flipped += 1
    return flipped


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
    presence = await is_online(creator_id)
    if presence is False:
        # Offline creators can still be rung via push; UI shows OFFLINE
        return "OFFLINE"
    if presence is None:
        # Redis unavailable -- fall back to the denormalized flag rather than
        # claiming the creator is offline.
        return "ACTIVE" if profile.get("is_online") else "OFFLINE"
    return "ACTIVE"


async def ensure_redis_or_warn() -> bool:
    """Log loudly when Redis is down, since presence and locks degrade silently."""
    ok = get_redis() is not None
    if not ok:
        logger.error(
            "REDIS UNAVAILABLE - creator online/offline status will fall back to "
            "the last known value, and ring/call locks degrade to Mongo. "
            "Set REDIS_URL or the UPSTASH_* vars on the API service."
        )
    return ok


def status_from_profile(profile: dict, *, is_online_now: Optional[bool] = None, busy: bool = False) -> str:
    """Derive display status from denormalized fields without extra queries."""
    if profile.get("is_dnd"):
        return "DND"
    if busy:
        return "BUSY"
    online = is_online_now if is_online_now is not None else bool(profile.get("is_online"))
    return "ACTIVE" if online else "OFFLINE"


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

    await emit_to_user(
        creator_id,
        "creator_status",
        {"user_id": creator_id, "status": "OFFLINE"},
    )
    return {"success": True, "user_id": creator_id, "status": "OFFLINE"}
