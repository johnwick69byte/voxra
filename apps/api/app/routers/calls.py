from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.rate_limit import check_rate_limit
from app.core.security import require_user
from app.models.schemas import BillMinuteRequest, GiftRequest, InitiateCallRequest, ReviewRequest
from app.services import call_service, wallet_service
from app.core.database import get_db
from datetime import datetime, timezone

router = APIRouter(prefix="/calls", tags=["calls"])


@router.post("/initiate")
async def initiate(body: InitiateCallRequest, user: dict = Depends(require_user)):
    allowed = await check_rate_limit(f"calls:initiate:{user['user_id']}", limit=10, window_seconds=60)
    if not allowed:
        raise HTTPException(429, "Too many call attempts. Try again in a minute.")
    return await call_service.initiate_call(
        caller=user,
        receiver_id=body.receiver_id,
        call_type=body.call_type,
    )


@router.post("/{call_id}/accept")
async def accept(call_id: str, user: dict = Depends(require_user)):
    return await call_service.accept_call(call_id=call_id, user=user)


@router.post("/{call_id}/reject")
async def reject(call_id: str, request: Request, user: dict = Depends(require_user)):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    return await call_service.reject_call(
        call_id=call_id,
        user=user,
        decline_token=body.get("decline_token"),
    )


@router.post("/{call_id}/reject-token")
async def reject_with_token(call_id: str, request: Request):
    """Unauthenticated decline from lock-screen using signed decline_token."""
    body = await request.json()
    return await call_service.reject_call(
        call_id=call_id,
        user=None,
        decline_token=body.get("decline_token"),
    )


@router.post("/{call_id}/cancel")
async def cancel(call_id: str, user: dict = Depends(require_user)):
    return await call_service.cancel_call(call_id=call_id, user=user)


@router.post("/{call_id}/prepaid-start")
async def prepaid_start(call_id: str, user: dict = Depends(require_user)):
    return await call_service.prepaid_start(call_id=call_id, user=user)


@router.post("/{call_id}/bill-minute")
async def bill_minute(call_id: str, body: BillMinuteRequest, user: dict = Depends(require_user)):
    return await call_service.bill_minute_client(
        call_id=call_id, user=user, current_minute=body.current_minute
    )


@router.post("/{call_id}/end")
async def end(call_id: str, user: dict = Depends(require_user)):
    return await call_service.end_call(call_id=call_id, user=user)


@router.post("/{call_id}/handle-disconnect")
async def disconnect(call_id: str, user: dict = Depends(require_user)):
    return await call_service.handle_disconnect(call_id=call_id, user=user)


@router.post("/{call_id}/reconnect")
async def reconnect(call_id: str, user: dict = Depends(require_user)):
    """Cancel disconnect grace after peer recovers."""
    from app.services import disconnect_service
    from app.core.database import get_db
    from fastapi import HTTPException

    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call or user["user_id"] not in (call["caller_id"], call["receiver_id"]):
        raise HTTPException(403, "Not allowed")
    return await disconnect_service.cancel_disconnect_grace(call_id)


@router.post("/{call_id}/gift")
async def gift(call_id: str, body: GiftRequest, user: dict = Depends(require_user)):
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call or call["status"] != "LIVE":
        from fastapi import HTTPException
        raise HTTPException(400, "Call not live")
    if call["caller_id"] != user["user_id"]:
        from fastapi import HTTPException
        raise HTTPException(403, "Only caller can gift")
    amount = float(body.amount)
    if amount <= 0:
        from fastapi import HTTPException
        raise HTTPException(400, "Invalid amount")
    updated = await wallet_service.atomic_debit(user["user_id"], amount)
    if not updated:
        from fastapi import HTTPException
        raise HTTPException(402, "Insufficient balance")
    commission = wallet_service.calculate_commission(amount)
    await wallet_service.credit_earnings(call["receiver_id"], commission["model_earnings"])
    await wallet_service.insert_transaction(
        user_id=user["user_id"],
        tx_type="GIFT_DEBIT",
        amount=amount,
        description="In-call gift",
        metadata={"call_id": call_id},
    )
    await wallet_service.insert_transaction(
        user_id=call["receiver_id"],
        tx_type="GIFT_CREDIT",
        amount=commission["model_earnings"],
        description="Gift received",
        metadata={"call_id": call_id},
    )
    from app.core.socket import emit_to_user
    payload = {
        "call_id": call_id,
        "amount": amount,
        "earnings": commission["model_earnings"],
        "commission_rate": commission["commission_rate"],
        "balance": updated.get("balance", 0),
    }
    await emit_to_user(call["receiver_id"], "gift_received", payload)
    await emit_to_user(call["caller_id"], "gift_sent", payload)
    return {
        "success": True,
        "balance": updated.get("balance", 0),
        "earnings": commission["model_earnings"],
        "commission_rate": commission["commission_rate"],
    }


@router.post("/{call_id}/review")
async def review(call_id: str, body: ReviewRequest, user: dict = Depends(require_user)):
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call or call["caller_id"] != user["user_id"]:
        from fastapi import HTTPException
        raise HTTPException(403, "Not allowed")
    await db.reviews.update_one(
        {"call_id": call_id},
        {
            "$set": {
                "call_id": call_id,
                "creator_id": call["receiver_id"],
                "user_id": user["user_id"],
                "rating": body.rating,
                "comment": body.comment,
                "created_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return {"success": True}


@router.post("/{call_id}/report")
async def report_call(call_id: str, request: Request, user: dict = Depends(require_user)):
    body = await request.json()
    reason = (body.get("reason") or "abuse").strip()
    db = get_db()
    call = await db.call_records.find_one({"call_id": call_id}, {"_id": 0})
    if not call or user["user_id"] not in (call["caller_id"], call["receiver_id"]):
        from fastapi import HTTPException
        raise HTTPException(403, "Not allowed")
    reported = call["receiver_id"] if user["user_id"] == call["caller_id"] else call["caller_id"]
    await db.reports.insert_one(
        {
            "report_id": f"rpt_{call_id}_{user['user_id'][-6:]}",
            "call_id": call_id,
            "reporter_id": user["user_id"],
            "reported_id": reported,
            "reason": reason,
            "created_at": datetime.now(timezone.utc),
        }
    )
    return {"success": True}


@router.get("/active")
async def active_call(user: dict = Depends(require_user)):
    """Restore mid-LIVE / ACCEPTED call after app relaunch."""
    db = get_db()
    call = await db.call_records.find_one(
        {
            "$or": [{"caller_id": user["user_id"]}, {"receiver_id": user["user_id"]}],
            "status": {"$in": ["ACCEPTED", "LIVE", "RINGING"]},
        },
        {"_id": 0, "decline_token": 0},
        sort=[("created_at", -1)],
    )
    if not call:
        return {"success": True, "call": None}
    from app.services import agora_service

    role = "caller" if call["caller_id"] == user["user_id"] else "receiver"
    agora = None
    if call["status"] in ("ACCEPTED", "LIVE"):
        agora = agora_service.build_rtc_token(call["channel_name"])
    return {"success": True, "call": call, "role": role, "agora": agora}


@router.get("/history")
async def history(user: dict = Depends(require_user)):
    db = get_db()
    q = {
        "$or": [{"caller_id": user["user_id"]}, {"receiver_id": user["user_id"]}],
    }
    calls = (
        await db.call_records.find(q, {"_id": 0, "decline_token": 0})
        .sort("created_at", -1)
        .limit(50)
        .to_list(50)
    )
    peer_ids = set()
    for c in calls:
        peer_ids.add(c["caller_id"] if c["receiver_id"] == user["user_id"] else c["receiver_id"])
    users = {}
    if peer_ids:
        async for u in db.users.find({"user_id": {"$in": list(peer_ids)}}, {"_id": 0, "user_id": 1, "name": 1}):
            users[u["user_id"]] = u.get("name")
    for c in calls:
        peer_id = c["caller_id"] if c["receiver_id"] == user["user_id"] else c["receiver_id"]
        c["peer_id"] = peer_id
        c["peer_name"] = users.get(peer_id) or c.get("caller_name") or c.get("receiver_name")
    return {"success": True, "calls": calls}
