"""Notify followers when a creator becomes available (online / leaves DND)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.database_redis import get_redis
from app.services import push_service

logger = logging.getLogger(__name__)


def _notify_cooldown_key(creator_id: str) -> str:
    return f"follower_online_notify:{creator_id}"


async def notify_followers_creator_online(creator_id: str, *, reason: str = "online") -> int:
    """
    Push + in-app notification to followers. Rate-limited to once per 10 minutes per creator.
    """
    r = get_redis()
    if r:
        ok = await r.set(_notify_cooldown_key(creator_id), "1", nx=True, ex=600)
        if not ok:
            return 0

    db = get_db()
    creator = await db.users.find_one({"user_id": creator_id}, {"_id": 0, "name": 1})
    name = (creator or {}).get("name") or "A creator"
    follows = await db.follows.find({"creator_id": creator_id}, {"_id": 0, "follower_id": 1}).to_list(2000)
    sent = 0
    title = f"{name} is online"
    body = "They're available for an instant call on Voxora."
    for f in follows:
        fid = f["follower_id"]
        await db.notifications.insert_one(
            {
                "user_id": fid,
                "title": title,
                "body": body,
                "type": "creator_online",
                "data": {"creator_id": creator_id, "reason": reason},
                "read": False,
                "created_at": datetime.now(timezone.utc),
            }
        )
        token_doc = await db.push_tokens.find_one({"user_id": fid}, {"_id": 0})
        if token_doc and token_doc.get("device_push_token"):
            await push_service.send_push(
                token_doc["device_push_token"],
                title=title,
                body=body,
                data={"type": "creator_online", "creator_id": creator_id},
                channel_id="app_notifications",
            )
            sent += 1
    logger.info("follower online notify creator=%s sent=%s", creator_id, sent)
    return sent
