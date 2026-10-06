from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

import socketio

from app.core.config import get_settings
from app.core.database_redis import get_redis, presence_key

logger = logging.getLogger(__name__)

sid_to_user_id: Dict[str, str] = {}

# Throttles the denormalized is_online flag refresh so a heartbeat every 20s
# does not become a Mongo write every 20s per connected creator.
_last_flag_refresh: Dict[str, float] = {}

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=get_settings().socketio_cors_list,
    logger=False,
    engineio_logger=False,
)


@sio.event
async def connect(sid, environ, auth):
    logger.info("socket connected %s", sid)


@sio.event
async def disconnect(sid):
    user_id = sid_to_user_id.pop(sid, None)
    if user_id:
        # Only mark offline if no other sids for this user
        still = [s for s, u in sid_to_user_id.items() if u == user_id]
        if not still:
            _last_flag_refresh.pop(user_id, None)
            try:
                r = get_redis()
                if r:
                    await r.delete(presence_key(user_id))
                from app.services import presence_service

                await presence_service.mark_creator_offline(user_id)
                await sio.emit(
                    "creator_status",
                    {"user_id": user_id, "status": "OFFLINE", "is_online": False},
                )
            except Exception:
                logger.exception("presence cleanup failed for %s", user_id)
    logger.info("socket disconnected %s user=%s", sid, user_id)


@sio.on("authenticate")
async def authenticate(sid, data):
    """Client sends { user_id } after login to join personal room."""
    user_id = (data or {}).get("user_id")
    if not user_id:
        return {"ok": False}
    was_offline = user_id not in sid_to_user_id.values()
    sid_to_user_id[sid] = user_id
    await sio.enter_room(sid, user_id)
    try:
        r = get_redis()
        if r:
            await r.set(presence_key(user_id), "1", ex=90)
    except Exception:
        pass
    # Creator came online — persist presence + notify followers (rate-limited)
    if was_offline:
        try:
            from app.core.database import get_db
            from app.services import follower_notify_service, presence_service

            db = get_db()
            u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "user_type": 1})
            if u and u.get("user_type") == "creator":
                await presence_service.mark_creator_online(user_id)
                await follower_notify_service.notify_followers_creator_online(
                    user_id, reason="socket_online"
                )
        except Exception:
            logger.exception("follower online notify failed")
    return {"ok": True}


@sio.on("heartbeat")
async def heartbeat(sid, data=None):
    user_id = sid_to_user_id.get(sid)
    if not user_id:
        return {"ok": False}
    try:
        r = get_redis()
        if r:
            await r.set(presence_key(user_id), "1", ex=90)
    except Exception:
        pass
    # Keep the denormalized is_online flag fresh for creators. Without this the
    # profile flag only changed on connect/disconnect, so browse showed a creator
    # as OFFLINE while they were actively using the app.
    CACHE_TTL = 60
    try:
        now = time.time()
        if now - _last_flag_refresh.get(user_id, 0) > CACHE_TTL:
            _last_flag_refresh[user_id] = now
            from app.core.database import get_db
            from app.services import presence_service

            db = get_db()
            u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "user_type": 1})
            if u and u.get("user_type") == "creator":
                await presence_service.mark_creator_online(user_id)
    except Exception:
        logger.exception("heartbeat presence refresh failed for %s", user_id)
    return {"ok": True}


@sio.on("join_call_room")
async def join_call_room(sid, data):
    call_id = (data or {}).get("call_id")
    if call_id:
        await sio.enter_room(sid, f"call:{call_id}")
    return {"ok": True}


@sio.on("leave_call_room")
async def leave_call_room(sid, data):
    call_id = (data or {}).get("call_id")
    if call_id:
        await sio.leave_room(sid, f"call:{call_id}")
    return {"ok": True}


async def emit_to_user(user_id: str, event: str, payload: Any) -> None:
    """Prefer direct SID emit to avoid double-delivery via room."""
    sids = [s for s, u in sid_to_user_id.items() if u == user_id]
    if sids:
        for sid in sids:
            await sio.emit(event, payload, to=sid)
    else:
        await sio.emit(event, payload, room=user_id)


async def emit_call(call_id: str, event: str, payload: Any) -> None:
    await sio.emit(event, payload, room=f"call:{call_id}")
