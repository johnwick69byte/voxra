"""Creator earnings analytics (overview, breakdown, calls, gifts)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from app.core.database import get_db
from app.core.security import require_creator

router = APIRouter(prefix="/profile/earnings", tags=["earnings"])

_EARN_TYPES = ["CALL_CREDIT", "GIFT_CREDIT", "GIFT_EARNINGS"]
_ENDED = ["ENDED", "ENDED_INSUFFICIENT_BALANCE"]


@router.get("/overview")
async def earnings_overview(user: dict = Depends(require_creator)):
    db = get_db()
    uid = user["user_id"]
    total_result = await db.transactions.aggregate(
        [
            {"$match": {"user_id": uid, "type": {"$in": _EARN_TYPES}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]
    ).to_list(1)
    total_earnings = total_result[0]["total"] if total_result else 0.0

    withdrawal_result = await db.withdrawal_requests.aggregate(
        [
            {"$match": {"user_id": uid, "status": {"$in": ["PAID", "PENDING"]}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]
    ).to_list(1)
    total_withdrawals = withdrawal_result[0]["total"] if withdrawal_result else 0.0

    pending_result = await db.withdrawal_requests.aggregate(
        [
            {"$match": {"user_id": uid, "status": "PENDING"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]
    ).to_list(1)
    pending_withdrawals = pending_result[0]["total"] if pending_result else 0.0

    commission_result = await db.call_records.aggregate(
        [
            {"$match": {"receiver_id": uid, "status": {"$in": _ENDED}}},
            {"$group": {"_id": None, "total": {"$sum": "$commission_amount"}}},
        ]
    ).to_list(1)
    total_commission = commission_result[0]["total"] if commission_result else 0.0

    total_calls = await db.call_records.count_documents({"receiver_id": uid, "status": {"$in": _ENDED}})
    from app.services import wallet_service

    wallet = await wallet_service.get_wallet(uid)
    available = wallet.get("earnings_balance", 0.0)

    return {
        "success": True,
        "overview": {
            "total_earnings": round(total_earnings, 2),
            "total_commission_deducted": round(total_commission, 2),
            "available_balance": round(available, 2),
            "total_withdrawals": round(total_withdrawals, 2),
            "pending_withdrawals": round(pending_withdrawals, 2),
            "total_calls": total_calls,
        },
    }


@router.get("/breakdown")
async def earnings_breakdown(period: str = "month", user: dict = Depends(require_creator)):
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
            {
                "$match": {
                    "user_id": user["user_id"],
                    "type": {"$in": _EARN_TYPES},
                    "created_at": {"$gte": start},
                }
            },
            {"$group": {"_id": fmt, "total_earnings": {"$sum": "$amount"}, "count": {"$sum": 1}}},
            {"$sort": {"_id": 1}},
        ]
    ).to_list(100)
    return {
        "success": True,
        "breakdown": [
            {"period": r["_id"], "earnings": round(r["total_earnings"], 2), "calls": r["count"]}
            for r in rows
        ],
    }


@router.get("/calls")
async def earnings_calls(limit: int = 50, user: dict = Depends(require_creator)):
    db = get_db()
    limit = min(max(limit, 1), 100)
    calls = (
        await db.call_records.find(
            {"receiver_id": user["user_id"], "status": {"$in": _ENDED}}, {"_id": 0}
        )
        .sort("end_time", -1)
        .limit(limit)
        .to_list(limit)
    )
    caller_ids = list({c["caller_id"] for c in calls})
    callers = (
        await db.users.find(
            {"user_id": {"$in": caller_ids}}, {"_id": 0, "user_id": 1, "name": 1, "picture": 1}
        ).to_list(len(caller_ids))
        if caller_ids
        else []
    )
    cmap = {u["user_id"]: u for u in callers}
    result = []
    for c in calls:
        caller = cmap.get(c["caller_id"], {})
        result.append(
            {
                "call_id": c["call_id"],
                "caller_name": caller.get("name") or "Unknown",
                "caller_picture": caller.get("picture"),
                "call_type": c.get("call_type"),
                "duration_seconds": c.get("duration_seconds", 0),
                "total_amount": c.get("total_amount", 0),
                "commission_amount": c.get("commission_amount", 0),
                "model_earnings": c.get("model_earnings", 0),
                "end_time": c.get("end_time"),
            }
        )
    return {"success": True, "calls": result}


@router.get("/gifts")
async def earnings_gifts(limit: int = 50, user: dict = Depends(require_creator)):
    db = get_db()
    limit = min(max(limit, 1), 100)
    gifts = (
        await db.transactions.find(
            {"user_id": user["user_id"], "type": {"$in": ["GIFT_CREDIT", "GIFT_EARNINGS"]}},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    total_count = await db.transactions.count_documents(
        {"user_id": user["user_id"], "type": {"$in": ["GIFT_CREDIT", "GIFT_EARNINGS"]}}
    )
    total_result = await db.transactions.aggregate(
        [
            {"$match": {"user_id": user["user_id"], "type": {"$in": ["GIFT_CREDIT", "GIFT_EARNINGS"]}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]
    ).to_list(1)
    total_amount = total_result[0]["total"] if total_result else 0.0
    return {
        "success": True,
        "gifts": gifts,
        "total_gifts": total_count,
        "total_gift_amount": round(total_amount, 2),
    }
