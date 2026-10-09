"""
Call orchestrator — server-owned state machine.

States: RINGING → ACCEPTED → LIVE → ENDED_* | REJECTED | CANCELLED | MISSED
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
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


async def settle_minute(call: dict, *, minute: int, rate: float) -> tuple[float, float]:
    """
    Credit the creator 85% and log the platform 15% for one billed minute.

    Idempotent per (call_id, minute): the creator transaction id and the
    platform_commissions unique key both encode the minute, so a duplicate call
    (server loop + client backup, or a reconciliation pass) cannot double-credit.
    Returns (model_earnings, platform_commission).
    """
    db = get_db()
    call_id = call["call_id"]
    model_cut = round(rate * 0.85, 2)
    platform_cut = round(rate - model_cut, 2)

    # Creator earnings — guarded by the per-minute transaction id.
    credit_tx_id = f"tx_{call_id}_m{minute}"
    existing = await db.transactions.find_one(
        {"transaction_id": credit_tx_id}, {"_id": 0, "transaction_id": 1}
    )
    if not existing:
        await wallet_service.credit_earnings(call["receiver_id"], model_cut)
        await wallet_service.insert_transaction(
            user_id=call["receiver_id"],
            tx_type="CALL_CREDIT",
            amount=model_cut,
            description=f"Call earnings (minute {minute})",
            metadata={"call_id": call_id, "minute": minute, "rate_per_minute": rate},
            transaction_id=credit_tx_id,
        )

    # Platform commission — idempotent per (call_id, minute).
    existing_comm = await db.platform_commissions.find_one(
        {"source_id": call_id, "type": "CALL_COMMISSION", "minute": minute},
        {"_id": 0, "commission_id": 1},
    )
    if not existing_comm and platform_cut > 0:
        await wallet_service.add_platform_balance(platform_cut)
        await wallet_service.record_platform_commission(
            commission_type="CALL_COMMISSION",
            amount=platform_cut,
            source_id=call_id,
            user_id=call["receiver_id"],
            gross_amount=rate,
            model_earnings=model_cut,
            minute=minute,
            metadata={"call_id": call_id, "minute": minute, "caller_id": call["caller_id"]},
        )

    return model_cut, platform_cut


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
    if not profile:
        raise HTTPException(404, "Creator profile not found")
    if not profile.get("is_approved"):
        raise HTTPException(
            403,
            "This creator's verification is still under review and cannot take calls yet",
        )
    if not profile.get("instant_call_enabled", True):
        raise HTTPException(403, "Instant calls disabled")
    if profile.get("is_dnd"):
        raise HTTPException(403, "Creator is in DND mode")

    # BUSY is a hard block. OFFLINE is allowed: they are not connected, but a
    # push can still wake their device and ring them.
    available, reason = await presence_service.is_creator_available(receiver_id, profile)
    if not available:
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

    # A caller already on a live/ringing call cannot start another.
    caller_active = await db.call_records.find_one(
        {
            "caller_id": caller["user_id"],
            "status": {"$in": ["RINGING", "ACCEPTED", "LIVE"]},
        },
        {"_id": 0, "call_id": 1},
    )
    if caller_active:
        raise HTTPException(409, "You are already on a call")

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
    try:
        await db.call_records.insert_one(call)
    except Exception:
        # Never leave the creator locked if the call row could not be created.
        await _clear_ring_lock(receiver_id, call_id)
        logger.exception("call insert failed for %s", call_id)
        raise HTTPException(500, "Could not start the call, please try again")

    # Ring via a *data-only* message with high priority. This wakes the
    # headless JS task even when the app is killed/swiped. The background
    # handler (index.js) will display a Notifee notification with a
    # fullScreenIntent that launches the full-screen call UI.
    push_doc = await db.push_tokens.find_one({"user_id": receiver_id}, {"_id": 0})
    if push_doc and push_doc.get("device_push_token"):
        remaining = settings.call_ring_timeout_seconds
        await push_service.send_push(
            push_doc["device_push_token"],
            title=f"Incoming {call_type.lower()} call",
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
                "route": "incoming-call",
            },
            data_only=True,
            ttl_seconds=remaining,
            channel_id="incoming_calls_v1",
            loop_sound=True,
            category="call",
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

    # Mint tokens BEFORE mutating the call. If this fails the call stays RINGING,
    # where the ring timeout and sweeper can still clean it up. Flipping to
    # ACCEPTED first left the row stuck in a state that reads as BUSY forever
    # (a 500 here used to leave the creator unringable for the full sweep window).
    receiver_uid = agora_service.uid_for_user(call["receiver_id"])
    caller_uid = agora_service.uid_for_user(call["caller_id"])
    try:
        receiver_tokens = agora_service.build_rtc_token(call["channel_name"], uid=receiver_uid)
        caller_tokens = agora_service.build_rtc_token(call["channel_name"], uid=caller_uid)
    except Exception:
        logger.exception("accept_call: token mint failed for %s", call_id)
        raise HTTPException(500, "Could not start the call audio. Please try again.")

    now = datetime.now(timezone.utc)
    result = await db.call_records.find_one_and_update(
        {"call_id": call_id, "status": "RINGING"},
        {"$set": {"status": "ACCEPTED", "accepted_at": now}},
        return_document=True,
    )
    if not result:
        raise HTTPException(409, "Call already handled")

    await _clear_ring_lock(call["receiver_id"], call_id)

    await emit_to_user(
        call["caller_id"],
        "call_accepted",
        {
            "call_id": call_id,
            "channel_name": call["channel_name"],
            # Tokens are channel+uid bound, so each side needs its own.
            "agora": {**caller_tokens, "peer_uid": receiver_uid},
        },
    )
    await emit_to_user(call["caller_id"], "cancel_call_notification", {"call_id": call_id})

    return {
        "success": True,
        "call_id": call_id,
        "channel_name": call["channel_name"],
        "agora": {**receiver_tokens, "peer_uid": caller_uid},
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


def _emit_low_balance_warning(call: dict, balance: float) -> Optional[dict]:
    """Build the low-balance warning payload when the caller is near the end.

    Fires when fewer than 2 minutes remain, so the caller is warned during the
    penultimate minute -- before the call is force-ended for insufficient
    funds. Matches the old app's threshold. Returns None when balance is fine.
    """
    rate = float(call.get("rate_per_minute") or 0)
    if rate <= 0:
        return None
    minutes_remaining = int(balance / rate)
    if minutes_remaining >= 2:
        return None
    return {
        "call_id": call["call_id"],
        "balance": balance,
        "rate_per_minute": rate,
        "minutes_remaining": minutes_remaining,
    }


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
        model_cut, _platform_cut = await settle_minute(call, minute=1, rate=rate)
        wallet = await wallet_service.get_wallet(call["caller_id"])
        creator_wallet = await wallet_service.get_wallet(call["receiver_id"])
        caller_balance = wallet.get("balance", 0)
        payload = {
            "call_id": call_id,
            "amount": rate,
            "minute": 1,
            "total_billed": rate,
            "balance": caller_balance,
        }
        await emit_to_user(call["caller_id"], "call_prepaid_billed", payload)
        await emit_to_user(
            call["receiver_id"],
            "call_prepaid_billed",
            {
                **payload,
                "earnings": model_cut,
                "earnings_balance": creator_wallet.get("earnings_balance", 0),
            },
        )
        # Warn on the very first minute too: a caller who joined with only ~1
        # minute of balance would otherwise get no warning before being cut off.
        warning = _emit_low_balance_warning(call, caller_balance)
        if warning:
            await emit_to_user(call["caller_id"], "call_low_balance_warning", warning)
    else:
        await db.call_records.update_one(
            {"call_id": call_id},
            {"$set": {"status": "LIVE", "live_at": datetime.now(timezone.utc)}},
        )

    await start_billing_loop(call_id)
    # Per-participant uid again: the caller re-joins here after acceptance.
    my_uid = agora_service.uid_for_user(user["user_id"])
    peer_id = call["receiver_id"] if user["user_id"] == call["caller_id"] else call["caller_id"]
    tokens = {
        **agora_service.build_rtc_token(call["channel_name"], uid=my_uid),
        "peer_uid": agora_service.uid_for_user(peer_id),
    }
    wallet_now = await wallet_service.get_wallet(call["caller_id"])
    creator_wallet_now = await wallet_service.get_wallet(call["receiver_id"])
    fresh = await db.call_records.find_one({"call_id": call_id}, {"_id": 0, "total_amount": 1})
    return {
        "success": True,
        "agora": tokens,
        "status": "LIVE",
        "balance": wallet_now.get("balance", 0),
        "earnings_balance": creator_wallet_now.get("earnings_balance", 0),
        "total_billed": float((fresh or {}).get("total_amount") or 0),
    }


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
    """Bill exactly one more minute. A second caller within 55s does not debit again."""
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call or call["status"] != "LIVE":
        return False

    now = datetime.now(timezone.utc)
    last = call.get("last_billing_time") or call.get("live_at")
    if last is not None:
        if getattr(last, "tzinfo", None) is None:
            last = last.replace(tzinfo=timezone.utc)
        if (now - last).total_seconds() < 55:
            return True

    minute_to_bill = int(call.get("last_billed_minute", 0)) + 1
    rate = float(call["rate_per_minute"])
    cutoff = now - timedelta(seconds=55)

    atomic = await db.call_records.find_one_and_update(
        {
            "call_id": call_id,
            "status": "LIVE",
            "last_billed_minute": {"$lt": minute_to_bill},
            "$or": [
                {"last_billing_time": {"$lte": cutoff}},
                {"last_billing_time": None},
                {"last_billing_time": {"$exists": False}},
            ],
        },
        {
            "$set": {
                "last_billed_minute": minute_to_bill,
                "last_billing_time": now,
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
    model_cut, _platform_cut = await settle_minute(call, minute=minute_to_bill, rate=rate)
    creator_wallet = await wallet_service.get_wallet(call["receiver_id"])
    payload = {
        "call_id": call_id,
        "amount": rate,
        "minute": minute_to_bill,
        "total_billed": total,
        "balance": balance,
    }
    await emit_to_user(call["caller_id"], "call_prepaid_billed", payload)
    await emit_to_user(
        call["receiver_id"],
        "call_prepaid_billed",
        {
            **payload,
            "earnings": model_cut,
            "earnings_balance": creator_wallet.get("earnings_balance", 0),
        },
    )

    warning = _emit_low_balance_warning(call, balance)
    if warning:
        await emit_to_user(call["caller_id"], "call_low_balance_warning", warning)
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
    # One attempt only. The 55s gate in bill_next_minute drops duplicate ticks
    # from the server loop and from both phones.
    _ = current_minute
    ok = await bill_next_minute(call_id)
    if not ok:
        return {"success": False, "insufficient_balance": True}
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
    minutes_billed = int(call.get("last_billed_minute", 0) or 0)
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

    # Creator + platform are paid per minute (settle_minute). Reconcile any
    # minute that was billed (total_amount) but not yet settled, e.g. a crash
    # between the fan debit and the credit. Idempotent per minute.
    rate = float(call.get("rate_per_minute", 0) or 0)
    if rate > 0 and total > 0:
        expected_minutes = int(round(total / rate))
        for m in range(1, expected_minutes + 1):
            existing_credit = await db.transactions.find_one(
                {"transaction_id": f"tx_{call_id}_m{m}"}, {"_id": 0, "transaction_id": 1}
            )
            if not existing_credit:
                await settle_minute(call, minute=m, rate=rate)

    # Fan ledger: one consolidated debit for the whole call.
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
                metadata={"call_id": call_id, "model_id": call["receiver_id"], "minutes_billed": minutes_billed},
                transaction_id=f"tx_{call_id}_debit",
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
    settings = get_settings()
    now = datetime.now(timezone.utc)
    count = 0

    # RINGING with no answer. Threshold is slightly above the ring timeout so
    # the normal timeout path normally wins.
    old_ring = await db.call_records.find(
        {
            "status": "RINGING",
            "created_at": {"$lt": now - timedelta(seconds=settings.call_ring_timeout_seconds + 30)},
        }
    ).to_list(100)
    for c in old_ring:
        await miss_call(c["call_id"])
        count += 1

    # ACCEPTED but never went LIVE. The receiver accepted and then the handshake
    # died (network drop, client crash, a 500 mid-accept). Until this clears, the
    # creator reads as BUSY and cannot be rung at all -- previously this waited
    # 3 HOURS, which is what left a model stuck on Busy.
    stale_accepted = await db.call_records.find(
        {
            "status": "ACCEPTED",
            "accepted_at": {"$lt": now - timedelta(minutes=2)},
        }
    ).to_list(50)
    for c in stale_accepted:
        await finalize_call(c["call_id"], status="ENDED_DISCONNECT")
        count += 1

    # LIVE calls whose billing heartbeat stopped. bill_next_minute refreshes the
    # Redis key every minute, so a missing key means the loop is gone.
    live = await db.call_records.find(
        {
            "status": "LIVE",
            "accepted_at": {"$lt": now - timedelta(minutes=5)},
        }
    ).to_list(50)
    for c in live:
        call_id = c["call_id"]
        try:
            r = get_redis()
            if r and await r.exists(call_billing_key(call_id)):
                continue
        except Exception:
            continue
        # Redis unavailable: fall back to the socket map. If neither side is
        # connected, the call cannot be progressing.
        from app.core.socket import sid_to_user_id

        connected = set(sid_to_user_id.values())
        if c["caller_id"] in connected or c["receiver_id"] in connected:
            continue
        await finalize_call(call_id, status="ENDED_DISCONNECT")
        count += 1

    # Hard ceiling: nothing should outlive this regardless of state.
    ancient = await db.call_records.find(
        {
            "status": {"$in": ["ACCEPTED", "LIVE", "RINGING"]},
            "created_at": {"$lt": now - timedelta(hours=3)},
        }
    ).to_list(50)
    for c in ancient:
        await finalize_call(c["call_id"], status="ENDED_DISCONNECT")
        count += 1
    return count
