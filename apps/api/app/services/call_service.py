"""
Call orchestrator — server-owned state machine.

States: RINGING → ACCEPTED → LIVE → ENDED_* | REJECTED | CANCELLED | MISSED
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.database import get_db
from app.core.database_redis import get_redis, ring_lock_key, call_timeout_key, call_billing_key
from app.core.socket import emit_to_user, emit_call
from app.services import agora_service, presence_service, push_service, wallet_service

logger = logging.getLogger(__name__)

# In-process fallback timers (Redis keys used for multi-instance awareness)
_timeout_tasks: dict[str, asyncio.Task] = {}
_billing_tasks: dict[str, asyncio.Task] = {}


def _decline_token(call_id: str) -> str:
    return f"dec_{call_id}_{uuid.uuid4().hex[:8]}"


async def initiate_call(*, caller: dict, receiver_id: str, call_type: str) -> dict:
    db = get_db()
    settings = get_settings()
    call_type = call_type.upper()
    if call_type not in ("AUDIO", "VIDEO"):
        raise HTTPException(400, "call_type must be AUDIO or VIDEO")

    receiver = await db.users.find_one({"user_id": receiver_id}, {"_id": 0})
    if not receiver or receiver.get("user_type") != "creator":
        raise HTTPException(400, "Receiver must be a creator")

    profile = await db.creator_profiles.find_one({"user_id": receiver_id}, {"_id": 0})
    if not profile or not profile.get("is_approved"):
        raise HTTPException(403, "Creator not approved")
    if not profile.get("instant_call_enabled", True):
        raise HTTPException(403, "Instant calls disabled")
    if profile.get("is_dnd"):
        raise HTTPException(403, "Creator is in DND mode")

    available, reason = await presence_service.is_creator_available(receiver_id, profile)
    if not available and reason != "ok":
        # OFFLINE is allowed (push wake); BUSY/DND blocked
        if reason != "Creator is busy" and "DND" not in reason:
            pass
        else:
            raise HTTPException(409, reason)

    rate_key = "video_rate_per_minute" if call_type == "VIDEO" else "audio_rate_per_minute"
    rate = float(profile.get(rate_key) or (settings.min_video_rate if call_type == "VIDEO" else settings.min_audio_rate))
    min_balance = (rate / 60.0) * 30  # 30 seconds worth
    wallet = await wallet_service.get_wallet(caller["user_id"])
    if wallet.get("balance", 0) < min_balance:
        raise HTTPException(
            402,
            f"Insufficient balance. Minimum ₹{min_balance:.2f} required (₹{rate:.2f}/min)",
        )

    # Redis atomic ring lock (Mongo fallback)
    r = get_redis()
    call_id = f"call_{uuid.uuid4().hex[:12]}"
    if r:
        lock_key = ring_lock_key(receiver_id)
        locked = await r.set(lock_key, call_id, nx=True, ex=settings.call_ring_timeout_seconds + 5)
        if not locked:
            raise HTTPException(409, "Creator is receiving another call")
    else:
        # Mongo fallback lock
        existing = await db.call_records.find_one(
            {"receiver_id": receiver_id, "status": "RINGING"},
            {"_id": 0, "call_id": 1},
        )
        if existing:
            raise HTTPException(409, "Creator is receiving another call")

    channel_name = f"channel_{call_id}"
    decline_token = _decline_token(call_id)
    now = datetime.now(timezone.utc)

    call = {
        "call_id": call_id,
        "caller_id": caller["user_id"],
        "receiver_id": receiver_id,
        "call_type": call_type,
        "status": "RINGING",
        "channel_name": channel_name,
        "rate_per_minute": rate,
        "total_amount": 0.0,
        "last_billed_minute": 0,
        "decline_token": decline_token,
        "created_at": now,
        "accepted_at": None,
        "live_at": None,
        "end_time": None,
        "duration_seconds": 0,
        "commission_amount": 0.0,
        "model_earnings": 0.0,
    }
    await db.call_records.insert_one(call)

    # Push data-only incoming call
    push_doc = await db.push_tokens.find_one({"user_id": receiver_id}, {"_id": 0})
    if push_doc and push_doc.get("device_push_token"):
        await push_service.send_push(
            push_doc["device_push_token"],
            title="Incoming Call",
            body=f"{caller.get('name') or 'Someone'} is calling you",
            data={
                "type": "incoming_call",
                "call_id": call_id,
                "caller_id": caller["user_id"],
                "caller_name": caller.get("name") or "Someone",
                "caller_picture": caller.get("picture") or "",
                "call_type": call_type,
                "channel_name": channel_name,
                "decline_token": decline_token,
            },
            data_only=True,
            ttl_seconds=settings.call_ring_timeout_seconds,
            channel_id="incoming_calls",
        )

    payload = {
        "call_id": call_id,
        "caller_id": caller["user_id"],
        "caller_name": caller.get("name"),
        "caller_picture": caller.get("picture"),
        "call_type": call_type,
        "channel_name": channel_name,
        "decline_token": decline_token,
    }
    await emit_to_user(receiver_id, "incoming_call", payload)
    await emit_to_user(
        receiver_id,
        "creator_status",
        {"user_id": receiver_id, "status": "BUSY", "ringing_call_id": call_id},
    )

    await schedule_ring_timeout(call_id, receiver_id, caller["user_id"])

    return {
        "success": True,
        "call_id": call_id,
        "channel_name": channel_name,
        "status": "RINGING",
        "rate_per_minute": rate,
    }


async def schedule_ring_timeout(call_id: str, receiver_id: str, caller_id: str) -> None:
    settings = get_settings()
    r = get_redis()
    if r:
        await r.set(call_timeout_key(call_id), "1", ex=settings.call_ring_timeout_seconds + 10)

    async def _run():
        await asyncio.sleep(settings.call_ring_timeout_seconds)
        try:
            await miss_call(call_id)
        except Exception:
            logger.exception("ring timeout failed for %s", call_id)

    old = _timeout_tasks.pop(call_id, None)
    if old:
        old.cancel()
    _timeout_tasks[call_id] = asyncio.create_task(_run())


async def _clear_ring_lock(receiver_id: str, call_id: str) -> None:
    try:
        r = get_redis()
        if r:
            val = await r.get(ring_lock_key(receiver_id))
            if val == call_id:
                await r.delete(ring_lock_key(receiver_id))
    except Exception:
        pass
    task = _timeout_tasks.pop(call_id, None)
    if task:
        task.cancel()


async def accept_call(*, call_id: str, user: dict) -> dict:
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call:
        raise HTTPException(404, "Call not found")
    if call["receiver_id"] != user["user_id"]:
        raise HTTPException(403, "Only receiver can accept")
    if call["status"] != "RINGING":
        raise HTTPException(409, f"Call not ringing (status={call['status']})")

    now = datetime.now(timezone.utc)
    result = await db.call_records.find_one_and_update(
        {"call_id": call_id, "status": "RINGING"},
        {"$set": {"status": "ACCEPTED", "accepted_at": now}},
        return_document=True,
    )
    if not result:
        raise HTTPException(409, "Call already handled")

    await _clear_ring_lock(call["receiver_id"], call_id)
    tokens = agora_service.build_rtc_token(call["channel_name"])

    await emit_to_user(
        call["caller_id"],
        "call_accepted",
        {
            "call_id": call_id,
            "channel_name": call["channel_name"],
            "agora": tokens,
        },
    )
    await emit_to_user(call["caller_id"], "cancel_call_notification", {"call_id": call_id})

    return {
        "success": True,
        "call_id": call_id,
        "channel_name": call["channel_name"],
        "agora": tokens,
        "rate_per_minute": call["rate_per_minute"],
    }


async def reject_call(*, call_id: str, user: Optional[dict] = None, decline_token: Optional[str] = None) -> dict:
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call:
        raise HTTPException(404, "Call not found")
    if call["status"] != "RINGING":
        return {"success": True, "message": "Already handled"}

    authorized = False
    if user and user["user_id"] == call["receiver_id"]:
        authorized = True
    if decline_token and decline_token == call.get("decline_token"):
        authorized = True
    if not authorized:
        raise HTTPException(403, "Not authorized to reject")

    await db.call_records.update_one(
        {"call_id": call_id, "status": "RINGING"},
        {"$set": {"status": "REJECTED", "end_time": datetime.now(timezone.utc)}},
    )
    await _clear_ring_lock(call["receiver_id"], call_id)
    await emit_to_user(call["caller_id"], "call_rejected", {"call_id": call_id})
    await emit_to_user(call["receiver_id"], "cancel_call_notification", {"call_id": call_id})
    status = await presence_service.get_creator_status(call["receiver_id"])
    await emit_to_user(
        call["receiver_id"],
        "creator_status",
        {"user_id": call["receiver_id"], "status": status},
    )
    return {"success": True}


async def cancel_call(*, call_id: str, user: dict) -> dict:
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call:
        raise HTTPException(404, "Call not found")
    if call["caller_id"] != user["user_id"]:
        raise HTTPException(403, "Only caller can cancel")
    if call["status"] != "RINGING":
        return {"success": True, "message": "Already handled"}

    await db.call_records.update_one(
        {"call_id": call_id, "status": "RINGING"},
        {"$set": {"status": "CANCELLED", "end_time": datetime.now(timezone.utc)}},
    )
    await _clear_ring_lock(call["receiver_id"], call_id)
    await emit_to_user(call["receiver_id"], "call_cancelled", {"call_id": call_id})
    await emit_to_user(call["receiver_id"], "cancel_call_notification", {"call_id": call_id})
    return {"success": True}


async def miss_call(call_id: str) -> dict:
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call or call["status"] != "RINGING":
        return {"success": True}
    await db.call_records.update_one(
        {"call_id": call_id, "status": "RINGING"},
        {"$set": {"status": "MISSED", "end_time": datetime.now(timezone.utc)}},
    )
    await _clear_ring_lock(call["receiver_id"], call_id)
    try:
        r = get_redis()
        if r:
            await r.incr("metrics:ring_timeout")
    except Exception:
        pass
    await emit_to_user(call["caller_id"], "call_missed", {"call_id": call_id})
    await emit_to_user(call["receiver_id"], "call_missed", {"call_id": call_id})
    await emit_to_user(call["receiver_id"], "cancel_call_notification", {"call_id": call_id})
    return {"success": True}


async def prepaid_start(*, call_id: str, user: dict) -> dict:
    """Bill first minute and mark LIVE; start server billing tick."""
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call:
        raise HTTPException(404, "Call not found")
    if user["user_id"] not in (call["caller_id"], call["receiver_id"]):
        raise HTTPException(403, "Not a participant")
    if call["status"] not in ("ACCEPTED", "LIVE"):
        raise HTTPException(409, "Call not accepted")

    rate = float(call["rate_per_minute"])
    if call.get("last_billed_minute", 0) < 1:
        updated = await wallet_service.atomic_debit(call["caller_id"], rate)
        if not updated:
            await end_call(call_id=call_id, user=user, reason="ENDED_INSUFFICIENT_BALANCE")
            raise HTTPException(402, "Insufficient balance for first minute")
        await db.call_records.update_one(
            {"call_id": call_id},
            {
                "$set": {
                    "status": "LIVE",
                    "live_at": datetime.now(timezone.utc),
                    "last_billed_minute": 1,
                    "last_billing_time": datetime.now(timezone.utc),
                },
                "$inc": {"total_amount": rate},
            },
        )
        wallet = await wallet_service.get_wallet(call["caller_id"])
        payload = {
            "call_id": call_id,
            "amount": rate,
            "minute": 1,
            "total_billed": rate,
            "balance": wallet.get("balance", 0),
        }
        await emit_to_user(call["caller_id"], "call_prepaid_billed", payload)
        await emit_to_user(call["receiver_id"], "call_prepaid_billed", payload)
    else:
        await db.call_records.update_one(
            {"call_id": call_id},
            {"$set": {"status": "LIVE", "live_at": datetime.now(timezone.utc)}},
        )

    await start_billing_loop(call_id)
    tokens = agora_service.build_rtc_token(call["channel_name"])
    return {"success": True, "agora": tokens, "status": "LIVE"}


async def start_billing_loop(call_id: str) -> None:
    """Server-authoritative prepaid tick every 60s."""
    if call_id in _billing_tasks and not _billing_tasks[call_id].done():
        return

    async def _loop():
        try:
            r = get_redis()
            if r:
                await r.set(call_billing_key(call_id), "1", ex=120)
            while True:
                await asyncio.sleep(60)
                ok = await bill_next_minute(call_id)
                if not ok:
                    break
                if r:
                    await r.set(call_billing_key(call_id), "1", ex=120)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("billing loop error %s", call_id)

    _billing_tasks[call_id] = asyncio.create_task(_loop())


async def bill_next_minute(call_id: str) -> bool:
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call or call["status"] != "LIVE":
        return False

    minute_to_bill = int(call.get("last_billed_minute", 0)) + 1
    rate = float(call["rate_per_minute"])

    atomic = await db.call_records.find_one_and_update(
        {"call_id": call_id, "status": "LIVE", "last_billed_minute": {"$lt": minute_to_bill}},
        {
            "$set": {
                "last_billed_minute": minute_to_bill,
                "last_billing_time": datetime.now(timezone.utc),
            }
        },
        return_document=True,
    )
    if not atomic:
        return True

    updated = await wallet_service.atomic_debit(call["caller_id"], rate)
    if not updated:
        await finalize_call(call_id, status="ENDED_INSUFFICIENT_BALANCE")
        await emit_to_user(
            call["caller_id"],
            "call_ended_insufficient_balance",
            {"call_id": call_id},
        )
        await emit_to_user(
            call["receiver_id"],
            "call_ended_insufficient_balance",
            {"call_id": call_id},
        )
        return False

    result = await db.call_records.find_one_and_update(
        {"call_id": call_id},
        {"$inc": {"total_amount": rate}},
        return_document=True,
    )
    total = result["total_amount"] if result else rate
    balance = updated.get("balance", 0)
    payload = {
        "call_id": call_id,
        "amount": rate,
        "minute": minute_to_bill,
        "total_billed": total,
        "balance": balance,
    }
    await emit_to_user(call["caller_id"], "call_prepaid_billed", payload)
    await emit_to_user(call["receiver_id"], "call_prepaid_billed", payload)

    minutes_remaining = int(balance / rate) if rate > 0 else 999
    if minutes_remaining < 2:
        await emit_to_user(
            call["caller_id"],
            "call_low_balance_warning",
            {
                "call_id": call_id,
                "balance": balance,
                "minutes_remaining": minutes_remaining,
                "rate_per_minute": rate,
            },
        )
    return True


async def bill_minute_client(*, call_id: str, user: dict, current_minute: int) -> dict:
    """Optional client-triggered bill (idempotent with server loop)."""
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call:
        raise HTTPException(404, "Call not found")
    if call["caller_id"] != user["user_id"]:
        raise HTTPException(403, "Only caller can trigger billing")
    if call["status"] != "LIVE":
        return {"success": True, "message": "Call not live"}
    # Align server last_billed with client elapsed minutes
    target = current_minute + 1
    while call.get("last_billed_minute", 0) < target:
        ok = await bill_next_minute(call_id)
        if not ok:
            return {"success": False, "insufficient_balance": True}
        call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    wallet = await wallet_service.get_wallet(user["user_id"])
    return {"success": True, "balance": wallet.get("balance", 0)}


async def end_call(*, call_id: str, user: dict, reason: str = "ENDED") -> dict:
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call:
        raise HTTPException(404, "Call not found")
    if user["user_id"] not in (call["caller_id"], call["receiver_id"]) and user.get("user_type") != "admin":
        raise HTTPException(403, "Not a participant")
    if call["status"] in ("ENDED", "ENDED_INSUFFICIENT_BALANCE", "ENDED_DISCONNECT", "REJECTED", "CANCELLED", "MISSED"):
        return {"success": True, "message": "Already ended"}
    return await finalize_call(call_id, status=reason)


async def finalize_call(call_id: str, status: str = "ENDED") -> dict:
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call:
        return {"success": False}

    task = _billing_tasks.pop(call_id, None)
    if task:
        task.cancel()
    await _clear_ring_lock(call["receiver_id"], call_id)

    now = datetime.now(timezone.utc)
    live_at = call.get("live_at") or call.get("accepted_at") or call.get("created_at")
    duration = 0
    if live_at:
        if getattr(live_at, "tzinfo", None) is None:
            live_at = live_at.replace(tzinfo=timezone.utc)
        duration = max(0, int((now - live_at).total_seconds()))

    total = float(call.get("total_amount", 0))
    commission = wallet_service.calculate_commission(total)

    await db.call_records.update_one(
        {"call_id": call_id},
        {
            "$set": {
                "status": status,
                "end_time": now,
                "duration_seconds": duration,
                "commission_amount": commission["commission_amount"],
                "model_earnings": commission["model_earnings"],
            }
        },
    )

    # Credit creator earnings once
    if commission["model_earnings"] > 0:
        existing = await db.transactions.find_one(
            {"metadata.call_id": call_id, "type": "CALL_CREDIT"}
        )
        if not existing:
            await wallet_service.credit_earnings(call["receiver_id"], commission["model_earnings"])
            await wallet_service.insert_transaction(
                user_id=call["receiver_id"],
                tx_type="CALL_CREDIT",
                amount=commission["model_earnings"],
                description=f"Earnings from {call.get('call_type')} call",
                metadata={"call_id": call_id},
                transaction_id=f"tx_{call_id}_credit",
            )

    if total > 0:
        existing_debit = await db.transactions.find_one(
            {"metadata.call_id": call_id, "type": "CALL_DEBIT"}
        )
        if not existing_debit:
            await wallet_service.insert_transaction(
                user_id=call["caller_id"],
                tx_type="CALL_DEBIT",
                amount=total,
                description=f"Call charge ({duration}s)",
                metadata={"call_id": call_id, "model_id": call["receiver_id"]},
                transaction_id=f"tx_{call_id}_debit",
            )

    if commission["commission_amount"] > 0:
        existing_c = await db.transactions.find_one(
            {"metadata.call_id": call_id, "type": "COMMISSION"}
        )
        if not existing_c:
            await db.platform_wallet.update_one(
                {"platform_id": "platform_001"},
                {
                    "$inc": {"balance": commission["commission_amount"]},
                    "$set": {"updated_at": now},
                },
                upsert=True,
            )
            await wallet_service.insert_transaction(
                user_id="platform",
                tx_type="COMMISSION",
                amount=commission["commission_amount"],
                description=f"Commission from {call_id}",
                metadata={"call_id": call_id},
                transaction_id=f"tx_{call_id}_commission",
            )

    payload = {
        "call_id": call_id,
        "status": status,
        "duration_seconds": duration,
        "total_amount": total,
    }
    await emit_to_user(call["caller_id"], "call_ended", payload)
    await emit_to_user(call["receiver_id"], "call_ended", payload)
    await emit_call(call_id, "call_ended", payload)

    status_now = await presence_service.get_creator_status(call["receiver_id"])
    await emit_to_user(
        call["receiver_id"],
        "creator_status",
        {"user_id": call["receiver_id"], "status": status_now},
    )
    return {"success": True, **payload}


async def handle_disconnect(*, call_id: str, user: dict) -> dict:
    """Start reconnect grace window instead of ending immediately."""
    from app.services import disconnect_service

    return await disconnect_service.start_disconnect_grace(call_id=call_id, user=user)


async def admin_force_end(call_id: str) -> dict:
    return await finalize_call(call_id, status="ENDED")


async def sweep_stuck_calls() -> int:
    """Clear LIVE/ACCEPTED/RINGING calls older than thresholds."""
    db = get_db()
    now = datetime.now(timezone.utc)
    count = 0
    # Ringing older than 2 min
    from datetime import timedelta

    old_ring = await db.call_records.find(
        {
            "status": "RINGING",
            "created_at": {"$lt": now - timedelta(minutes=2)},
        }
    ).to_list(100)
    for c in old_ring:
        await miss_call(c["call_id"])
        count += 1

    old_live = await db.call_records.find(
        {
            "status": {"$in": ["ACCEPTED", "LIVE"]},
            "accepted_at": {"$lt": now - timedelta(hours=3)},
        }
    ).to_list(50)
    for c in old_live:
        await finalize_call(c["call_id"], status="ENDED_DISCONNECT")
        count += 1
    return count
