"""Disconnect grace: wait for reconnect before ending the call."""

from __future__ import annotations

import asyncio
import logging

from app.core.database import get_db
from app.core.database_redis import get_redis
from app.core.socket import emit_to_user

logger = logging.getLogger(__name__)

_grace_tasks: dict[str, asyncio.Task] = {}
GRACE_SECONDS = 20


def _grace_key(call_id: str) -> str:
    return f"disconnect_grace:{call_id}"


async def start_disconnect_grace(*, call_id: str, user: dict) -> dict:
    from fastapi import HTTPException
    from app.services import call_service

    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call:
        raise HTTPException(404, "Call not found")
    if user["user_id"] not in (call["caller_id"], call["receiver_id"]):
        raise HTTPException(403, "Not a participant")
    if call["status"] not in ("ACCEPTED", "LIVE"):
        return {"success": True, "message": "Call already ended"}

    r = get_redis()
    if r:
        await r.set(_grace_key(call_id), user["user_id"], ex=GRACE_SECONDS + 5)

    payload = {"call_id": call_id, "grace_seconds": GRACE_SECONDS}
    await emit_to_user(call["caller_id"], "call_reconnect_pending", payload)
    await emit_to_user(call["receiver_id"], "call_reconnect_pending", payload)

    old = _grace_tasks.pop(call_id, None)
    if old:
        old.cancel()

    async def _run():
        try:
            await asyncio.sleep(GRACE_SECONDS)
            still = await db.call_records.find_one({"call_id": call_id}, {"_id": 0, "status": 1})
            if still and still.get("status") in ("ACCEPTED", "LIVE"):
                if r and not await r.exists(_grace_key(call_id)):
                    return
                if r:
                    await r.delete(_grace_key(call_id))
                await call_service.finalize_call(call_id, status="ENDED_DISCONNECT")
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("disconnect grace failed %s", call_id)

    _grace_tasks[call_id] = asyncio.create_task(_run())
    return {"success": True, "grace_seconds": GRACE_SECONDS, "status": "reconnect_pending"}


async def cancel_disconnect_grace(call_id: str) -> dict:
    task = _grace_tasks.pop(call_id, None)
    if task:
        task.cancel()
    r = get_redis()
    if r:
        await r.delete(_grace_key(call_id))
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if call:
        payload = {"call_id": call_id}
        await emit_to_user(call["caller_id"], "call_reconnected", payload)
        await emit_to_user(call["receiver_id"], "call_reconnected", payload)
    return {"success": True}
