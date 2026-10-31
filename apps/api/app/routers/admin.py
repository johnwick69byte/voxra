from datetime import datetime, timedelta, timezone
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, require_admin, verify_password
from app.core.socket import emit_to_user
from app.models.schemas import AdminLoginRequest, BroadcastNotificationRequest
from app.services import (
    call_service,
    model_referral_service,
    presence_service,
    push_service,
    wallet_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


async def _notify_user(user_id: str, title: str, body: str, ntype: str) -> None:
    db = get_db()
    doc = {
        "notification_id": f"ntf_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "title": title,
        "body": body,
        "type": ntype,
        "read": False,
        "created_at": datetime.now(timezone.utc),
    }
    await db.notifications.insert_one(doc)
    await emit_to_user(
        user_id,
        "new_notification",
        {"title": title, "message": body, "type": ntype},
    )
    push = await db.push_tokens.find_one({"user_id": user_id}, {"_id": 0})
    token = (push or {}).get("device_push_token")
    if not token:
        # An approval that never reached the phone is indistinguishable from a
        # broken push feature unless we say so.
        logger.warning("notify %s: no push token registered for user %s", ntype, user_id)
        return
    ok = await push_service.send_push(
        token,
        title=title,
        body=body,
        data={"type": ntype},
        channel_id="app_notifications",
    )
    if not ok and push_service.token_is_dead(token):
        await db.push_tokens.delete_one({"user_id": user_id, "device_push_token": token})
        logger.info("purged dead push token for user %s", user_id)
    elif not ok:
        logger.warning("notify %s: push failed for user %s", ntype, user_id)


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
        if status != "BUSY":
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
    # Enrich with peer names
    ids: set[str] = set()
    for c in calls:
        ids.add(c.get("caller_id"))
        ids.add(c.get("receiver_id"))
    names: dict[str, dict] = {}
    if ids:
        async for u in db.users.find(
            {"user_id": {"$in": [i for i in ids if i]}},
            {"_id": 0, "user_id": 1, "name": 1},
        ):
            names[u["user_id"]] = u.get("name")
    for c in calls:
        c["caller_name"] = names.get(c.get("caller_id"))
        c["receiver_name"] = names.get(c.get("receiver_id"))
        c["commission"] = c.get("commission_amount", 0)

    ended = ["ENDED", "ENDED_INSUFFICIENT_BALANCE"]
    summary_rows = await db.call_records.aggregate(
        [
            {"$match": {"status": {"$in": ended}}},
            {
                "$group": {
                    "_id": None,
                    "total_revenue": {"$sum": "$total_amount"},
                    "total_model_earnings": {"$sum": "$model_earnings"},
                    "total_platform_commission": {"$sum": "$commission_amount"},
                }
            },
        ]
    ).to_list(1)
    s = summary_rows[0] if summary_rows else {}
    summary = {
        "total_revenue": round(s.get("total_revenue", 0) or 0, 2),
        "total_model_earnings": round(s.get("total_model_earnings", 0) or 0, 2),
        "total_platform_commission": round(s.get("total_platform_commission", 0) or 0, 2),
    }
    return {"success": True, "calls": calls, "total": total, "summary": summary}


@router.get("/calls/missed")
async def missed_calls(admin: dict = Depends(require_admin)):
    db = get_db()
    calls = (
        await db.call_records.find({"status": "MISSED"}, {"_id": 0, "decline_token": 0})
        .sort("created_at", -1)
        .limit(100)
        .to_list(100)
    )
    ids: set[str] = set()
    for c in calls:
        ids.add(c.get("caller_id"))
        ids.add(c.get("receiver_id"))
    names: dict[str, str] = {}
    if ids:
        async for u in db.users.find(
            {"user_id": {"$in": [i for i in ids if i]}}, {"_id": 0, "user_id": 1, "name": 1}
        ):
            names[u["user_id"]] = u.get("name")
    for c in calls:
        c["caller_name"] = names.get(c.get("caller_id"))
        c["receiver_name"] = names.get(c.get("receiver_id"))
    return {"success": True, "calls": calls}


@router.post("/calls/generate-token")
async def generate_monitor_token(body: dict, admin: dict = Depends(require_admin)):
    """Admin spectator token — join a live channel as a subscriber (audience)."""
    channel_name = (body or {}).get("channel_name")
    if not channel_name:
        raise HTTPException(400, "channel_name is required")
    from app.services import agora_service

    tokens = agora_service.build_rtc_token(channel_name, uid=0, role="subscriber")
    await _audit(admin["user_id"], "monitor_token", {"channel_name": channel_name})
    return {
        "success": True,
        "token": tokens.get("token"),
        "appId": tokens.get("app_id"),
        "uid": 0,
        "channel_name": channel_name,
    }


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


@router.get("/creators/verified")
async def verified_creators(admin: dict = Depends(require_admin)):
    db = get_db()
    profiles = await db.creator_profiles.find({"is_approved": True}, {"_id": 0}).to_list(500)
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
    # Keep the user-level flag in sync for clients and older queries.
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"is_approved": True, "verification_status": "approved"}},
    )
    await _audit(admin["user_id"], "approve_creator", {"user_id": user_id})
    await _notify_user(
        user_id,
        "You're approved!",
        "Your Simple Talk creator profile is live. Go online and take calls.",
        "profile_verified",
    )
    return {"success": True}


@router.post("/creators/{user_id}/reject")
async def reject_creator(user_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    await db.creator_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"is_approved": False, "verification_status": "rejected"}},
    )
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"is_approved": False, "verification_status": "rejected"}},
    )
    await db.verification_requests.update_many(
        {"user_id": user_id, "status": "PENDING"},
        {"$set": {"status": "REJECTED"}},
    )
    await _audit(admin["user_id"], "reject_creator", {"user_id": user_id})
    await _notify_user(
        user_id,
        "Verification needs a new selfie",
        "Your creator verification was rejected. Open Simple Talk and retake a clear live selfie.",
        "profile_rejected",
    )
    return {"success": True}


@router.post("/users/{user_id}/suspend")
async def suspend_user(user_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    await db.users.update_one({"user_id": user_id}, {"$set": {"is_suspended": True}})
    await _audit(admin["user_id"], "suspend_user", {"user_id": user_id})
    return {"success": True}


def _withdrawal_view(row: dict, live_referrer: dict | None = None) -> dict:
    """Return a withdrawal row with the 10% fee split for the admin table.

    Pending rows are evaluated against the current referral state, so a
    deleted account immediately shows as platform-only. Settled rows keep the
    amounts recorded when the payout was marked paid.
    """
    data = dict(row)
    status = data.get("status")
    gross = round(float(data.get("amount") or 0), 2)
    stored_referrer = bool(data.get("referrer_id"))

    if status in ("REJECTED", "FAILED"):
        data.setdefault("commission_rate", get_settings().withdrawal_commission_rate)
        data.setdefault("commission_amount", 0.0)
        data.setdefault("payout_amount", 0.0)
        data.setdefault("referral_bonus_percentage", get_settings().model_referral_bonus_percentage)
        data.setdefault("referral_bonus_amount", 0.0)
        data.setdefault("platform_commission_amount", 0.0)
        data.setdefault("referral_status", "REFUNDED")
        data.setdefault("potential_referral_bonus_amount", 0.0)
        return data

    settled = status in ("PAID", "PROCESSED")
    legacy_paid = settled and data.get("commission_amount") is None
    eligible = bool(live_referrer) if status == "PENDING" else stored_referrer
    split = wallet_service.calculate_withdrawal_split(gross, eligible)

    if legacy_paid:
        # Paid before the 10% withdrawal commission existed. Do not reprice
        # historical payouts; just show that no fee/referral was recorded.
        data["commission_rate"] = 0.0
        data["commission_amount"] = 0.0
        data["payout_amount"] = gross
        data["referral_bonus_percentage"] = 0.0
        data["referral_bonus_amount"] = 0.0
        data["platform_commission_amount"] = 0.0
        data["referral_status"] = "LEGACY"
        data["potential_referral_bonus_amount"] = 0.0
        return data

    for key in (
        "commission_rate",
        "commission_amount",
        "payout_amount",
        "referral_bonus_percentage",
        "referral_bonus_amount",
        "platform_commission_amount",
    ):
        if data.get(key) is None:
            data[key] = split[key]
    data["potential_referral_bonus_amount"] = split[
        "potential_referral_bonus_amount"
    ]

    if live_referrer:
        data["referrer_id"] = live_referrer.get("referrer_id")
        data["referrer_name"] = live_referrer.get("referrer_name")

    if status == "PENDING":
        if live_referrer:
            data["referral_status"] = "PENDING"
            data["referral_bonus_amount"] = split["referral_bonus_amount"]
            data["platform_commission_amount"] = split[
                "platform_commission_amount"
            ]
        elif stored_referrer or data.get("referral_status") in (
            "PENDING",
            "RETRY_PENDING",
        ):
            data["referral_status"] = "CANCELLED"
            data["referral_bonus_amount"] = 0.0
            data["platform_commission_amount"] = split["commission_amount"]
        else:
            data["referral_status"] = "PLATFORM"
            data["referral_bonus_amount"] = 0.0
            data["platform_commission_amount"] = split["commission_amount"]
    elif not data.get("referral_status"):
        data["referral_status"] = "PAID" if stored_referrer else "PLATFORM"

    return data


@router.get("/withdrawals/pending")
async def pending_withdrawals(admin: dict = Depends(require_admin)):
    db = get_db()
    items = await db.withdrawal_requests.find({"status": "PENDING"}, {"_id": 0}).to_list(100)
    refs = await model_referral_service.resolve_withdrawal_referrers(
        [item.get("user_id") for item in items]
    )
    return {
        "success": True,
        "withdrawals": [
            _withdrawal_view(item, refs.get(item.get("user_id"))) for item in items
        ],
    }


@router.get("/withdrawals/processed")
async def processed_withdrawals(admin: dict = Depends(require_admin)):
    db = get_db()
    items = (
        await db.withdrawal_requests.find({"status": {"$in": ["PAID", "PROCESSED"]}}, {"_id": 0})
        .sort("paid_at", -1)
        .to_list(200)
    )
    return {
        "success": True,
        "withdrawals": [_withdrawal_view(item) for item in items],
    }


@router.get("/withdrawals/failed")
async def failed_withdrawals(admin: dict = Depends(require_admin)):
    db = get_db()
    items = (
        await db.withdrawal_requests.find({"status": "REJECTED"}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(200)
    )
    return {
        "success": True,
        "withdrawals": [_withdrawal_view(item) for item in items],
    }


@router.get("/model-referrals")
async def model_referrals_dashboard(admin: dict = Depends(require_admin)):
    """Platform-wide model referral analytics and recent bonuses."""
    return await model_referral_service.get_admin_model_referral_summary()


@router.get("/withdrawals/increase-requests")
async def withdrawal_increase_requests(admin: dict = Depends(require_admin)):
    db = get_db()
    items = (
        await db.withdrawal_increase_requests.find({}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(200)
    )
    return {"success": True, "requests": items}


@router.post("/withdrawals/increase-requests/{request_id}/approve")
async def approve_withdrawal_increase(request_id: str, body: dict | None = None, admin: dict = Depends(require_admin)):
    db = get_db()
    req = await db.withdrawal_increase_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Not found")
    approved_amount = None
    if body and body.get("approved_max_amount") is not None:
        approved_amount = float(body["approved_max_amount"])
    await db.withdrawal_increase_requests.update_one(
        {"request_id": request_id, "status": "PENDING"},
        {
            "$set": {
                "status": "APPROVED",
                "approved_max_amount": approved_amount or req.get("requested_max_amount"),
                "processed_at": datetime.now(timezone.utc),
            }
        },
    )
    if approved_amount:
        await db.creator_profiles.update_one(
            {"user_id": req["user_id"]}, {"$set": {"max_withdraw_amount": approved_amount}}
        )
    await _notify_user(
        req["user_id"],
        "Withdrawal limit increased",
        "Your withdrawal limit request was approved.",
        "withdrawal_increase_approved",
    )
    await _audit(admin["user_id"], "withdrawal_increase_approve", {"request_id": request_id})
    return {"success": True}


@router.post("/withdrawals/increase-requests/{request_id}/reject")
async def reject_withdrawal_increase(request_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    req = await db.withdrawal_increase_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Not found")
    await db.withdrawal_increase_requests.update_one(
        {"request_id": request_id, "status": "PENDING"},
        {"$set": {"status": "REJECTED", "processed_at": datetime.now(timezone.utc)}},
    )
    await _notify_user(
        req["user_id"],
        "Withdrawal limit request rejected",
        "Your withdrawal limit request was not approved.",
        "withdrawal_increase_rejected",
    )
    await _audit(admin["user_id"], "withdrawal_increase_reject", {"request_id": request_id})
    return {"success": True}


@router.post("/withdrawals/{request_id}/mark-paid")
async def mark_paid(request_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    req = await db.withdrawal_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Not found")
    gross = round(float(req.get("amount") or 0), 2)
    current_status = req.get("status")
    if current_status not in ("PENDING", "PAID", "PROCESSED"):
        return {
            "success": True,
            "message": "Already processed",
            "referral_bonus_paid": False,
        }

    now = datetime.now(timezone.utc)

    # A new request carries a referral snapshot. Do not let a referral applied
    # after the request retroactively earn a bonus on it. Legacy rows without
    # the snapshot fall back to the live referral state.
    has_snapshot = "referral_status" in req
    current_referral = await model_referral_service.resolve_withdrawal_referrer(
        req["user_id"]
    )
    eligible_referral = (
        current_referral
        if (not has_snapshot or req.get("referrer_id"))
        else None
    )

    marker = None
    if eligible_referral or req.get("referrer_id"):
        # Pay the model referral bonus only for a completed payout. Idempotent
        # per request id, so a retried admin action cannot double-credit.
        try:
            await model_referral_service.process_model_referral_bonus(
                req["user_id"],
                gross,
                withdrawal_request_id=request_id,
            )
        except Exception:
            logger.exception("Model referral bonus failed for withdrawal %s", request_id)
        # A duplicate/retry returns False from the service but the marker is the
        # source of truth. Check it so a retry never downgrades an already-paid
        # bonus to the platform's full share.
        marker = await db.model_referral_bonuses.find_one(
            {"withdrawal_request_id": request_id}, {"_id": 0}
        )

    split = wallet_service.calculate_withdrawal_split(gross, bool(marker))
    if marker:
        referrer_id = marker.get("referrer_id")
        referrer_name = marker.get("referrer_name") or req.get("referrer_name") or "Model"
        bonus_paid = round(float(marker.get("bonus_amount") or 0), 2)
        platform_share = round(split["commission_amount"] - bonus_paid, 2)
        referral_status = "PAID"
    elif eligible_referral:
        referrer_id = eligible_referral.get("referrer_id")
        referrer_name = eligible_referral.get("referrer_name") or "Model"
        bonus_paid = 0.0
        platform_share = split["commission_amount"]
        referral_status = "RETRY_PENDING"
    else:
        referrer_id = req.get("referrer_id")
        referrer_name = req.get("referrer_name")
        bonus_paid = 0.0
        platform_share = split["commission_amount"]
        referral_status = (
            "CANCELLED"
            if req.get("referrer_id")
            or req.get("referral_status") in ("PENDING", "RETRY_PENDING")
            else "PLATFORM"
        )

    settlement = {
        "commission_rate": split["commission_rate"],
        "commission_amount": split["commission_amount"],
        "payout_amount": split["payout_amount"],
        "referral_bonus_percentage": split["referral_bonus_percentage"],
        "referral_bonus_amount": bonus_paid,
        "potential_referral_bonus_amount": split["potential_referral_bonus_amount"],
        "platform_commission_amount": platform_share,
        "referrer_id": referrer_id,
        "referrer_name": referrer_name,
        "referral_status": referral_status,
        "settled_at": now,
    }

    if current_status == "PENDING":
        await db.withdrawal_requests.update_one(
            {"request_id": request_id, "status": "PENDING"},
            {
                "$set": {
                    **settlement,
                    "status": "PAID",
                    "paid_at": now,
                    "paid_by": admin["user_id"],
                }
            },
        )
        await _audit(admin["user_id"], "withdrawal_paid", {"request_id": request_id})
        await _notify_user(
            req["user_id"],
            "Withdrawal paid",
            (
                f"₹{split['payout_amount']:.2f} was sent to your UPI after "
                f"₹{split['commission_amount']:.2f} withdrawal commission."
            ),
            "withdrawal_paid",
        )
    else:
        # Retry path for a payout already marked paid. This repairs a missing
        # referral bonus without paying the creator twice.
        await db.withdrawal_requests.update_one(
            {"request_id": request_id},
            {"$set": settlement},
        )
        await _audit(
            admin["user_id"],
            "withdrawal_paid_retry",
            {"request_id": request_id},
        )

    return {
        "success": True,
        "message": "Already processed" if current_status != "PENDING" else "Marked paid",
        "payout_amount": split["payout_amount"],
        "commission_amount": split["commission_amount"],
        "referral_bonus_paid": bool(marker),
        "referral_bonus_amount": bonus_paid,
        "platform_commission_amount": platform_share,
        "referral_status": referral_status,
    }


@router.post("/withdrawals/{request_id}/reject")
async def reject_withdrawal(request_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    req = await db.withdrawal_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Not found")
    if req["status"] == "PENDING":
        await wallet_service.credit_earnings(req["user_id"], req["amount"])
        await wallet_service.insert_transaction(
            user_id=req["user_id"],
            tx_type="WITHDRAW_REVERSED",
            amount=req["amount"],
            description="Withdrawal rejected — refunded",
            metadata={"request_id": request_id},
            transaction_id=f"tx_withdraw_rev_{request_id}",
        )
        await db.withdrawal_requests.update_one(
            {"request_id": request_id, "status": "PENDING"},
            {"$set": {"status": "REJECTED", "processed_at": datetime.now(timezone.utc)}},
        )
        await _notify_user(
            req["user_id"],
            "Withdrawal rejected",
            f"₹{req.get('amount')} was returned to your earnings.",
            "withdrawal_rejected",
        )
    await _audit(admin["user_id"], "withdrawal_reject", {"request_id": request_id})
    return {"success": True}


@router.post("/withdrawals/{request_id}/mark-error")
async def mark_withdrawal_error(request_id: str, body: dict | None = None, admin: dict = Depends(require_admin)):
    """Mark a paid withdrawal as failed; refund the held amount if requested."""
    db = get_db()
    req = await db.withdrawal_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Not found")
    if req["status"] in ("REJECTED", "FAILED"):
        return {"success": True, "message": "Already processed"}
    refund = bool((body or {}).get("refund_amount"))
    if refund and req["status"] == "PENDING":
        await wallet_service.credit_earnings(req["user_id"], req["amount"])
        await wallet_service.insert_transaction(
            user_id=req["user_id"],
            tx_type="WITHDRAW_REVERSED",
            amount=req["amount"],
            description="Withdrawal failed — refunded",
            metadata={"request_id": request_id},
            transaction_id=f"tx_withdraw_rev_{request_id}",
        )
    await db.withdrawal_requests.update_one(
        {"request_id": request_id},
        {
            "$set": {
                "status": "FAILED",
                "payment_error_remarks": (body or {}).get("payment_error_remarks"),
                "admin_notes": (body or {}).get("admin_notes"),
                "processed_at": datetime.now(timezone.utc),
            }
        },
    )
    await _notify_user(
        req["user_id"],
        "Withdrawal failed",
        "Your withdrawal could not be completed."
        + (" The amount was returned to your earnings." if refund else ""),
        "withdrawal_failed",
    )
    await _audit(admin["user_id"], "withdrawal_mark_error", {"request_id": request_id})
    return {"success": True}


@router.get("/support/messages")
async def support_messages(admin: dict = Depends(require_admin)):
    db = get_db()
    msgs = await db.support_messages.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    ids = list({m.get("user_id") for m in msgs if m.get("user_id")})
    names: dict[str, dict] = {}
    if ids:
        async for u in db.users.find(
            {"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1}
        ):
            names[u["user_id"]] = u
    for m in msgs:
        u = names.get(m.get("user_id")) or {}
        m["user_name"] = u.get("name")
        m["user_phone"] = u.get("phone")
    return {"success": True, "messages": msgs}


@router.post("/support/messages/{message_id}/mark-read")
async def mark_support_read(message_id: str, admin: dict = Depends(require_admin)):
    db = get_db()
    await db.support_messages.update_one(
        {"message_id": message_id},
        {"$set": {"status": "read", "read_at": datetime.now(timezone.utc)}},
    )
    return {"success": True}


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
                "notification_id": f"ntf_{uuid.uuid4().hex[:12]}",
                "user_id": u["user_id"],
                "title": body.title,
                "body": body.body,
                "type": "admin_broadcast",
                "read": False,
                "created_at": datetime.now(timezone.utc),
            }
        )
        await emit_to_user(
            u["user_id"],
            "new_notification",
            {"title": body.title, "message": body.body, "type": "admin_broadcast"},
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

    # Firebase / FCM diagnostic — tells you whether push will actually send.
    settings = get_settings()
    firebase_ok = False
    firebase_project = None
    firebase_error = None
    try:
        from app.services.push_service import _ensure_firebase

        firebase_ok = _ensure_firebase()
        if firebase_ok:
            import firebase_admin

            firebase_project = firebase_admin.get_app().project_id
    except Exception as e:
        firebase_error = str(e)

    return {
        "success": True,
        "redis_ok": redis_ok,
        "socket_connections": len(sid_to_user_id),
        "stuck_calls_swept": swept,
        "firebase": {
            "configured": bool(
                settings.firebase_credentials_path or settings.firebase_credentials_json
            ),
            "source": "json_env"
            if settings.firebase_credentials_json
            else ("file" if settings.firebase_credentials_path else None),
            "ready": firebase_ok,
            "project_id": firebase_project,
            "error": firebase_error,
        },
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/audit")
async def audit_log(admin: dict = Depends(require_admin)):
    db = get_db()
    items = await db.admin_audit.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"success": True, "audit": items}


@router.post("/push-test")
async def push_test(body: dict | None = None, admin: dict = Depends(require_admin)):
    """Send a test push to a user (or a raw token) to verify FCM end-to-end."""
    db = get_db()
    user_id = (body or {}).get("user_id")
    raw_token = (body or {}).get("token")
    token = raw_token
    if user_id and not token:
        doc = await db.push_tokens.find_one({"user_id": user_id}, {"_id": 0})
        token = (doc or {}).get("device_push_token")
    if not token:
        raise HTTPException(400, "No push token found (pass user_id or token)")
    ok = await push_service.send_push(
        token,
        title="Simple Talk test",
        body="If you see this, FCM is working.",
        data={"type": "push_test"},
        channel_id="app_notifications",
    )
    await _audit(admin["user_id"], "push_test", {"user_id": user_id, "ok": ok})
    return {"success": ok, "sent_to": user_id or "raw-token"}


# ── Financial ────────────────────────────────────────────────────────────────

async def _sum_amount(db, match: dict) -> float:
    rows = await db.transactions.aggregate(
        [{"$match": match}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
    ).to_list(1)
    return round(rows[0]["total"], 2) if rows else 0.0


@router.get("/financial/dashboard")
async def financial_dashboard(admin: dict = Depends(require_admin)):
    db = get_db()
    total_creators = await db.creator_profiles.count_documents({"is_approved": True})
    total_revenue = await _sum_amount(
        db, {"type": {"$in": ["RECHARGE", "CALL_DEBIT", "GIFT_DEBIT"]}}
    )
    total_commission = await _sum_amount(
        db, {"type": {"$in": ["COMMISSION", "GIFT_COMMISSION", "RECHARGE_COMMISSION"]}}
    )
    wd = await db.withdrawal_requests.aggregate(
        [
            {"$match": {"status": {"$in": ["PENDING", "PAID", "PROCESSED", "APPROVED"]}}},
            {
                "$group": {
                    "_id": None,
                    "total": {
                        "$sum": {"$ifNull": ["$payout_amount", "$amount"]}
                    },
                }
            },
        ]
    ).to_list(1)
    total_withdrawals = round(wd[0]["total"], 2) if wd else 0.0
    platform = await db.platform_wallet.find_one({"platform_id": "platform_001"}, {"_id": 0})
    balance = round(platform.get("balance", 0.0) if platform else 0.0, 2)
    return {
        "success": True,
        "total_models": total_creators,
        "total_revenue": total_revenue,
        "total_commission": total_commission,
        "total_withdrawals": total_withdrawals,
        "platform_wallet_balance": balance,
        "net_profit": balance,
    }


@router.get("/financial/overview")
async def financial_overview(admin: dict = Depends(require_admin)):
    db = get_db()
    platform = await db.platform_wallet.find_one({"platform_id": "platform_001"}, {"_id": 0})
    total_commissions = round(platform.get("balance", 0.0) if platform else 0.0, 2)
    payouts = await db.withdrawal_requests.aggregate(
        [
            {"$match": {"status": {"$in": ["PAID", "PROCESSED", "APPROVED"]}}},
            {
                "$group": {
                    "_id": None,
                    "total": {
                        "$sum": {"$ifNull": ["$payout_amount", "$amount"]}
                    },
                }
            },
        ]
    ).to_list(1)
    total_payouts = round(payouts[0]["total"], 2) if payouts else 0.0
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)
    month_start = today_start.replace(day=1)
    today_comm = await _sum_amount(db, {"type": "COMMISSION", "created_at": {"$gte": today_start}})
    week_comm = await _sum_amount(db, {"type": "COMMISSION", "created_at": {"$gte": week_start}})
    month_comm = await _sum_amount(db, {"type": "COMMISSION", "created_at": {"$gte": month_start}})
    active_models = await db.creator_profiles.count_documents({"is_approved": True})
    total_calls = await db.call_records.count_documents({"status": {"$in": ["ENDED", "ENDED_INSUFFICIENT_BALANCE"]}})
    return {
        "success": True,
        "overview": {
            "total_commissions": total_commissions,
            "total_payouts": total_payouts,
            "net_profit": round(total_commissions - total_payouts, 2),
            "today_commissions": today_comm,
            "week_commissions": week_comm,
            "month_commissions": month_comm,
            "active_models": active_models,
            "total_calls": total_calls,
        },
    }


@router.get("/financial/transactions")
async def financial_transactions(
    start_date: str | None = None,
    end_date: str | None = None,
    transaction_type: str | None = None,
    admin: dict = Depends(require_admin),
):
    db = get_db()
    query: dict = {}
    if start_date or end_date:
        date_query: dict = {}
        if start_date:
            date_query["$gte"] = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        if end_date:
            date_query["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        query["created_at"] = date_query
    if transaction_type:
        query["type"] = transaction_type
    txs = await db.transactions.find(query, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"success": True, "transactions": txs}


@router.get("/financial/commissions")
async def financial_commissions(
    start_date: str | None = None,
    end_date: str | None = None,
    admin: dict = Depends(require_admin),
):
    db = get_db()
    query: dict = {"type": "COMMISSION"}
    if start_date or end_date:
        date_query: dict = {}
        if start_date:
            date_query["$gte"] = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        if end_date:
            date_query["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        query["created_at"] = date_query
    rows = await db.transactions.aggregate(
        [
            {"$match": query},
            {
                "$group": {
                    "_id": "$metadata.model_id",
                    "total_commission": {"$sum": "$amount"},
                    "total_calls": {"$sum": 1},
                }
            },
            {"$sort": {"total_commission": -1}},
        ]
    ).to_list(100)
    result = []
    for r in rows:
        creator_id = r["_id"]
        if not creator_id:
            continue
        u = await db.users.find_one({"user_id": creator_id}, {"_id": 0, "name": 1, "email": 1})
        result.append(
            {
                "model_id": creator_id,
                "model_name": (u or {}).get("name", "Unknown"),
                "total_commission": round(r["total_commission"], 2),
                "total_calls": r["total_calls"],
            }
        )
    return {"success": True, "breakdown": result}


@router.get("/financial/recharge-commissions")
async def recharge_commissions(
    admin: dict = Depends(require_admin),
    limit: int = 100,
    type: str | None = None,
):
    """Platform commission ledger from recharges (and optionally all types)."""
    db = get_db()
    limit = min(max(limit, 1), 200)
    match: dict = {}
    if type:
        match["type"] = type
    items = (
        await db.platform_commissions.find(match, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    total_rows = await db.platform_commissions.aggregate(
        [
            {"$match": match},
            {
                "$group": {
                    "_id": None,
                    "total": {"$sum": "$amount"},
                    "gateway": {"$sum": "$gateway_commission"},
                    "service": {"$sum": "$service_commission"},
                    "count": {"$sum": 1},
                }
            },
        ]
    ).to_list(1)
    t = total_rows[0] if total_rows else {}
    return {
        "success": True,
        "commissions": items,
        "totals": {
            "total_commission": round(t.get("total", 0) or 0, 2),
            "gateway_commission": round(t.get("gateway", 0) or 0, 2),
            "service_commission": round(t.get("service", 0) or 0, 2),
            "count": t.get("count", 0),
        },
    }


@router.get("/financial/analytics")
async def financial_analytics(period: str = "month", admin: dict = Depends(require_admin)):
    db = get_db()
    now = datetime.now(timezone.utc)
    if period == "day":
        start = now - timedelta(days=30)
        fmt = {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}
    elif period == "week":
        start = now - timedelta(weeks=12)
        fmt = {"$dateToString": {"format": "%Y-W%V", "date": "$created_at"}}
    else:
        start = now - timedelta(days=365)
        fmt = {"$dateToString": {"format": "%Y-%m", "date": "$created_at"}}
    rows = await db.transactions.aggregate(
        [
            {"$match": {"type": "COMMISSION", "created_at": {"$gte": start}}},
            {
                "$group": {
                    "_id": fmt,
                    "total_commission": {"$sum": "$amount"},
                    "count": {"$sum": 1},
                }
            },
            {"$sort": {"_id": 1}},
        ]
    ).to_list(100)
    return {
        "success": True,
        "analytics": [
            {"period": r["_id"], "commission": round(r["total_commission"], 2), "transactions": r["count"]}
            for r in rows
        ],
    }


@router.post("/bootstrap")
async def bootstrap_admin(email: str, password: str, name: str = "Admin"):
    """Create first admin if none exists. Disabled in production."""
    settings = get_settings()
    if not settings.allow_admin_bootstrap:
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


@router.get('/wallets/search')
async def admin_wallet_search(phone: str, admin: dict = Depends(require_admin)): pass
