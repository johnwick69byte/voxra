"""Paid text chat between a fan and a creator.

Fans pay a fixed rupee price per message. Half is credited to the creator's
earnings wallet and half to the platform wallet. Creator replies are free.
A creator cannot open a thread or send the first message.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.config import get_settings
from app.core.database import get_db
from app.core.socket import emit_to_user
from app.services import push_service, wallet_service

logger = logging.getLogger(__name__)

MAX_TEXT_LENGTH = 1000
MAX_CLIENT_ID_LENGTH = 80


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value) -> Optional[str]:
    if isinstance(value, datetime):
        return value.isoformat()
    if value is None:
        return None
    return str(value)


def _price() -> float:
    price = round(float(get_settings().chat_message_price or 0), 2)
    return price if price > 0 else 1.0


def _split(price: float) -> tuple[float, float]:
    creator_cut = round(price / 2, 2)
    platform_cut = round(price - creator_cut, 2)
    return creator_cut, platform_cut


def _message_payload(message: dict) -> dict:
    return {
        "message_id": message["message_id"],
        "conversation_id": message["conversation_id"],
        "sender_id": message["sender_id"],
        "text": message.get("text") or "",
        "price": round(float(message.get("price") or 0), 2),
        "created_at": _iso(message.get("created_at")),
    }


async def _blocked(db, a: str, b: str) -> bool:
    one = await db.blocks.find_one({"blocker_id": a, "blocked_id": b}, {"_id": 1})
    if one:
        return True
    two = await db.blocks.find_one({"blocker_id": b, "blocked_id": a}, {"_id": 1})
    return bool(two)


async def _require_conversation(db, conversation_id: str, user: dict) -> dict:
    conv = await db.chat_conversations.find_one(
        {"conversation_id": conversation_id}, {"_id": 0}
    )
    if not conv:
        raise HTTPException(404, "Chat not found")
    if user["user_id"] not in (conv.get("fan_id"), conv.get("creator_id")):
        raise HTTPException(403, "Not a participant")
    return conv


async def _peer_map(db, conversations: list[dict], viewer_id: str) -> dict:
    peer_ids = []
    for conv in conversations:
        peer_ids.append(
            conv["creator_id"] if conv.get("fan_id") == viewer_id else conv.get("fan_id")
        )
    peer_ids = [pid for pid in peer_ids if pid]
    users = (
        await db.users.find(
            {"user_id": {"$in": peer_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "picture": 1, "username": 1},
        ).to_list(len(peer_ids))
        if peer_ids
        else []
    )
    profiles = (
        await db.creator_profiles.find(
            {"user_id": {"$in": peer_ids}},
            {"_id": 0, "user_id": 1, "images": 1},
        ).to_list(len(peer_ids))
        if peer_ids
        else []
    )
    pictures = {}
    for profile in profiles:
        images = profile.get("images") or []
        if images:
            pictures[profile["user_id"]] = images[0]
    out = {}
    for user in users:
        uid = user["user_id"]
        out[uid] = {
            "name": user.get("name") or "User",
            "username": user.get("username"),
            "picture": pictures.get(uid) or user.get("picture"),
        }
    return out


def _conversation_payload(conv: dict, viewer_id: str, peer: Optional[dict] = None) -> dict:
    peer = peer or {}
    is_fan = conv.get("fan_id") == viewer_id
    return {
        "conversation_id": conv["conversation_id"],
        "peer_id": conv["creator_id"] if is_fan else conv.get("fan_id"),
        "peer_name": peer.get("name") or "User",
        "peer_username": peer.get("username"),
        "peer_picture": peer.get("picture"),
        "last_message": conv.get("last_message") or "",
        "last_message_at": _iso(conv.get("last_message_at") or conv.get("updated_at")),
        "unread": int(conv.get("fan_unread" if is_fan else "creator_unread") or 0),
        "message_count": int(conv.get("message_count") or 0),
        "role": "fan" if is_fan else "creator",
    }


async def list_conversations(user: dict) -> dict:
    db = get_db()
    if user.get("user_type") == "creator":
        query = {"creator_id": user["user_id"]}
        unread_field = "creator_unread"
    else:
        query = {"fan_id": user["user_id"]}
        unread_field = "fan_unread"
    rows = (
        await db.chat_conversations.find(query, {"_id": 0})
        .sort("updated_at", -1)
        .limit(100)
        .to_list(100)
    )
    peers = await _peer_map(db, rows, user["user_id"])
    conversations = []
    unread_total = 0
    for conv in rows:
        peer_id = conv["creator_id"] if conv.get("fan_id") == user["user_id"] else conv.get("fan_id")
        conversations.append(_conversation_payload(conv, user["user_id"], peers.get(peer_id)))
        unread_total += int(conv.get(unread_field) or 0)
    return {
        "success": True,
        "conversations": conversations,
        "unread_total": unread_total,
        "message_price": _price(),
    }


async def open_conversation(user: dict, creator_id: str) -> dict:
    if user.get("user_type") == "creator":
        raise HTTPException(403, "Only fans can start a chat")
    creator_id = (creator_id or "").strip()
    if not creator_id:
        raise HTTPException(400, "Creator is required")
    if creator_id == user["user_id"]:
        raise HTTPException(400, "You cannot message yourself")

    db = get_db()
    if await _blocked(db, user["user_id"], creator_id):
        raise HTTPException(403, "You can't message this creator")

    creator = await db.users.find_one(
        {"user_id": creator_id, "deleted": {"$ne": True}},
        {"_id": 0, "user_id": 1, "user_type": 1, "name": 1, "picture": 1, "username": 1},
    )
    profile = await db.creator_profiles.find_one(
        {"user_id": creator_id, "is_approved": True},
        {"_id": 0, "user_id": 1, "images": 1},
    )
    if not creator or creator.get("user_type") != "creator" or not profile:
        raise HTTPException(404, "Creator not found")

    existing = await db.chat_conversations.find_one(
        {"fan_id": user["user_id"], "creator_id": creator_id}, {"_id": 0}
    )
    if existing:
        peer = await _peer_map(db, [existing], user["user_id"])
        return {
            "success": True,
            "conversation": _conversation_payload(
                existing, user["user_id"], peer.get(creator_id)
            ),
            "message_price": _price(),
        }

    now = _now()
    doc = {
        "conversation_id": f"chat_{uuid.uuid4().hex[:16]}",
        "fan_id": user["user_id"],
        "creator_id": creator_id,
        "created_at": now,
        "updated_at": now,
        "last_message": "",
        "last_message_at": None,
        "last_message_id": None,
        "last_sender_id": None,
        "fan_unread": 0,
        "creator_unread": 0,
        "fan_spend": 0.0,
        "creator_earnings": 0.0,
        "platform_share": 0.0,
        "message_count": 0,
    }
    try:
        await db.chat_conversations.insert_one(doc)
    except DuplicateKeyError:
        doc = await db.chat_conversations.find_one(
            {"fan_id": user["user_id"], "creator_id": creator_id}, {"_id": 0}
        )
    peer = await _peer_map(db, [doc], user["user_id"])
    return {
        "success": True,
        "conversation": _conversation_payload(doc, user["user_id"], peer.get(creator_id)),
        "message_price": _price(),
    }


async def list_messages(
    user: dict, conversation_id: str, *, limit: int = 50, before: Optional[str] = None
) -> dict:
    db = get_db()
    conv = await _require_conversation(db, conversation_id, user)
    limit = min(max(int(limit or 50), 1), 100)
    query: dict = {"conversation_id": conversation_id}
    if before:
        try:
            cursor = datetime.fromisoformat(before.replace("Z", "+00:00"))
        except ValueError as exc:
            raise HTTPException(400, "Invalid cursor") from exc
        query["created_at"] = {"$lt": cursor}
    rows = (
        await db.chat_messages.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    rows.reverse()
    await _mark_read(db, conv, user["user_id"])
    next_before = _iso(rows[0]["created_at"]) if len(rows) == limit else None
    wallet = await wallet_service.get_wallet(user["user_id"])
    return {
        "success": True,
        "messages": [_message_payload(row) for row in rows],
        "next_before": next_before,
        "message_price": _price(),
        "role": "fan" if conv.get("fan_id") == user["user_id"] else "creator",
        "balance": round(float(wallet.get("balance") or 0), 2),
        "peer_id": conv["creator_id"] if conv.get("fan_id") == user["user_id"] else conv.get("fan_id"),
    }


async def mark_read(user: dict, conversation_id: str) -> dict:
    db = get_db()
    conv = await _require_conversation(db, conversation_id, user)
    await _mark_read(db, conv, user["user_id"])
    return {"success": True}


async def _mark_read(db, conv: dict, user_id: str) -> None:
    field = "fan_unread" if conv.get("fan_id") == user_id else "creator_unread"
    await db.chat_conversations.update_one(
        {"conversation_id": conv["conversation_id"]},
        {"$set": {field: 0}},
    )


async def _settle_fan_message(db, message: dict, conv: dict) -> None:
    """Credit the creator and the platform once for a paid fan message."""
    price = round(float(message.get("price") or _price()), 2)
    creator_cut, platform_cut = _split(price)
    message_id = message["message_id"]
    credit_tx_id = f"tx_{message_id}_credit"
    debit_tx_id = f"tx_{message_id}_debit"
    commission_id = f"pcom_{message_id}"

    existing_credit = await db.transactions.find_one(
        {"transaction_id": credit_tx_id}, {"_id": 0, "transaction_id": 1}
    )
    if not existing_credit:
        await wallet_service.credit_earnings(conv["creator_id"], creator_cut)
        await wallet_service.insert_transaction(
            user_id=conv["creator_id"],
            tx_type="CHAT_CREDIT",
            amount=creator_cut,
            description="Chat earnings",
            metadata={
                "message_id": message_id,
                "conversation_id": conv["conversation_id"],
                "fan_id": conv["fan_id"],
            },
            transaction_id=credit_tx_id,
        )

    existing_comm = await db.platform_commissions.find_one(
        {"commission_id": commission_id}, {"_id": 0, "commission_id": 1}
    )
    if not existing_comm and platform_cut > 0:
        await wallet_service.add_platform_balance(platform_cut)
        await wallet_service.record_platform_commission(
            commission_type="CHAT_COMMISSION",
            amount=platform_cut,
            source_id=message_id,
            user_id=conv["creator_id"],
            gross_amount=price,
            model_earnings=creator_cut,
            commission_id=commission_id,
            metadata={
                "conversation_id": conv["conversation_id"],
                "fan_id": conv["fan_id"],
                "message_id": message_id,
            },
        )

    existing_debit = await db.transactions.find_one(
        {"transaction_id": debit_tx_id}, {"_id": 0, "transaction_id": 1}
    )
    if not existing_debit:
        await wallet_service.insert_transaction(
            user_id=conv["fan_id"],
            tx_type="CHAT_DEBIT",
            amount=price,
            description="Chat message",
            metadata={
                "message_id": message_id,
                "conversation_id": conv["conversation_id"],
                "creator_id": conv["creator_id"],
            },
            transaction_id=debit_tx_id,
        )

    await db.chat_messages.update_one(
        {"message_id": message_id},
        {"$set": {"billing_status": "settled", "price": price}},
    )


async def _touch_conversation(db, conv: dict, message: dict, *, paid: bool) -> None:
    price = round(float(message.get("price") or 0), 2)
    creator_cut, platform_cut = _split(price) if paid else (0.0, 0.0)
    sender_is_fan = message["sender_id"] == conv["fan_id"]
    inc = {"message_count": 1}
    if sender_is_fan:
        inc["creator_unread"] = 1
        if paid:
            inc["fan_spend"] = price
            inc["creator_earnings"] = creator_cut
            inc["platform_share"] = platform_cut
    else:
        inc["fan_unread"] = 1
    now = message.get("created_at") or _now()
    await db.chat_conversations.update_one(
        {
            "conversation_id": conv["conversation_id"],
            "last_message_id": {"$ne": message["message_id"]},
        },
        {
            "$inc": inc,
            "$set": {
                "last_message": (message.get("text") or "")[:120],
                "last_message_at": now,
                "last_message_id": message["message_id"],
                "last_sender_id": message["sender_id"],
                "updated_at": now,
            },
        },
    )


async def _notify(db, conv: dict, message: dict, sender: dict) -> None:
    recipient_id = (
        conv["creator_id"] if message["sender_id"] == conv["fan_id"] else conv["fan_id"]
    )
    payload = _message_payload(message)
    try:
        await emit_to_user(recipient_id, "chat_message", payload)
    except Exception:
        logger.exception("chat emit failed for %s", recipient_id)
    name = sender.get("name") or "New message"
    preview = (message.get("text") or "")[:140]
    try:
        await push_service.send_to_user(
            db,
            recipient_id,
            title=name,
            body=preview,
            data={
                "type": "CHAT_MESSAGE",
                "conversation_id": conv["conversation_id"],
                "title": name,
                "body": preview,
            },
            channel_id="app_notifications",
        )
    except Exception:
        logger.exception("chat push failed for %s", recipient_id)


def _clean_text(text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        raise HTTPException(400, "Message is empty")
    if len(cleaned) > MAX_TEXT_LENGTH:
        raise HTTPException(400, "Message is too long")
    return cleaned


def _clean_client_id(client_message_id: str) -> str:
    client_id = (client_message_id or "").strip()
    if not client_id or len(client_id) > MAX_CLIENT_ID_LENGTH:
        raise HTTPException(400, "client_message_id is required")
    return client_id


async def _balance_for(user_id: str) -> float:
    wallet = await wallet_service.get_wallet(user_id)
    return round(float(wallet.get("balance") or 0), 2)


async def send_message(
    user: dict, conversation_id: str, text: str, client_message_id: str
) -> dict:
    cleaned = _clean_text(text)
    client_id = _clean_client_id(client_message_id)
    db = get_db()
    conv = await _require_conversation(db, conversation_id, user)
    if await _blocked(db, conv["fan_id"], conv["creator_id"]):
        raise HTTPException(403, "Messaging is blocked")

    is_fan = user["user_id"] == conv["fan_id"]
    existing = await db.chat_messages.find_one(
        {"sender_id": user["user_id"], "client_message_id": client_id},
        {"_id": 0},
    )
    if existing:
        if existing.get("conversation_id") != conversation_id:
            raise HTTPException(409, "client_message_id already used")
        if is_fan and existing.get("billing_status") != "settled":
            await _settle_fan_message(db, existing, conv)
            await _touch_conversation(db, conv, existing, paid=True)
            existing = await db.chat_messages.find_one(
                {"message_id": existing["message_id"]}, {"_id": 0}
            )
        return {
            "success": True,
            "message": _message_payload(existing),
            "balance": await _balance_for(user["user_id"]),
            "duplicate": True,
            "message_price": _price(),
        }

    price = _price() if is_fan else 0.0
    debited = False
    if is_fan:
        wallet = await wallet_service.atomic_debit(user["user_id"], price)
        if not wallet:
            raise HTTPException(402, "Add at least ₹1 to your wallet to send a message")
        debited = True

    message = {
        "message_id": f"msg_{uuid.uuid4().hex[:16]}",
        "conversation_id": conv["conversation_id"],
        "sender_id": user["user_id"],
        "client_message_id": client_id,
        "text": cleaned,
        "price": price,
        "billing_status": "pending" if is_fan else "settled",
        "created_at": _now(),
    }
    try:
        await db.chat_messages.insert_one(message)
    except DuplicateKeyError:
        if debited:
            await wallet_service.credit_balance(user["user_id"], price)
        existing = await db.chat_messages.find_one(
            {"sender_id": user["user_id"], "client_message_id": client_id},
            {"_id": 0},
        )
        if existing and is_fan and existing.get("billing_status") != "settled":
            await _settle_fan_message(db, existing, conv)
            await _touch_conversation(db, conv, existing, paid=True)
            existing = await db.chat_messages.find_one(
                {"message_id": existing["message_id"]}, {"_id": 0}
            )
        return {
            "success": True,
            "message": _message_payload(existing),
            "balance": await _balance_for(user["user_id"]),
            "duplicate": True,
            "message_price": _price(),
        }

    try:
        if is_fan:
            await _settle_fan_message(db, message, conv)
        await _touch_conversation(db, conv, message, paid=is_fan)
    except Exception:
        logger.exception("chat settlement failed for %s", message["message_id"])
        current = await db.chat_messages.find_one(
            {"message_id": message["message_id"]}, {"_id": 0, "billing_status": 1}
        )
        if not current or current.get("billing_status") != "settled":
            await db.chat_messages.delete_one({"message_id": message["message_id"]})
            if debited:
                await wallet_service.credit_balance(user["user_id"], price)
            raise HTTPException(500, "Could not send message")
        try:
            await _touch_conversation(db, conv, message, paid=is_fan)
        except Exception:
            logger.exception("chat conversation update failed for %s", message["message_id"])

    fresh = await db.chat_messages.find_one(
        {"message_id": message["message_id"]}, {"_id": 0}
    )
    await _notify(db, conv, fresh or message, user)
    return {
        "success": True,
        "message": _message_payload(fresh or message),
        "balance": await _balance_for(user["user_id"]),
        "duplicate": False,
        "message_price": _price(),
    }


async def _names(db, user_ids: list[str]) -> dict:
    rows = (
        await db.users.find(
            {"user_id": {"$in": user_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "phone": 1},
        ).to_list(len(user_ids))
        if user_ids
        else []
    )
    return {row["user_id"]: row for row in rows}


async def admin_list(*, limit: int = 50, skip: int = 0) -> dict:
    db = get_db()
    limit = min(max(int(limit or 50), 1), 100)
    skip = max(int(skip or 0), 0)
    rows = (
        await db.chat_conversations.find({}, {"_id": 0})
        .sort("updated_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )
    ids = []
    for row in rows:
        ids.extend([row.get("fan_id"), row.get("creator_id")])
    names = await _names(db, [i for i in ids if i])
    conversations = []
    for row in rows:
        fan = names.get(row.get("fan_id"), {})
        creator = names.get(row.get("creator_id"), {})
        conversations.append(
            {
                "conversation_id": row.get("conversation_id"),
                "fan_id": row.get("fan_id"),
                "fan_name": fan.get("name") or row.get("fan_id"),
                "creator_id": row.get("creator_id"),
                "creator_name": creator.get("name") or row.get("creator_id"),
                "last_message": row.get("last_message") or "",
                "last_message_at": _iso(row.get("last_message_at") or row.get("updated_at")),
                "message_count": int(row.get("message_count") or 0),
                "fan_spend": round(float(row.get("fan_spend") or 0), 2),
                "creator_earnings": round(float(row.get("creator_earnings") or 0), 2),
                "platform_share": round(float(row.get("platform_share") or 0), 2),
            }
        )
    return {"success": True, "conversations": conversations}


async def admin_thread(conversation_id: str) -> dict:
    db = get_db()
    conv = await db.chat_conversations.find_one(
        {"conversation_id": conversation_id}, {"_id": 0}
    )
    if not conv:
        raise HTTPException(404, "Chat not found")
    messages = (
        await db.chat_messages.find({"conversation_id": conversation_id}, {"_id": 0})
        .sort("created_at", 1)
        .limit(300)
        .to_list(300)
    )
    names = await _names(db, [conv.get("fan_id"), conv.get("creator_id")])
    fan = names.get(conv.get("fan_id"), {})
    creator = names.get(conv.get("creator_id"), {})
    return {
        "success": True,
        "conversation": {
            "conversation_id": conv["conversation_id"],
            "fan_id": conv.get("fan_id"),
            "fan_name": fan.get("name") or conv.get("fan_id"),
            "creator_id": conv.get("creator_id"),
            "creator_name": creator.get("name") or conv.get("creator_id"),
            "message_count": int(conv.get("message_count") or 0),
            "fan_spend": round(float(conv.get("fan_spend") or 0), 2),
            "creator_earnings": round(float(conv.get("creator_earnings") or 0), 2),
            "platform_share": round(float(conv.get("platform_share") or 0), 2),
        },
        "messages": [
            {
                **_message_payload(message),
                "paid": round(float(message.get("price") or 0), 2) > 0,
            }
            for message in messages
        ],
    }
