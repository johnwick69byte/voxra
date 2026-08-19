from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, require_admin, verify_password
from app.models.schemas import AdminLoginRequest, BroadcastNotificationRequest
from app.services import call_service, presence_service, push_service, wallet_service

router = APIRouter(prefix="/admin", tags=["admin"])


async def _audit(admin_id: str, action: str, meta: dict | None = None):
    db = get_db()
    await db.admin_audit.insert_one(
        {
            "admin_id": admin_id,
            "action": action,
            "meta": meta or {},
            "created_at": datetime.now(timezone.utc),
        }
    )


@router.post("/login")
async def admin_login(body: AdminLoginRequest):
    db = get_db()
    user = await db.users.find_one({"email": body.email.lower(), "user_type": "admin"}, {"_id": 0})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(401, "Invalid credentials")
    token = create_access_token(user["user_id"], "admin", admin=True)
    await _audit(user["user_id"], "login")
    return {"success": True, "token": token, "user": {"user_id": user["user_id"], "email": user.get("email"), "name": user.get("name")}}


@router.get("/overview")
async def overview(admin: dict = Depends(require_admin)):
    db = get_db()
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)

    total_users = await db.users.count_documents({"user_type": "user", "deleted": {"$ne": True}})
    total_creators = await db.users.count_documents({"user_type": "creator", "deleted": {"$ne": True}})
    pending_creators = await db.creator_profiles.count_documents({"verification_status": "pending_review"})
    active_calls = await db.call_records.count_documents({"status": {"$in": ["RINGING", "ACCEPTED", "LIVE"]}})

    recharge_pipeline = [
        {"$match": {"type": "RECHARGE", "created_at": {"$gte": week_ago}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
    ]
    recharge = await db.transactions.aggregate(recharge_pipeline).to_list(1)
    gmv_week = recharge[0]["total"] if recharge else 0

    commission_pipeline = [
        {"$match": {"type": "COMMISSION", "created_at": {"$gte": week_ago}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]
    commission = await db.transactions.aggregate(commission_pipeline).to_list(1)
    commission_week = commission[0]["total"] if commission else 0

    calls_today = await db.call_records.count_documents({"created_at": {"$gte": day_ago}})
    missed_today = await db.call_records.count_documents({"status": "MISSED", "created_at": {"$gte": day_ago}})
    platform = await db.platform_wallet.find_one({"platform_id": "platform_001"}, {"_id": 0})

    return {
        "success": True,
        "metrics": {
            "total_users": total_users,
            "total_creators": total_creators,
            "pending_creators": pending_creators,
            "active_calls": active_calls,
            "gmv_week": gmv_week,
            "commission_week": commission_week,
            "calls_today": calls_today,
            "missed_today": missed_today,
            "miss_rate_today": round((missed_today / calls_today) * 100, 1) if calls_today else 0,
            "platform_wallet": platform.get("balance", 0) if platform else 0,
        },
    }


@router.get("/analytics")
async def analytics(period: str = "weekly", admin: dict = Depends(require_admin)):
    db = get_db()
    days = 7 if period == "weekly" else 30 if period == "monthly" else 1
    since = datetime.now(timezone.utc) - timedelta(days=days)
    pipeline = [
        {"$match": {"type": "RECHARGE", "created_at": {"$gte": since}}},
        {
            "$group": {
                "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
                "amount": {"$sum": "$amount"},
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"_id": 1}},
    ]
    recharge_series = await db.transactions.aggregate(pipeline).to_list(60)

    call_pipeline = [
        {"$match": {"created_at": {"$gte": since}}},
        {
            "$group": {
                "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
                "calls": {"$sum": 1},
                "revenue": {"$sum": "$total_amount"},
            }
        },
        {"$sort": {"_id": 1}},
    ]
    call_series = await db.call_records.aggregate(call_pipeline).to_list(60)

    top_creators = await db.call_records.aggregate(
        [
            {"$match": {"status": {"$in": ["ENDED", "ENDED_INSUFFICIENT_BALANCE"]}, "created_at": {"$gte": since}}},
            {"$group": {"_id": "$receiver_id", "earnings": {"$sum": "$model_earnings"}, "calls": {"$sum": 1}}},
            {"$sort": {"earnings": -1}},
            {"$limit": 10},
        ]
    ).to_list(10)

    return {
        "success": True,
        "recharge_series": [{"date": x["_id"], "amount": x["amount"], "count": x["count"]} for x in recharge_series],
        "call_series": [{"date": x["_id"], "calls": x["calls"], "revenue": x["revenue"]} for x in call_series],
        "top_creators": top_creators,
    }


@router.get("/calls/active")
async def active_calls(admin: dict = Depends(require_admin)):
    db = get_db()
    calls = await db.call_records.find(
        {"status": {"$in": ["RINGING", "ACCEPTED", "LIVE"]}},
        {"_id": 0, "decline_token": 0},
    ).to_list(100)
    return {"success": True, "calls": calls}


async def _live_ops_metrics(db) -> dict:
    from app.core.database_redis import get_redis, redis_available

    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    stuck_threshold = now - timedelta(minutes=10)

    active_calls_count = await db.call_records.count_documents(
        {"status": {"$in": ["RINGING", "ACCEPTED", "LIVE"]}}
    )
    calls_today = await db.call_records.count_documents({"created_at": {"$gte": day_ago}})
    missed_today = await db.call_records.count_documents(
        {"status": "MISSED", "created_at": {"$gte": day_ago}}
    )
    miss_rate_today = round((missed_today / calls_today) * 100, 1) if calls_today else 0

    fcm_fail_count = 0
    fcm_ok_count = 0
    r = get_redis()
    if r and redis_available():
        try:
            fcm_fail_count = int(await r.get("metrics:fcm_fail") or 0)
            fcm_ok_count = int(await r.get("metrics:fcm_ok") or 0)
        except Exception:
            pass

    stuck_busy_creators = []
    seen_ids: set[str] = set()

    busy_profiles = await db.creator_profiles.find(
        {"is_busy": True},
        {"_id": 0, "user_id": 1},
    ).to_list(100)
    for p in busy_profiles:
        seen_ids.add(p["user_id"])

    old_active_calls = await db.call_records.find(
        {
            "status": {"$in": ["RINGING", "ACCEPTED", "LIVE"]},
            "created_at": {"$lt": stuck_threshold},
        },
        {"_id": 0, "receiver_id": 1, "call_id": 1, "status": 1, "created_at": 1},
    ).to_list(100)
    for call in old_active_calls:
        seen_ids.add(call["receiver_id"])

    for creator_id in seen_ids:
        status = await presence_service.get_creator_status(creator_id)
        if status != "BUSY" and creator_id not in {p["user_id"] for p in busy_profiles}:
            continue
        u = await db.users.find_one({"user_id": creator_id}, {"_id": 0, "name": 1, "username": 1})
        stuck_busy_creators.append(
            {
                "user_id": creator_id,
                "name": u.get("name") if u else None,
                "username": u.get("username") if u else None,
                "status": status,
            }
        )

    return {
        "active_calls_count": active_calls_count,
        "miss_rate_today": miss_rate_today,
        "calls_today": calls_today,
        "missed_today": missed_today,
        "fcm_fail_count": fcm_fail_count,
        "fcm_ok_count": fcm_ok_count,
        "stuck_busy_creators": stuck_busy_creators,
    }


@router.get("/live-ops")
async def live_ops(admin: dict = Depends(require_admin)):
    db = get_db()
    calls = await db.call_records.find(
        {"status": {"$in": ["RINGING", "ACCEPTED", "LIVE"]}},
        {"_id": 0, "decline_token": 0},
    ).to_list(100)
    metrics = await _live_ops_metrics(db)
    return {
        "success": True,
        "calls": calls,
        "metrics": metrics,
        "stuck_busy_creators": metrics["stuck_busy_creators"],
    }


@router.post("/creators/{user_id}/force-offline")
async def force_offline_creator(user_id: str, admin: dict = Depends(require_admin)):
    result = await presence_service.force_offline(user_id)
    await _audit(admin["user_id"], "force_offline_creator", {"user_id": user_id})
    return result


@router.post("/calls/{call_id}/force-end")
async def force_end(call_id: str, admin: dict = Depends(require_admin)):
    result = await call_service.admin_force_end(call_id)
    await _audit(admin["user_id"], "force_end_call", {"call_id": call_id})
    return result


@router.get("/calls/logs")
async def call_logs(skip: int = 0, limit: int = 50, admin: dict = Depends(require_admin)):
    db = get_db()
    calls = (
        await db.call_records.find({}, {"_id": 0, "decline_token": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(min(limit, 100))
        .to_list(100)
    )
    total = await db.call_records.count_documents({})
    return {"success": True, "calls": calls, "total": total}


@router.get("/calls/missed")
async def missed_calls(admin: dict = Depends(require_admin)):
    db = get_db()
    calls = (
        await db.call_records.find({"status": "MISSED"}, {"_id": 0, "decline_token": 0})
        .sort("created_at", -1)
        .limit(100)
        .to_list(100)
    )
    return {"success": True, "calls": calls}


@router.get("/creators/pending")
async def pending_creators(admin: dict = Depends(require_admin)):
    db = get_db()
    profiles = await db.creator_profiles.find(
        {"verification_status": "pending_review"}, {"_id": 0}
    ).to_list(100)
    out = []
    for p in profiles:
        u = await db.users.find_one({"user_id": p["user_id"]}, {"_id": 0})
        out.append({**p, "user": u})
    return {"success": True, "creators": out}


@router.post("/creators/{user_id}/approve")
async def approve_creator(user_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"is_approved": True, "verification_status": "approved"}},
    )
    await _audit(admin["user_id"], "approve_creator", {"user_id": user_id})
    # notify
    push = await db.push_tokens.find_one({"user_id": user_id}, {"_id": 0})
    if push:
        await push_service.send_push(
            push["device_push_token"],
            title="You're approved!",
            body="Your Voxora creator profile is live. Go online and take calls.",
            data={"type": "profile_verified"},
        )
    return {"success": True}


@router.post("/creators/{user_id}/reject")
async def reject_creator(user_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"is_approved": False, "verification_status": "rejected"}},
    )
    await _audit(admin["user_id"], "reject_creator", {"user_id": user_id})
    return {"success": True}


@router.post("/users/{user_id}/suspend")
async def suspend_user(user_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    await db.users.update_one({"user_id": user_id}, {"$set": {"is_suspended": True}})
    await _audit(admin["user_id"], "suspend_user", {"user_id": user_id})
    return {"success": True}


@router.get("/withdrawals/pending")
async def pending_withdrawals(admin: dict = Depends(require_admin)):
    db = get_db()
    items = await db.withdrawal_requests.find({"status": "PENDING"}, {"_id": 0}).to_list(100)
    return {"success": True, "withdrawals": items}


@router.post("/withdrawals/{request_id}/mark-paid")
async def mark_paid(request_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    await db.withdrawal_requests.update_one(
        {"request_id": request_id},
        {"$set": {"status": "PAID", "paid_at": datetime.now(timezone.utc), "paid_by": admin["user_id"]}},
    )
    await _audit(admin["user_id"], "withdrawal_paid", {"request_id": request_id})
    return {"success": True}


@router.post("/withdrawals/{request_id}/reject")
async def reject_withdrawal(request_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    req = await db.withdrawal_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Not found")
    if req["status"] == "PENDING":
        await wallet_service.credit_earnings(req["user_id"], req["amount"])
        await db.withdrawal_requests.update_one(
            {"request_id": request_id},
            {"$set": {"status": "REJECTED"}},
        )
    await _audit(admin["user_id"], "withdrawal_reject", {"request_id": request_id})
    return {"success": True}


@router.get("/support/messages")
async def support_messages(admin: dict = Depends(require_admin)):
    db = get_db()
    msgs = await db.support_messages.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"success": True, "messages": msgs}


@router.post("/support/messages/{message_id}/reply")
async def reply_support(message_id: str, body: dict, admin: dict = Depends(require_admin)):
    db = get_db()
    await db.support_messages.update_one(
        {"message_id": message_id},
        {
            "$set": {
                "reply": body.get("reply"),
                "replied_at": datetime.now(timezone.utc),
                "replied_by": admin["user_id"],
                "status": "replied",
            }
        },
    )
    await _audit(admin["user_id"], "support_reply", {"message_id": message_id})
    return {"success": True}


@router.post("/notifications/broadcast")
async def broadcast(body: BroadcastNotificationRequest, admin: dict = Depends(require_admin)):
    db = get_db()
    q = {}
    if body.audience == "users":
        q = {"user_type": "user"}
    elif body.audience == "creators":
        q = {"user_type": "creator"}
    users = await db.users.find(q, {"user_id": 1}).to_list(5000)
    sent = 0
    for u in users:
        token_doc = await db.push_tokens.find_one({"user_id": u["user_id"]}, {"_id": 0})
        if token_doc:
            ok = await push_service.send_push(
                token_doc["device_push_token"],
                title=body.title,
                body=body.body,
                data={"type": "admin_broadcast"},
            )
            if ok:
                sent += 1
        await db.notifications.insert_one(
            {
                "user_id": u["user_id"],
                "title": body.title,
                "body": body.body,
                "type": "admin_broadcast",
                "read": False,
                "created_at": datetime.now(timezone.utc),
            }
        )
    await _audit(admin["user_id"], "broadcast", {"audience": body.audience, "sent": sent})
    return {"success": True, "sent": sent}


@router.get("/health")
async def system_health(admin: dict = Depends(require_admin)):
    from app.core.database_redis import get_redis
    from app.core.socket import sid_to_user_id

    redis_ok = False
    try:
        from app.core.database_redis import get_redis, redis_available
        r = get_redis()
        if r and redis_available():
            await r.ping()
            redis_ok = True
    except Exception:
        pass
    swept = await call_service.sweep_stuck_calls()
    return {
        "success": True,
        "redis_ok": redis_ok,
        "socket_connections": len(sid_to_user_id),
        "stuck_calls_swept": swept,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/audit")
async def audit_log(admin: dict = Depends(require_admin)):
    db = get_db()
    items = await db.admin_audit.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"success": True, "audit": items}


@router.post("/bootstrap")
async def bootstrap_admin(email: str, password: str, name: str = "Admin"):
    """Create first admin if none exists. Disabled in production."""
    settings = get_settings()
    if not settings.allow_admin_bootstrap or settings.environment == "production":
        raise HTTPException(403, "Admin bootstrap is disabled")
    db = get_db()
    existing = await db.users.find_one({"user_type": "admin"})
    if existing:
        raise HTTPException(400, "Admin already exists")
    import uuid

    user_id = f"adm_{uuid.uuid4().hex[:10]}"
    await db.users.insert_one(
        {
            "user_id": user_id,
            "email": email.lower(),
            "name": name,
            "password_hash": hash_password(password),
            "user_type": "admin",
            "profile_complete": True,
            "created_at": datetime.now(timezone.utc),
        }
    )
    return {"success": True, "user_id": user_id}
