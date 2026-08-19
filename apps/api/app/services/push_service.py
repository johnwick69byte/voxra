"""Push notifications via FCM (data-only for calls)."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_firebase_ready = False


async def _incr_metric(key: str) -> None:
    try:
        from app.core.database_redis import get_redis, redis_available

        r = get_redis()
        if r and redis_available():
            await r.incr(key)
    except Exception:
        pass


def _ensure_firebase() -> bool:
    global _firebase_ready
    if _firebase_ready:
        return True
    settings = get_settings()
    if not settings.firebase_credentials_path:
        logger.warning("Firebase not configured — push notifications are no-ops")
        return False
    try:
        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            cred = credentials.Certificate(settings.firebase_credentials_path)
            firebase_admin.initialize_app(cred)
        _firebase_ready = True
        return True
    except Exception:
        logger.exception("Firebase init failed")
        return False


async def send_push(
    token: str,
    *,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    data_only: bool = False,
    ttl_seconds: Optional[int] = None,
    channel_id: str = "app_notifications",
) -> bool:
    if not token:
        return False
    if not _ensure_firebase():
        logger.info("PUSH (dry-run) %s | %s | data_only=%s data=%s", title, body, data_only, data)
        await _incr_metric("metrics:fcm_ok")
        return True

    from firebase_admin import messaging

    str_data = {str(k): str(v) for k, v in (data or {}).items() if v is not None}
    ttl = timedelta(seconds=ttl_seconds) if ttl_seconds else None
    android = messaging.AndroidConfig(
        priority="high",
        ttl=ttl,
        notification=(
            None
            if data_only
            else messaging.AndroidNotification(channel_id=channel_id, sound="default")
        ),
    )
    apns = messaging.APNSConfig(
        payload=messaging.APNSPayload(
            aps=messaging.Aps(
                content_available=True,
                sound=None if data_only else "default",
            )
        )
    )
    message = messaging.Message(
        notification=None if data_only else messaging.Notification(title=title, body=body),
        data=str_data,
        token=token,
        android=android,
        apns=apns,
    )
    try:
        messaging.send(message)
        await _incr_metric("metrics:fcm_ok")
        return True
    except Exception:
        logger.exception("FCM send failed")
        await _incr_metric("metrics:fcm_fail")
        return False
