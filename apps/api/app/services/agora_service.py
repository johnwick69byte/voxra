"""Agora RTC token minting."""

from __future__ import annotations

import logging
import time

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def build_rtc_token(channel_name: str, uid: int = 0, role: str = "publisher", expire_seconds: int = 3600) -> dict:
    settings = get_settings()
    app_id = settings.agora_app_id
    cert = settings.agora_app_certificate
    if not app_id:
        # Dev fallback — client must still have a real app id in production
        return {
            "app_id": "DEV_AGORA_APP_ID",
            "token": f"dev_token_{channel_name}",
            "channel_name": channel_name,
            "uid": uid,
            "expire_at": int(time.time()) + expire_seconds,
        }
    try:
        from agora_token_builder import RtcTokenBuilder, Role_Publisher, Role_Subscriber

        role_const = Role_Publisher if role == "publisher" else Role_Subscriber
        privilege_expired_ts = int(time.time()) + expire_seconds
        token = RtcTokenBuilder.buildTokenWithUid(
            app_id, cert, channel_name, uid, role_const, privilege_expired_ts
        )
        return {
            "app_id": app_id,
            "token": token,
            "channel_name": channel_name,
            "uid": uid,
            "expire_at": privilege_expired_ts,
        }
    except Exception:
        logger.exception("Agora token build failed")
        raise
